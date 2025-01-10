import "dotenv/config"
import { deployUpgradeableContract } from "./utils"

async function main() {
  await deployUpgradeableContract("MockPump", [], true)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

