import { expect } from "chai"
import { ethers } from "hardhat"
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { deployUpgradeableContract, RESET, YELLOW, deployContract } from "../scripts/utils"
import { MockPump, SimpleERC20, VotingEscrowPump } from "../typechain-types"
import { parseEther, parseUnits } from "ethers"

import { getDuration, getCurrentTimeString, viewLockedInfo, viewTotalVotingPower } from "./testLogUtils"

describe("test the functions", function () {

  async function deployContracts() {
    const pump = <any>(await deployUpgradeableContract("MockPump")) as MockPump
    const vePump = <any>(await deployUpgradeableContract(
      "VotingEscrowPump", [await pump.getAddress()]
    )) as VotingEscrowPump
    const wbtc = await deployContract("SimpleERC20", [
      "Wrapped BTC", "WBTC", 8, parseUnits("1000000", 8)
    ]) as SimpleERC20
    return { pump, vePump, wbtc }
  }


  it("should deploy the contract correctly", async function () {
    await loadFixture(deployContracts)
  })


  it("should distribute reward correctly", async function () {
    const { pump, vePump, wbtc } = await loadFixture(deployContracts)
    const [admin, distributor, user1, user2] = await ethers.getSigners()

    const genesisTimestamp = Number(await vePump.getCurrentNextWeekStart())
    let votingPowerUser1, votingPowerUser2, currentWeekCursor, nextWeekCursor

    // Distribute tokens
    await pump.connect(admin).transfer(user1.address, parseEther("1000000"))
    await pump.connect(admin).transfer(user2.address, parseEther("1000000"))
    await wbtc.connect(admin).transfer(distributor.address, parseUnits("400", 8))
    expect(await pump.balanceOf(user1.address)).to.equal(parseEther("1000000"))
    expect(await pump.balanceOf(user2.address)).to.equal(parseEther("1000000"))
    expect(await wbtc.balanceOf(distributor.address)).to.equal(parseUnits("400", 8))

    // Approve tokens
    await pump.connect(user1).approve(await vePump.getAddress(), parseEther("1000000"))
    await pump.connect(user2).approve(await vePump.getAddress(), parseEther("1000000"))
    await wbtc.connect(distributor).approve(await vePump.getAddress(), parseUnits("400", 8))

    // Set reward distributor and token
    await vePump.connect(admin).setRewardDistributor(distributor.address, true)
    await vePump.connect(admin).addRewardToken(await wbtc.getAddress())
    expect(await vePump.getRewardTokens()).to.deep.equal([await wbtc.getAddress()])
    expect(await vePump.getRewardTokensLength()).to.equal(1)


    // ============ [Timestamp] Week 0 Day 0 00:00:00 ============
    await time.increaseTo(genesisTimestamp)
    expect(await vePump.isValidWeekTime(genesisTimestamp)).to.be.true
    currentWeekCursor = genesisTimestamp
    nextWeekCursor = genesisTimestamp + getDuration(1)

    console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week 0${RESET}] Genesis start ` +
      `(${await viewTotalVotingPower(vePump)})`)


    // ============ [Timestamp] Week 0 Day 2 02:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(0, 2, 2))
    await vePump.connect(user1).mint(
      user1.address, parseEther("50"), getDuration(7, 0, 0)
    )     // Lock 50 $PUMP for 7 weeks
    expect(await vePump.ownerOf(0)).to.equal(user1.address)

    votingPowerUser1 = await vePump.votingPowerOf(0)
    expect(votingPowerUser1).to.closeTo(
      parseEther(String(50 * 7 / 208)), parseEther("0.001"),
    )

    console.log(`${await getCurrentTimeString()} User 1 mint $vePUMP[tokenId=0]`)
    console.log(`${await viewLockedInfo(vePump, 0)}`)


    // ============ [Timestamp] Week 0 Day 3 05:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(0, 3, 5))
    await vePump.connect(user1).mint(
      user1.address, parseEther("20"), getDuration(15, 0, 0)
    )     // Lock 20 $PUMP for 15 weeks
    expect(await vePump.ownerOf(1)).to.equal(user1.address)

    votingPowerUser1 = (await vePump.votingPowerOf(0)) + (await vePump.votingPowerOf(1))
    expect(votingPowerUser1).to.closeTo(
      parseEther(String(50 * 7 / 208 + 20 * 15 / 208)), parseEther("0.001"),
    )

    console.log(`${await getCurrentTimeString()} User 1 mint $vePUMP[tokenId=1]`)
    console.log(`${await viewLockedInfo(vePump, 1)}`)


    // ============ [Timestamp] Week 0 Day 4 12:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(0, 4, 12))
    await vePump.connect(distributor).depositRewardForNextWeek(
      await wbtc.getAddress(), parseUnits("10", 8)
    )     // Distribute 10 $WBTC reward for next week
    expect(await vePump.rewardPerWeek(await wbtc.getAddress(), nextWeekCursor))
      .to.equal(parseUnits("10", 8))

    console.log(`${await getCurrentTimeString()} Distribute 10 $WBTC reward for next week`)


    // ============ [Timestamp] Week 1 Day 0 00:00:00 ============
    await time.increaseTo(nextWeekCursor)
    currentWeekCursor = nextWeekCursor
    nextWeekCursor = nextWeekCursor + getDuration(1)

    console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week 1${RESET}] Start ` +
      `(${await viewTotalVotingPower(vePump)})`)


    // ============ [Timestamp] Week 1 Day 1 15:20:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(1, 1, 15, 20))
    await vePump.connect(user2).mint(
      user2.address, parseEther("100"), getDuration(10, 0, 0)
    )     // Lock 100 $PUMP for 10 weeks
    expect(await vePump.ownerOf(2)).to.equal(user2.address)

    votingPowerUser2 = await vePump.votingPowerOf(2)
    expect(votingPowerUser2).to.closeTo(
      parseEther(String(100 * 10 / 208)), parseEther("0.001"),
    )

    console.log(`${await getCurrentTimeString()} User 2 mint $vePUMP[tokenId=2]`)
    console.log(`${await viewLockedInfo(vePump, 2)}`)


    // ============ [Timestamp] Week 1 Day 2 00:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(1, 2))
    await vePump.connect(distributor).depositRewardForNextWeek(
      await wbtc.getAddress(), parseUnits("5", 8)
    )     // Distribute 5 $WBTC reward for next week
    expect(await vePump.rewardPerWeek(await wbtc.getAddress(), nextWeekCursor))
      .to.equal(parseUnits("5", 8))

    console.log(`${await getCurrentTimeString()} Distribute 5 $WBTC reward for next week`)


    // ============ [Timestamp] Week 2 ~ Week 4 ============
    for (let i = 2; i <= 4; i++) {

      // ============ [Timestamp] Week i Day 0 00:00:00 ============
      await time.increaseTo(nextWeekCursor)
      console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week ${i}${RESET}] Start` +
        `(${await viewTotalVotingPower(vePump)})`)

      // ============ [Timestamp] Week i Day 0 01:00:00 ============
      currentWeekCursor = nextWeekCursor
      nextWeekCursor = nextWeekCursor + getDuration(1)
      await time.increaseTo(genesisTimestamp + getDuration(i, 0, 1))

      await vePump.connect(distributor).depositRewardForNextWeek(
        await wbtc.getAddress(), parseUnits(`${7 - i}`, 8),
      )
      expect(await vePump.rewardPerWeek(await wbtc.getAddress(), nextWeekCursor))
        .to.equal(parseUnits(`${7 - i}`, 8))
      console.log(`${await getCurrentTimeString()} Distribute ${8 - i} $WBTC reward for next week`)
    }


    // ============ [Timestamp] Week 5 Day 0 00:00:00 ============
    await time.increaseTo(nextWeekCursor)
    currentWeekCursor = nextWeekCursor
    nextWeekCursor = nextWeekCursor + getDuration(1)
    console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week 5${RESET}] Start` +
      `(${await viewTotalVotingPower(vePump)})`)


    // ============ [Timestamp] Week 5 Day 5 20:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(5, 5, 20))
    await expect(vePump.connect(user1).increaseLock(
      0, parseEther("100"),
    )).to.be.revertedWith("Claim reward first")

    /**
     * Reward $WBTC for NFT #0:
     *  Week 0 end: 10 $WBTC, voting power 50 * 7 / 208 ~ 1.68269, 
     *    total 1.68269 + 20 * 15 / 208 ~ 1.68269 + 1.44231 = 3.12500
     *  Week 1 end: 5 $WBTC, voting power 1.68269, 
     *    total 3.12500 + 100 * 10 / 208 ~ 3.12500 + 4.80769 = 7.93269
     *  Week 2 end: 5 $WBTC, voting power 1.68269, total 7.93269
     *  Week 3 end: 4 $WBTC, voting power 1.68269, total 7.93269
     *  Week 4 end: 3 $WBTC, voting power 1.68269, total 7.93269
     * 
     * Total reward: 10 * (1.68269 / 3.12500) + 5 * (1.68269 / 7.93269) + \
     *    5 * (1.68269 / 7.93269) + 4 * (1.68269 / 7.93269) + 3 * (1.68269 / 7.93269)
     *    = 10 * (1.68269 / 3.12500) + 17 * (1.68269 / 7.93269) ~ 8.99066 $WBTC
     */

    await vePump.connect(user1).claimRewardWeekly(0, 50)
    expect(await wbtc.balanceOf(user1.address))
      .to.closeTo(parseUnits("8.99066", 8), parseUnits("0.0001", 8))
    console.log(`${await getCurrentTimeString()} User 1 claim reward for NFT #0`)

    const lockInfo0 = await vePump.lockedInfo(0)
    const newLockPeriod = lockInfo0.unlockTime - BigInt(await time.latest())
    await vePump.connect(user1).increaseLock(
      0, parseEther("100"),
    )     // Increase lock 100 $PUMP for NFT #0

    console.log(`${await getCurrentTimeString()} User 1 increase lock 100 $PUMP for NFT #0`)
    console.log(`${await viewLockedInfo(vePump, 0)}`)


    // ============ [Timestamp] Week 5 Day 6 12:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(5, 6, 12))
    await vePump.connect(distributor).depositRewardForNextWeek(
      await wbtc.getAddress(), parseUnits("10", 8)
    )
    console.log(`${await getCurrentTimeString()} Distribute 10 $WBTC reward for next week`)

    await vePump.connect(distributor).depositRewardForSpecificNft(
      await wbtc.getAddress(), 2, parseUnits("3", 8)
    )
    await vePump.connect(distributor).batchDepositRewardForSpecificNft(
      await wbtc.getAddress(), [2, 3], [parseUnits("3", 8), parseUnits("4", 8)]
    )
    console.log(`${await getCurrentTimeString()} Distribute 6 $WBTC reward for NFT #2`)
    console.log(`${await getCurrentTimeString()} Distribute 4 $WBTC reward for NFT #3`)


    // ============ [Timestamp] Week 6 Day 0 00:00:00 ============
    await time.increaseTo(nextWeekCursor)
    currentWeekCursor = nextWeekCursor
    nextWeekCursor = nextWeekCursor + getDuration(1)
    console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week 6${RESET}] Start` +
      `(${await viewTotalVotingPower(vePump)})`)

    /**
     * Reward $WBTC for NFT #2:
     *  Week 0 end: 10 $WBTC, voting power 0, total 3.12500
     *  Week 1 end: 5 $WBTC, voting power 100 * 10 / 208 ~ 4.80769, total 7.93269
     *  Week 2 end: 5 $WBTC, voting power 4.80769, total 7.93269
     *  Week 3 end: 4 $WBTC, voting power 4.80769, total 7.93269
     *  Week 4 end: 3 $WBTC, voting power 4.80769, total 7.93269
     *  Week 5 end: 10 $WBTC, voting power 4.80769,
     *    total 7.93269 - 1.68269 + 2.38667 = 8.63667
     * 
     * Total reward: 10 * (0 / 3.12500) + 5 * (4.80769 / 7.93269) + \
     *    5 * (4.80769 / 7.93269) + 4 * (4.80769 / 7.93269) + \
     *    3 * (4.80769 / 7.93269) + 10 * (4.80769 / 8.63667)
     *    = 17 * (4.80769 / 7.93269) + 10 * (4.80769 / 8.63667) ~ 15.86963 $WBTC
     */
    await time.increaseTo(currentWeekCursor + getDuration(1, 0, 0))
    await vePump.connect(user2).claimRewardWeekly(2, 50)
    expect(await wbtc.balanceOf(user2.address))
      .to.closeTo(parseUnits("15.86963", 8), parseUnits("0.0001", 8))
    console.log(`${await getCurrentTimeString()} User 2 claim reward for NFT #2`)

    await vePump.connect(user2).claimRewardForSpecificNft(2)
    expect(await wbtc.balanceOf(user2.address))   // Extra 3 $WBTC reward
      .to.closeTo(parseUnits("21.86962", 8), parseUnits("0.0001", 8))
    
    expect(await vePump.balanceOf(user1.address)).to.equal(2)
    expect(await vePump.balanceOf(user2.address)).to.equal(1)


    // ============ [Timestamp] Week 6 Day 5 00:00:00 ============
    expect(await vePump.getNextWeekStart(genesisTimestamp + getDuration(6, 5, 0)))
      .to.equal(nextWeekCursor)   // Test coverage for `getNextWeekStart`
    expect(await wbtc.decimals()).to.equal(8)
    await expect(pump.initialize()) // Test coverage for $PUMP `initialize`
      .to.be.revertedWithCustomError(pump, "InvalidInitialization")
  })

})
