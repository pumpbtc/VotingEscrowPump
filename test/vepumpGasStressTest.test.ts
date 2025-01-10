import { expect } from "chai"
import { ethers } from "hardhat"
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { deployUpgradeableContract, RESET, YELLOW, deployContract } from "../scripts/utils"
import { MockPump, SimpleERC20, VotingEscrowPump } from "../typechain-types"
import { formatEther, formatUnits, parseEther, parseUnits } from "ethers"

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
    const btcb = await deployContract("SimpleERC20", [
      "BTCB", "BTCB", 18, parseUnits("1000000", 18)
    ]) as SimpleERC20
    const usdc = await deployContract("SimpleERC20", [
      "USDC", "USDC", 6, parseUnits("1000000", 6)
    ]) as SimpleERC20
    const usdt = await deployContract("SimpleERC20", [
      "USDT", "USDT", 6, parseUnits("1000000", 6)
    ]) as SimpleERC20
    return { pump, vePump, wbtc, btcb, usdc, usdt }
  }


  it("should pass stress test for gas usage when claim reward", async function () {
    const { pump, vePump, wbtc } = await loadFixture(deployContracts)
    const [admin, distributor, user1, user2] = await ethers.getSigners()

    const genesisTimestamp = Number(await vePump.getCurrentNextWeekStart())
    let votingPowerUser1, votingPowerUser2, currentWeekCursor, nextWeekCursor

    // Distribute tokens
    await pump.connect(admin).transfer(user1.address, parseEther("1000000"))
    await pump.connect(admin).transfer(user2.address, parseEther("1000000"))
    await wbtc.connect(admin).transfer(distributor.address, parseUnits("400", 8))

    // Approve tokens
    await pump.connect(user1).approve(await vePump.getAddress(), parseEther("1000000"))
    await pump.connect(user2).approve(await vePump.getAddress(), parseEther("1000000"))
    await wbtc.connect(distributor).approve(await vePump.getAddress(), parseUnits("400", 8))

    // Set reward distributor and token
    await vePump.connect(admin).setRewardDistributor(distributor.address, true)
    await vePump.connect(admin).addRewardToken(await wbtc.getAddress())


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
      user1.address, parseEther("50"), getDuration(208, 0, 0)
    )     // Lock 50 $PUMP for 208 weeks
    expect(await vePump.ownerOf(0)).to.equal(user1.address)

    votingPowerUser1 = await vePump.votingPowerOf(0)
    expect(votingPowerUser1).to.closeTo(
      parseEther("50"), parseEther("0.001"),
    )

    console.log(`${await getCurrentTimeString()} User 1 mint $vePUMP[tokenId=0]`)
    console.log(`${await viewLockedInfo(vePump, 0)}`)


    // ============ [Timestamp] Week 1 ~ Week 200 ============
    for (let i = 1; i <= 200; i++) {

      // ============ [Timestamp] Week i Day 0 00:00:00 ============
      await time.increaseTo(genesisTimestamp + getDuration(i, 0, 0))
      if (i % 50 === 0)
        console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week ${i}${RESET}] Start` +
          `(${await viewTotalVotingPower(vePump)})`)

      // ============ [Timestamp] Week i Day 0 01:00:00 ============
      await time.increaseTo(genesisTimestamp + getDuration(i, 0, 1))
      const rewardAmount = parseUnits(`${i}`, 8) / 100n
      nextWeekCursor = genesisTimestamp + getDuration(i + 1, 0, 0)

      await vePump.connect(distributor).depositRewardForNextWeek(
        await wbtc.getAddress(), rewardAmount,
      )
      expect(await vePump.rewardPerWeek(await wbtc.getAddress(), nextWeekCursor))
        .to.equal(rewardAmount)
      if (i % 50 === 0)
        console.log(`${await getCurrentTimeString()} Distribute ` +
          `${formatUnits(rewardAmount, 8)} $WBTC reward for next week`)
    }


    // ============ [Timestamp] Week 250 Day 0 00:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(250, 0, 0))
    console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week 250${RESET}] Start` +
      `(${await viewTotalVotingPower(vePump)})`)

    /**
     * Reward $WBTC for NFT #0:
     *  Week 0 end: 0.00 $WBTC
     *  Week 1 end: 0.01 $WBTC
     *  Week 2 end: 0.02 $WBTC
     *   ......
     *  Week i end: 0.01 * i $WBTC
     *   ......
     *  Week 200 end: 2.00 $WBTC
     * 
     * Total reward: 0.00 + 0.01 + 0.02 + ... + 2.00 = 201.00 $WBTC
     */
    for (var weeks of [50, 100, 150, 200]) {
      const gasLimit = await ethers.provider.estimateGas({
        from: user1.address,
        to: await vePump.getAddress(),
        data: vePump.interface.encodeFunctionData("claimRewardWeekly", [0, weeks]),
      })
      const gasCostUSD = formatEther(gasLimit * parseUnits("10", 9) * 3500n).slice(0, 5)
      console.log(`${await getCurrentTimeString()} Claim ${weeks} weeks of 1 token rewards: ` +
        `gas limit = ${gasLimit}, ≈ ${YELLOW}$${gasCostUSD}${RESET} when gas price = 10 GWei, ETH/USDT = 3500`)
    }
  })


  it("should pass stress test for gas usage when claim 4 tokens' reward", async function () {
    const { pump, vePump, wbtc, btcb, usdc, usdt } = await loadFixture(deployContracts)
    const [admin, distributor, user1, user2] = await ethers.getSigners()

    const genesisTimestamp = Number(await vePump.getCurrentNextWeekStart())
    let votingPowerUser1, votingPowerUser2, currentWeekCursor, nextWeekCursor

    // Distribute tokens
    await pump.connect(admin).transfer(user1.address, parseEther("1000000"))
    await pump.connect(admin).transfer(user2.address, parseEther("1000000"))
    await wbtc.connect(admin).transfer(distributor.address, parseUnits("400", 8))
    await btcb.connect(admin).transfer(distributor.address, parseUnits("400", 18))
    await usdc.connect(admin).transfer(distributor.address, parseUnits("100000", 6))
    await usdt.connect(admin).transfer(distributor.address, parseUnits("100000", 6))

    // Approve tokens
    await pump.connect(user1).approve(await vePump.getAddress(), parseEther("1000000"))
    await pump.connect(user2).approve(await vePump.getAddress(), parseEther("1000000"))
    await wbtc.connect(distributor).approve(await vePump.getAddress(), parseUnits("400", 8))
    await btcb.connect(distributor).approve(await vePump.getAddress(), parseUnits("400", 18))
    await usdc.connect(distributor).approve(await vePump.getAddress(), parseUnits("100000", 6))
    await usdt.connect(distributor).approve(await vePump.getAddress(), parseUnits("100000", 6))

    // Set reward distributor and token
    await vePump.connect(admin).setRewardDistributor(distributor.address, true)
    await vePump.connect(admin).addRewardToken(await wbtc.getAddress())
    await vePump.connect(admin).addRewardToken(await btcb.getAddress())
    await vePump.connect(admin).addRewardToken(await usdc.getAddress())
    await vePump.connect(admin).addRewardToken(await usdt.getAddress())


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
      user1.address, parseEther("50"), getDuration(208, 0, 0)
    )     // Lock 50 $PUMP for 208 weeks
    expect(await vePump.ownerOf(0)).to.equal(user1.address)

    votingPowerUser1 = await vePump.votingPowerOf(0)
    expect(votingPowerUser1).to.closeTo(
      parseEther("50"), parseEther("0.001"),
    )

    console.log(`${await getCurrentTimeString()} User 1 mint $vePUMP[tokenId=0]`)
    console.log(`${await viewLockedInfo(vePump, 0)}`)


    // ============ [Timestamp] Week 1 ~ Week 200 ============
    for (let i = 1; i <= 200; i++) {

      // ============ [Timestamp] Week i Day 0 00:00:00 ============
      await time.increaseTo(genesisTimestamp + getDuration(i, 0, 0))
      if (i % 50 === 0)
        console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week ${i}${RESET}] Start` +
          `(${await viewTotalVotingPower(vePump)})`)

      // ============ [Timestamp] Week i Day 0 01:00:00 ============
      await time.increaseTo(genesisTimestamp + getDuration(i, 0, 1))
      const rewardAmounts = [
        parseUnits(`${i}`, 8) / 100n,
        parseUnits(`${i}`, 18) / 100n,
        parseUnits(`${i}`, 6),
        parseUnits(`${i}`, 6),
      ]
      let decimals = [8, 18, 6, 6]
      let names = ["$WBTC", "$BTCB", "$USDC", "$USDT"]
      nextWeekCursor = genesisTimestamp + getDuration(i + 1, 0, 0)

      for (let j = 0; j < rewardAmounts.length; j++) {
        const token = (await vePump.getRewardTokens())[j]
        await vePump.connect(distributor).depositRewardForNextWeek(
          token, rewardAmounts[j],
        )
        expect(await vePump.rewardPerWeek(token, nextWeekCursor))
          .to.equal(rewardAmounts[j])

        if (i % 50 === 0)
          console.log(`${await getCurrentTimeString()} Distribute ` +
            `${formatUnits(rewardAmounts[j], decimals[j])} ${names[j]} reward for next week`)
      }
    }


    // ============ [Timestamp] Week 250 Day 0 00:00:00 ============
    await time.increaseTo(genesisTimestamp + getDuration(250, 0, 0))
    console.log(`\n${await getCurrentTimeString()} [${YELLOW}Week 250${RESET}] Start` +
      `(${await viewTotalVotingPower(vePump)})`)

    /**
     * Reward $WBTC for NFT #0:
     *  Week 0 end: 0.00 $WBTC, 0.00 $BTCB, 0 $USDC, 0 $USDT
     *  Week 1 end: 0.01 $WBTC, 0.01 $BTCB, 1 $USDC, 1 $USDT
     *  Week 2 end: 0.02 $WBTC, 0.02 $BTCB, 2 $USDC, 2 $USDT
     *   ......
     *  Week i end: 0.01 * i $WBTC, 0.01 * i $BTCB, i $USDC, i $USDT
     *   ......
     *  Week 200 end: 2.00 $WBTC, 2.00 $BTCB, 200 $USDC, 200 $USDT
     * 
     * Total reward: 201 $WBTC, 201 $BTCB, 20100 $USDC, 20100 $USDT
     */
    for (var weeks of [50, 100, 150, 200]) {
      const gasLimit = await ethers.provider.estimateGas({
        from: user1.address,
        to: await vePump.getAddress(),
        data: vePump.interface.encodeFunctionData("claimRewardWeekly", [0, weeks]),
      })
      const gasCostUSD = formatEther(gasLimit * parseUnits("10", 9) * 3500n).slice(0, 5)
      console.log(`${await getCurrentTimeString()} Claim ${weeks} weeks of 4 token rewards: ` +
        `gas limit = ${gasLimit}, ≈ ${YELLOW}$${gasCostUSD}${RESET} when gas price = 10 GWei, ETH/USDT = 3500`)
    }

    await vePump.connect(user1).claimReward(0, 205)
    expect(await wbtc.balanceOf(user1.address)).to.equal(parseUnits("201", 8))
    expect(await btcb.balanceOf(user1.address)).to.equal(parseUnits("201", 18))
    expect(await usdc.balanceOf(user1.address)).to.equal(parseUnits("20100", 6))
    expect(await usdt.balanceOf(user1.address)).to.equal(parseUnits("20100", 6))

  })


})
