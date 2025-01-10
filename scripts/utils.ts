import { ethers, upgrades } from "hardhat"

export const RESET = "\x1b[0m"
export const GREEN = "\x1b[32m"
export const YELLOW = "\x1b[33m"
export const BLUEE = "\x1b[34m"
export const GRAY = "\x1b[90m"

export async function deployContract(contractName: string, args: any[] = [], verbose: boolean = false) {
  const contractFactory = await ethers.getContractFactory(contractName)
  const contract = await contractFactory.deploy(...args)
  if (verbose)
    console.log(`${contractName} deployed to: ${GREEN}${await contract.getAddress()}${RESET}`)
  return contract
}

export async function deployUpgradeableContract(contractName: string, args: any[] = [], verbose: boolean = false) {
  const contractFactory = await ethers.getContractFactory(contractName)
  const contract = await upgrades.deployProxy(contractFactory, args)
  if (verbose)
    console.log(`${contractName}(upgradeable) deployed to: ${GREEN}${await contract.getAddress()}${RESET}`)
  return contract
}

export async function upgradeContract(proxyContractAddress: string, newContractName: string, verbose: boolean = false) {
  const newContractFactory = await ethers.getContractFactory(newContractName)
  const newContract = await upgrades.upgradeProxy(proxyContractAddress, newContractFactory)
  if (verbose)
    console.log(`${newContractName}(upgradeable) upgraded to: ${GREEN}${await newContract.getAddress()}${RESET}`)
  return newContract
}
