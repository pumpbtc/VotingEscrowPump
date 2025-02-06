import { expect } from "chai"
import { ethers } from "hardhat"
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { deployUpgradeableContract, RESET, YELLOW, GRAY, deployContract } from "../scripts/utils"
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


  it("should get tokenURI correctly", async function () {
    const { pump, vePump } = await loadFixture(deployContracts)
    const [admin, _distributor, user1] = await ethers.getSigners()

    const genesisTimestamp = Number(await vePump.getCurrentNextWeekStart())

    // Distribute tokens & Approve
    await pump.connect(admin).mint(user1.address, parseEther("1000000"))
    await expect(pump.connect(user1).mint(user1.address, parseEther("1000000")))
      .to.be.revertedWithCustomError(pump, "OwnableUnauthorizedAccount")
    await pump.connect(user1).approve(await vePump.getAddress(), parseEther("1000000"))

    // Mint NFT
    await time.increaseTo(genesisTimestamp + getDuration(0, 2, 2))
    await vePump.connect(user1).mint(
      user1.address, parseEther("50"), getDuration(7, 0, 0)
    )

    // Get tokenURI
    const tokenURI = await vePump.tokenURI(0)
    const infoJson = atob(tokenURI
      .slice(29, tokenURI.length)  // Skip "data:application/json;base64,"
    )
    const date = (new Date(Number(genesisTimestamp + getDuration(7, 2, 2)) * 1000)).toISOString().slice(0, 10)
    const expectedJson = `{` + 
      `"name": "lock #${0}", ` + 
      `"description": "${await vePump._description()}", ` + 
      `"image_data": "${await vePump._imageUrl()}", ` + 
      `"attributes": [` + 
        `{"trait_type": "Locked $PUMP", "value": ${parseEther("50")}}, ` + 
        `{"trait_type": "Unlock Date", "value": "${date}"}, ` + 
        `{"trait_type": "Lock Period", "value": ${getDuration(7)}}, ` + 
        `{"trait_type": "Voting Power", "value": ${parseEther("50") * 7n / 208n}}` + 
      `]` + 
    `}`
    expect(infoJson).to.equal(expectedJson)
    await expect(vePump.tokenURI(1)).to.be.revertedWithCustomError(vePump, "ERC721NonexistentToken")
    console.log(`${await getCurrentTimeString()} Token #0 json info: ${GRAY}${infoJson}${RESET}`)
    console.log(`${await getCurrentTimeString()} Token #0 URI: ${GRAY}${tokenURI}${RESET}`)
  })


  it("should merge, split and extend lock period correctly", async function () {
    const { pump, vePump } = await loadFixture(deployContracts)
    const [admin, _distributor, user1, user2] = await ethers.getSigners()

    const genesisTimestamp = Number(await vePump.getCurrentNextWeekStart())
    let votingPowerUser1, votingPowerUser2, currentWeekCursor, nextWeekCursor

    // Distribute tokens
    await pump.connect(admin).mint(user1.address, parseEther("1000000"))
    await pump.connect(admin).mint(user2.address, parseEther("1000000"))
    expect(await pump.balanceOf(user1.address)).to.equal(parseEther("1000000"))
    expect(await pump.balanceOf(user2.address)).to.equal(parseEther("1000000"))

    // Approve tokens
    await pump.connect(user1).approve(await vePump.getAddress(), parseEther("1000000"))
    await pump.connect(user2).approve(await vePump.getAddress(), parseEther("1000000"))


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
    expect(votingPowerUser1).to.equal(
      await vePump.votingPowerOfOwner(user1.address)
    )
    expect(votingPowerUser1).to.equal(
      await vePump.votingPowerOfOwnerAt(user1.address, genesisTimestamp + getDuration(0, 2, 3))
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


    // ============ [Timestamp] Week 5 Day 0 00:00:01 ============
    await time.increaseTo(genesisTimestamp + getDuration(5, 0, 0, 0, 1))
    currentWeekCursor = Number(await vePump.getCurrentWeekStart())
    nextWeekCursor = currentWeekCursor + getDuration(1)
    console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week 5${RESET}] Start` +
      `(${await viewTotalVotingPower(vePump)})`)


    // ============ [Timestamp] Week 5 Day 1 20:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(5, 1, 20))

    // Reward $WBTC for NFT #0: 0
    await vePump.connect(user1).claimRewardWeekly(0, 50)
    console.log(`${await getCurrentTimeString()} User 1 claim reward for NFT #0`)

    await expect(vePump.connect(user1).extendLock(
      0, getDuration(0, 3),   // Only extend lock for 3 days, too short
    )).to.be.revertedWith("Extra lock period too short")
    await expect(vePump.connect(user1).extendLock(
      0, getDuration(207),   // Extend 207 weeks, too long
    )).to.be.revertedWith("New lock period too long")
    await vePump.connect(user1).extendLock(
      0, getDuration(30),
    )     // Extend lock 30 weeks for NFT #0

    expect((await vePump.lockedInfo(0)).lockPeriod).to.be.equal(getDuration(37))
    console.log(`${await getCurrentTimeString()} User 1 extend lock 30 weeks for NFT #0`)
    console.log(`${await viewLockedInfo(vePump, 0)}`)


    // ============ [Timestamp] Week 6 Day 0 00:00:00 ============
    await time.increaseTo(nextWeekCursor)
    currentWeekCursor = nextWeekCursor
    nextWeekCursor = nextWeekCursor + getDuration(1)
    console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week 6${RESET}] Start` +
      `(${await viewTotalVotingPower(vePump)})`)

    // Reward $WBTC for NFT #0 & NFT #1 & NFT #2: 0
    await vePump.connect(user1).claimRewardWeekly(0, 50)
    await vePump.connect(user1).claimRewardWeekly(1, 50)
    await expect(vePump.connect(user1).claimRewardWeekly(2, 50)).to.be.revertedWith("Not NFT owner")
    await vePump.connect(user2).claimRewardWeekly(2, 50)

    const lockedInfoBefore0 = await vePump.lockedInfo(0)
    const lockedInfoBefore1 = await vePump.lockedInfo(1)

    await expect(vePump.connect(user1).merge(0, 2))
      .to.be.revertedWith("Not NFT owner")
    await vePump.connect(user1).merge(0, 1)
    const unlockTimeMax = lockedInfoBefore0.unlockTime > lockedInfoBefore1.unlockTime ?
      lockedInfoBefore0.unlockTime : lockedInfoBefore1.unlockTime
    const lockedInfoAfter = await vePump.lockedInfo(1)
    const lockedAmountAfter = lockedInfoBefore0.amount + lockedInfoBefore1.amount
    const lockedVotingPowerAfter = lockedInfoBefore0.votingPower + lockedInfoBefore1.votingPower

    expect((await vePump.lockedInfo(0)).burnt).to.be.true
    expect(await vePump.votingPowerValid(0)).to.be.false
    expect(await vePump.votingPowerValid(1)).to.be.true
    expect(lockedInfoAfter.unlockTime).to.equal(unlockTimeMax)
    expect(lockedInfoAfter.amount).to.equal(lockedAmountAfter)
    expect(await vePump.votingPowerOf(1)).to.equal(lockedVotingPowerAfter)
    console.log(`${await getCurrentTimeString()} User 1 merge NFT #0 -> NFT #1`)
    console.log(`${await viewLockedInfo(vePump, 0)}`)
    console.log(`${await viewLockedInfo(vePump, 1)}`)

    await expect(vePump.connect(user2).burn(2))
      .to.be.revertedWith("Not matured")


    // ============ [Timestamp] Week 12 Day 0 00:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(12, 0, 0))
    currentWeekCursor = Number(await vePump.getCurrentWeekStart())
    nextWeekCursor = currentWeekCursor + getDuration(1)
    console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week 12${RESET}] Start` +
      `(${await viewTotalVotingPower(vePump)})`)


    // ============ [Timestamp] Week 12 Day 1 15:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(12, 1, 15))
    await expect(vePump.connect(user1).split(0, parseEther("10")))
      .to.be.revertedWith("Already burnt")
    await expect(vePump.connect(user1).split(2, parseEther("10")))
      .to.be.revertedWith("Not NFT owner")
    await vePump.connect(user1).claimRewardWeekly(1, 50)
    await vePump.connect(user1).split(1, parseEther("10"))

    const lockedInfoOriginNft = await vePump.lockedInfo(1)
    const lockedInfoSplit = await vePump.lockedInfo(3)
    const lockPeriodSplit = lockedInfoSplit.lockPeriod
    expect(await vePump.votingPowerValid(1)).to.be.true
    expect(await vePump.votingPowerValid(3)).to.be.true
    expect(lockedInfoOriginNft.amount).to.equal(parseEther("60"))
    expect(lockedInfoSplit.amount).to.equal(parseEther("10"))
    expect(lockedInfoSplit.unlockTime).to.equal(lockedInfoAfter.unlockTime)
    expect(await vePump.votingPowerOf(1)).closeTo(
      parseEther("60") * lockPeriodSplit / BigInt(208 * 7 * 86400), parseEther("0.0001")
    )
    expect(await vePump.votingPowerOf(3)).closeTo(
      parseEther("10") * lockPeriodSplit / BigInt(208 * 7 * 86400), parseEther("0.0001")
    )

    console.log(`${await getCurrentTimeString()} User 1 split NFT #1 -> NFT #1 + NFT #3`)
    console.log(`${await viewLockedInfo(vePump, 1)}`)
    console.log(`${await viewLockedInfo(vePump, 3)}`)


    // ============ [Timestamp] Week 12 Day 2 17:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(12, 2, 17))
    expect(await vePump.votingPowerValid(2)).to.be.false
    expect(await vePump.votingPowerOf(2))
      .to.closeTo(parseEther("4.80769"), parseEther("0.0001"))

    await vePump.connect(user2).claimRewardWeekly(2, 50)
    await vePump.connect(user2).burn(2)
    await expect(vePump.connect(user2).burn(2))
      .to.be.revertedWith("Already burnt")

    expect(await vePump.votingPowerValid(2)).to.be.false
    expect(await vePump.votingPowerOf(2)).to.be.equal(0)

    console.log(`${await getCurrentTimeString()} User 2 burn NFT #2`)
    console.log(`${await viewLockedInfo(vePump, 2)}`)

  })

})
