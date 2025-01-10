import "dotenv/config"
import { deployUpgradeableContract, GREEN, RESET } from "./utils"
import { VotingEscrowPump } from "../typechain-types";
import { ethers } from "hardhat";

async function main() {
  const mockPumpAddress = process.env.PUMP_TOKEN_ADDRESS!
  const vepump = <any>(await deployUpgradeableContract(
    "VotingEscrowPump", [mockPumpAddress], true
  )) as VotingEscrowPump

  // If the VotingEscrowPump is already deployed, replace the above lines with the nexts line:
  // const vepump = await ethers.getContractAt("VotingEscrowPump", process.env.VEPUMP_ADDRESS!)
  
  await vepump.setRewardDistributor(process.env.DISTRIBUTOR_ADDRESS!, true)
  console.log(`Reward distributor set to: ${GREEN}${process.env.DISTRIBUTOR_ADDRESS!}${RESET}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

