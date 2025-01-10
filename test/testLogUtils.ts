import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { formatEther } from "ethers"
import { VotingEscrowPump } from "../typechain-types"

export const RESET = "\x1b[0m"
export const GREEN = "\x1b[32m"
export const YELLOW = "\x1b[33m"
export const BLUEE = "\x1b[34m"

function getTimestamp(date: string) {
  return new Date(`${date} UTC+0`).getTime() / 1e3
}

function getDuration(week: number, day: number = 0, hour: number = 0, minute: number = 0, second: number = 0) {
  const [WEEK, DAY, HOUR, MINUTE, SECOND] = [86400 * 7, 86400, 3600, 60, 1]
  return week * WEEK + day * DAY + hour * HOUR + minute * MINUTE + second * SECOND
}

function getTimeString(timestamp: number | bigint, useColor: boolean = true) {
  const timeStringRaw = (new Date(Number(timestamp) * 1000)).toISOString().slice(0, 19).replace('T', ' ')
  return `${useColor ? '[' + BLUEE : ''}${timeStringRaw}${useColor ? RESET + ']' : ''}`
}

async function getCurrentTimeString(useColor: boolean = true) {
  return getTimeString(await time.latest(), useColor)
}

async function viewLockedInfo(vePump: VotingEscrowPump, tokenId: number) {
  const lockedInfo = await vePump.lockedInfo(tokenId)
  return `\tLocked info of NFT ${GREEN}#${tokenId}${RESET}: ` + 
    `amount = ${GREEN}${formatEther(lockedInfo.amount)}${RESET}, ` +
    `unlockTime = ${GREEN}${getTimeString(lockedInfo.unlockTime, false)}${RESET}, ` +
    `lockPeriod = ${GREEN}${Number(lockedInfo.lockPeriod) / (86400 * 7)} weeks${RESET}, ` +
    `\n\t           weekCursor = ${GREEN}${getTimeString(lockedInfo.weekCursor, false)}${RESET}, ` +
    `votingPower = ${GREEN}${formatEther(lockedInfo.votingPower)}${RESET}, ` +
    `burnt = ${GREEN}${lockedInfo.burnt}${RESET}`
}

async function viewTotalVotingPower(vePump: VotingEscrowPump) {
  return `Total voting power: ${GREEN}${formatEther(await vePump.totalVotingPower())}${RESET}`
}

export { 
  getTimestamp, 
  getDuration, 
  getTimeString, 
  getCurrentTimeString, 
  viewLockedInfo, 
  viewTotalVotingPower,
}
