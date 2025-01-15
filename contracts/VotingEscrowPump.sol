// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/interfaces/IERC20.sol";

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

import "./utils/WeekMath.sol";
import "./utils/TokenUriBuilder.sol";


contract VotingEscrowPump is ERC721Upgradeable, OwnableUpgradeable, WeekMath, TokenUriBuilder {

    // ============================== Structs ==============================

    using SafeERC20 for IERC20;
    using Checkpoints for Checkpoints.Trace208;
    using EnumerableSet for EnumerableSet.AddressSet;

    struct LockedInfo {
        uint208 amount;         // Amount of $PUMP locked
        uint48 unlockTime;      // Unlock time
        uint48 lockPeriod;      // Lock period
        uint48 weekCursor;      // Week cursor, the latest week that the reward has already been claimed
        uint208 votingPower;    // 1 $PUMP = 1 voting power when lockPeriod = MAX_TIME
        bool burnt;             // Burnt flag. Once burnt, the LockedInfo is immutable
    }


    // ============================== Storage ==============================

    IERC20 public pump;

    uint256 public nftTotalSupply;
    mapping(uint256 => LockedInfo) public lockedInfo;

    Checkpoints.Trace208 internal totalHistoryVotingPower;
    mapping(uint256 => Checkpoints.Trace208) internal nftHistoryVotingPower;

    EnumerableSet.AddressSet internal rewardTokens;
    mapping(address => bool) public isRewardDistributor;
    mapping(address => mapping(uint48 => uint208)) public rewardPerWeek;
    mapping(address => mapping(uint256 => uint208)) public rewardForSpecificNft;


    // =============================== Events ==============================

    event Mint(address to, uint256 tokenId, LockedInfo info);
    event Burn(address from, uint256 tokenId, LockedInfo info);
    event Merge(
        address owner, uint256 tokenIdFrom, uint256 tokenIdTo,
        LockedInfo infoFrom, LockedInfo infoTo, LockedInfo infoMerged
    );
    event Split(
        address owner, uint256 tokenId, uint208 splitAmount,
        LockedInfo infoSplitted, LockedInfo infoNew
    );
    event IncreaseLock(
        address owner, uint256 tokenId, uint208 additionalAmount, LockedInfo info
    );
    event ExtendLock(
        address owner, uint256 tokenId, uint48 newLockPeriod, LockedInfo info
    );

    event RewardTokenAdded(address token);
    event RewardDistributorSet(address distributor, bool status);
    event RewardDeposited(address token, uint48 week, uint208 amount);
    event RewardDepositedForSpecificNft(address rewardToken, uint256 tokenId, uint208 amount);
    event BatchRewardDepositedForSpecificNft(address rewardToken, uint256[] tokenIds, uint208[] amounts);

    event RewardClaimed(uint256 tokenId, uint48 week, uint208[] rewards);
    event RewardClaimedForSpecificNft(uint256 tokenId, address rewardToken, uint208 amount);


    // ======================= Modifier & Initializer ======================

    function initialize(address pumpToken) initializer public {
        pump = IERC20(pumpToken);
        __ERC721_init("vePump", "Voting Escrow Pump");
        __Ownable_init(_msgSender());
    }

    /**
     * @dev Check if the conditions are met for the given tokenId:
     *  - Not burnt
     *  - The caller is the owner of the NFT
     *  - The NFT is not ready to be unlocked
     *  - The NFT's reward has been already claimed
     * @param tokenId The tokenId to check
     */
    modifier checkConditions(uint256 tokenId) {
        uint48 current = SafeCast.toUint48(block.timestamp);
        uint48 currentWeek = getCurrentWeekStart();
        LockedInfo memory info = lockedInfo[tokenId];
        require(!info.burnt, "Already burnt");
        require(_ownerOf(tokenId) == _msgSender(), "Not NFT owner");
        require(info.unlockTime > current, "Already unlocked");
        require(info.weekCursor == currentWeek, "Claim reward first");
        _;
    }

    modifier checkSpecificRewardClaimed(uint256 tokenId) {
        for (uint256 i = 0; i < rewardTokens.length(); i++) {
            address rewardToken = rewardTokens.at(i);
            uint208 amount = rewardForSpecificNft[rewardToken][tokenId];
            require(amount == 0, "Specific reward not claimed");
        }
        _;
    }

    modifier onlyRewardDistributor() {
        require(isRewardDistributor[_msgSender()], "Not reward distributor");
        _;
    }


    // =========================== View functions ==========================

    function votingPowerValid(uint256 tokenId) public view returns (bool) {
        return !lockedInfo[tokenId].burnt && lockedInfo[tokenId].unlockTime > block.timestamp;
    }

    function votingPowerOf(uint256 tokenId) public view returns (uint208) {
        return nftHistoryVotingPower[tokenId].latest();
    }

    function votingPowerOfAt(uint256 tokenId, uint48 timepoint) public view returns (uint208) {
        return nftHistoryVotingPower[tokenId].upperLookup(timepoint);
    }

    function totalVotingPower() public view returns (uint208) {
        return totalHistoryVotingPower.latest();
    }

    function totalVotingPowerAt(uint48 timepoint) public view returns (uint208) {
        return totalHistoryVotingPower.upperLookup(timepoint);
    }

    function getRewardTokensLength() public view returns (uint256) {
        return rewardTokens.length();
    }

    function getRewardTokens() public view returns (address[] memory) {
        address[] memory tokens = new address[](rewardTokens.length());
        for (uint256 i = 0; i < rewardTokens.length(); i++) {
            tokens[i] = rewardTokens.at(i);
        }
        return tokens;
    }

    function tokenURI(uint256 tokenId) public override view returns (string memory) {
        _requireOwned(tokenId);     // Same as ERC721Upgradeable.tokenURI
        LockedInfo memory info = lockedInfo[tokenId];
        return _buildTokenUri(
            tokenId,
            info.amount,
            info.unlockTime,
            info.lockPeriod,
            info.votingPower
        );
    }


    // ==================== Write functions - NFT logic ====================

    function mint(address to, uint208 tokenAmount, uint48 lockPeriod) public {
        // Variables
        uint48 current = SafeCast.toUint48(block.timestamp);
        uint48 unlockTime = current + lockPeriod;
        
        // Conditions
        require(to != address(0), "Invalid address");
        require(tokenAmount > 0, "Token amount must be greater than 0");
        require(lockPeriod >= MIN_TIME && lockPeriod <= MAX_TIME, "Invalid lock period");

        // Lock $PUMP
        pump.safeTransferFrom(_msgSender(), address(this), tokenAmount);

        // Update storage
        uint256 tokenId = nftTotalSupply;
        uint208 votingPower = tokenAmount * lockPeriod / MAX_TIME;

        nftTotalSupply++;
        lockedInfo[tokenId] = LockedInfo(
            tokenAmount, unlockTime, lockPeriod,
            getCurrentWeekStart(), votingPower, false
        );
        totalHistoryVotingPower.push(
            current, totalHistoryVotingPower.latest() + votingPower
        );
        nftHistoryVotingPower[tokenId].push(current, votingPower);

        // Mint NFT
        _safeMint(to, tokenId);

        // Events
        emit Mint(to, tokenId, lockedInfo[tokenId]);
    }


    function burn(uint256 tokenId) public {
        // Variables
        uint48 current = SafeCast.toUint48(block.timestamp);
        address from = _ownerOf(tokenId);
        LockedInfo memory info = lockedInfo[tokenId];

        // Conditions
        require(!info.burnt, "Already burnt");
        require(info.unlockTime < current, "Not matured");
        require(from == _msgSender(), "Not NFT owner");

        // Update storage
        lockedInfo[tokenId].burnt = true;
        totalHistoryVotingPower.push(
            current, totalHistoryVotingPower.latest() - info.votingPower
        );
        nftHistoryVotingPower[tokenId].push(current, 0);

        // Unlock $PUMP
        pump.safeTransfer(_msgSender(), info.amount);

        // Burn NFT
        _burn(tokenId);

        // Events
        emit Burn(from, tokenId, lockedInfo[tokenId]);
    }


    function merge(
        uint256 tokenIdFrom, 
        uint256 tokenIdTo
    ) public 
        checkConditions(tokenIdFrom) 
        checkConditions(tokenIdTo) 
        checkSpecificRewardClaimed(tokenIdFrom) 
        checkSpecificRewardClaimed(tokenIdTo) 
    {
        // Variables
        uint48 current = SafeCast.toUint48(block.timestamp);
        LockedInfo memory infoFrom = lockedInfo[tokenIdFrom];
        LockedInfo memory infoTo = lockedInfo[tokenIdTo];
        require(tokenIdFrom != tokenIdTo, "Same token id");

        // Merge
        uint208 newAmount = infoFrom.amount + infoTo.amount;
        uint48 unlockTime = infoFrom.unlockTime > infoTo.unlockTime ? 
            infoFrom.unlockTime : infoTo.unlockTime;        // Unlock time is the max of the two
        uint48 lockPeriod = unlockTime - current;
        uint208 newVotingPower = newAmount * lockPeriod / MAX_TIME;
        require(lockPeriod >= MIN_TIME && lockPeriod <= MAX_TIME, "Invalid lock period");

        // Update locked info
        lockedInfo[tokenIdFrom].burnt = true;
        lockedInfo[tokenIdTo] = LockedInfo(
            newAmount, unlockTime, lockPeriod, 
            getCurrentWeekStart(), newVotingPower, false
        );

        // Update voting power
        nftHistoryVotingPower[tokenIdFrom].push(current, 0);
        nftHistoryVotingPower[tokenIdTo].push(current, newVotingPower);
        totalHistoryVotingPower.push(
            current, totalHistoryVotingPower.latest() + newVotingPower
                - infoFrom.votingPower - infoTo.votingPower
        );

        // Burn old NFT
        _burn(tokenIdFrom);

        // Events
        emit Merge(
            _msgSender(), tokenIdFrom, tokenIdTo, 
            infoFrom, infoTo, lockedInfo[tokenIdTo]
        );
    }


    function split(
        uint256 tokenId, 
        uint208 splitAmount
    ) public checkConditions(tokenId) checkSpecificRewardClaimed(tokenId) {
        // Variables
        uint48 current = SafeCast.toUint48(block.timestamp);
        require(splitAmount > 0 && splitAmount < lockedInfo[tokenId].amount, "Invalid amount");

        // Update locked info
        uint256 newTokenId = nftTotalSupply;
        uint208 oldAmount = lockedInfo[tokenId].amount;
        uint208 newAmount = oldAmount - splitAmount;
        uint208 oldVotingPower = lockedInfo[tokenId].votingPower;
        uint208 splitVotingPower = oldVotingPower * splitAmount / oldAmount;
        uint208 newVotingPower = oldVotingPower - splitVotingPower;

        lockedInfo[tokenId].amount = newAmount;
        lockedInfo[tokenId].votingPower = newVotingPower;
        lockedInfo[newTokenId] = LockedInfo(
            splitAmount, lockedInfo[tokenId].unlockTime, lockedInfo[tokenId].lockPeriod,
            getCurrentWeekStart(), splitVotingPower, false
        );

        // Update voting power
        nftTotalSupply++;
        nftHistoryVotingPower[tokenId].push(current, newVotingPower);
        nftHistoryVotingPower[newTokenId].push(current, splitVotingPower);

        // Mint new NFT
        _safeMint(_msgSender(), newTokenId);

        // Events
        emit Split(
            _msgSender(), tokenId, splitAmount, 
            lockedInfo[tokenId], lockedInfo[newTokenId]
        );
    }


    function increaseLock(
        uint256 tokenId, 
        uint208 additionalAmount
    ) public checkConditions(tokenId) {
        // Variables
        uint48 current = SafeCast.toUint48(block.timestamp);
        LockedInfo memory info = lockedInfo[tokenId];
        require(additionalAmount > 0, "Invalid amount");

        // Lock additional $PUMP
        pump.safeTransferFrom(_msgSender(), address(this), additionalAmount);

        // Update locked info
        uint208 newAmount = info.amount + additionalAmount;
        uint48 remainingTime = info.unlockTime - current;
        uint208 newVotingPower = newAmount * remainingTime / MAX_TIME;

        lockedInfo[tokenId].amount = newAmount;
        lockedInfo[tokenId].lockPeriod = remainingTime;
        lockedInfo[tokenId].votingPower = newVotingPower;

        // Update voting power
        totalHistoryVotingPower.push(
            current, totalHistoryVotingPower.latest() + newVotingPower - info.votingPower
        );
        nftHistoryVotingPower[tokenId].push(current, newVotingPower);

        // Events
        emit IncreaseLock(_msgSender(), tokenId, additionalAmount, lockedInfo[tokenId]);
    }


    function extendLock(
        uint256 tokenId, 
        uint48 newLockPeriod
    ) public checkConditions(tokenId) {
        // Variables
        uint48 current = SafeCast.toUint48(block.timestamp);
        uint48 newUnlockTime = current + newLockPeriod;
        LockedInfo memory info = lockedInfo[tokenId];

        // Extra onditions
        require(newUnlockTime > info.unlockTime, "Can only extend lock");
        require(newLockPeriod >= MIN_TIME && newLockPeriod <= MAX_TIME, "Invalid lock period");

        // Update locked info
        uint208 newVotingPower = info.amount * newLockPeriod / MAX_TIME;
        lockedInfo[tokenId].unlockTime = newUnlockTime;
        lockedInfo[tokenId].lockPeriod = newLockPeriod;
        lockedInfo[tokenId].votingPower = newVotingPower;

        // Update voting power
        totalHistoryVotingPower.push(
            current, totalHistoryVotingPower.latest() + newVotingPower - info.votingPower
        );
        nftHistoryVotingPower[tokenId].push(current, newVotingPower);

        // Events
        emit ExtendLock(_msgSender(), tokenId, newLockPeriod, lockedInfo[tokenId]);
    }


    // ====================== Write functions - admin ======================

    function addRewardToken(address token) public onlyOwner {
        rewardTokens.add(token);
        emit RewardTokenAdded(token);
    }

    function setRewardDistributor(address distributor, bool status) public onlyOwner {
        isRewardDistributor[distributor] = status;
        emit RewardDistributorSet(distributor, status);
    }

    /**
     * @dev Deposit reward for next week. Must be called by the reward distributor.
     *  A reward distributor should deposit rewards for the next week, that is,
     *   the rewards must be well-prepared before a new week starts.
     *  For example, if the current timestamp is 1736046777 (2025-01-05 03:12:57 UTC+0),
     *   which is between 1735776000 (2025-01-02 00:00:00 UTC+0) ~ 1736380800 
     *   (2025-01-09 00:00:00 UTC+0), then the reward distributor is expected to deposit 
     *   rewards for the next week, which is a week starting from 1736380800 
     *   (2025-01-09 00:00:00 UTC+0).
     */
    function depositRewardForNextWeek(address token, uint208 amount) public onlyRewardDistributor {
        uint48 week = getCurrentNextWeekStart();
        require(rewardTokens.contains(token), "Token not supported");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        rewardPerWeek[token][week] += amount;
        emit RewardDeposited(token, week, amount);
    }

    /**
     * @dev Deposit reward for a specific NFT. Must be called by the reward distributor.
     *  A reward distributor can deposit rewards for a specific NFT directly.
     */
    function depositRewardForSpecificNft(
        address rewardToken,
        uint256 tokenId,
        uint208 amount
    ) public onlyRewardDistributor {
        require(rewardTokens.contains(rewardToken), "Token not supported");
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), amount);
        rewardForSpecificNft[rewardToken][tokenId] += amount;
        emit RewardDepositedForSpecificNft(rewardToken, tokenId, amount);
    }

    /**
     * @dev Deposit batch rewards for specific NFTs.
     */
    function batchDepositRewardForSpecificNft(
        address rewardToken,
        uint256[] memory tokenIds,
        uint208[] memory amounts
    ) public onlyRewardDistributor {
        require(tokenIds.length == amounts.length, "Invalid length");
        require(rewardTokens.contains(rewardToken), "Token not supported");
        uint208 totalAmount = 0;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            rewardForSpecificNft[rewardToken][tokenIds[i]] += amounts[i];
            totalAmount += amounts[i];
        }
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), totalAmount);
        emit BatchRewardDepositedForSpecificNft(rewardToken, tokenIds, amounts);
    }


    // =================== Write functions - reward claim ==================

    /**
     * @dev Claim rewards for all reward tokens. 
     *  For each reward token, the rewards are calculated based on the voting power 
     *   of the NFT at the week cursor. The week cursor will be looped for `maxLoopCount` 
     *   times to prevent gas limit exceeded. If a user has unclaimed rewards for more than
     *   `maxLoopCount` weeks, the user can call this function multiple times to claim the 
     *   rewards.
     *  It will only claim rewards that deposited by the function `depositRewardForNextWeek`.
     */
    function claimRewardWeekly(uint256 tokenId, uint256 maxLoopCount) public {
        // Conditions
        uint48 currentWeek = getCurrentWeekStart();
        uint48 weekCursor = lockedInfo[tokenId].weekCursor;
        require(_ownerOf(tokenId) == _msgSender(), "Not NFT owner");
        require(weekCursor < currentWeek, "Already claimed");

        // Calculate rewards
        uint208[] memory rewards = new uint208[](rewardTokens.length());
        uint8 loopCount = 0;
        while (
            weekCursor < currentWeek    // Loop until the week cursor reaches the current week
            && loopCount < maxLoopCount // Prevent gas limit exceeded
        ) {
            weekCursor += WEEK;
            uint208 weight = votingPowerOfAt(tokenId, weekCursor);
            uint208 total = totalVotingPowerAt(weekCursor);
            for (uint256 i = 0; i < rewardTokens.length(); i++) {
                address token = rewardTokens.at(i);
                uint208 weekTokenReward = rewardPerWeek[token][weekCursor] * weight / total;
                rewards[i] += weekTokenReward;
            }
            loopCount++;
        }

        // Update storage
        lockedInfo[tokenId].weekCursor = weekCursor;

        // Transfer rewards
        for (uint256 i = 0; i < rewardTokens.length(); i++) {
            address token = rewardTokens.at(i);
            IERC20(token).safeTransfer(_msgSender(), rewards[i]);
        }

        // Events
        emit RewardClaimed(tokenId, weekCursor, rewards);
    }

    /**
     * @dev Claim rewards for a specific NFT. It will only claim rewards that deposited
     *  by the function `depositRewardForSpecificNft`.
     */
    function claimRewardForSpecificNft(uint256 tokenId) public {
        require(_ownerOf(tokenId) == _msgSender(), "Not NFT owner");
        for (uint256 i = 0; i < rewardTokens.length(); i++) {
            address rewardToken = rewardTokens.at(i);
            uint208 amount = rewardForSpecificNft[rewardToken][tokenId];
            if (amount > 0) {
                rewardForSpecificNft[rewardToken][tokenId] = 0;
                IERC20(rewardToken).safeTransfer(_msgSender(), amount);
                emit RewardClaimedForSpecificNft(tokenId, rewardToken, amount);
            }
        }
    }
    
    /**
     * @dev Claim `Specific reward` and `Weekly reward` simultaneously.
     */
    function claimReward(uint256 tokenId, uint256 maxLoopCount) public {
        claimRewardForSpecificNft(tokenId);
        claimRewardWeekly(tokenId, maxLoopCount);
    }

}
