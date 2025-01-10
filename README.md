# VotingEscrowPump

This is a voting escrow contract for $PUMP token, called `VotingEscrowPump`.

<br>

## Deploy contracts

### 1. Prepare environment

Copy `.env.example` to `.env` and fill in the values:

```bash
# cp .env.example .env
RPC_ETHEREUM=""  
RPC_SEPOLIA=""

ETHERSCAN_API_KEY=""

ADMIN_PK=""
DISTRIBUTOR_ADDRESS=""
```

The `ETHERSCAN_API_KEY` is optional, but it's recommended to set it up for easier verification.

### 2. Compile and test

Run `npx hardhat compile` to compile the contracts, and `npx hardhat test` to run the tests.

### 3. Deploy contracts

Prepare some gas tokens for the admin's wallet, and then deploy the contracts:

- **Deploy on Ethereum Sepolia Testnet**: Deploy a mock $PUMP token first, then deploy `VotingEscrowPump` with the mock $PUMP token address.
  ```bash
  npx hardhat run scripts/deploy-mockpump.ts --network sepolia
  # copy the $mPUMP token address into .env
  npx hardhat run scripts/deploy-vepump.ts --network sepolia
  ```

- **Deploy on Ethereum Mainnet**: Deploy a real $PUMP token first and fill in the address into `.env`, then deploy `VotingEscrowPump` with the real $PUMP token address.
  ```bash
  npx hardhat run scripts/deploy-vepump.ts --network mainnet
  ```

- **Upgrade contracts**: Upgrade the `VotingEscrowPump` contract with the new implementation. You need to fill in the $vePUMP token address into `.env` first.

  ```bash
  npx hardhat run scripts/upgrade.ts --network sepolia  # for Sepolia
  npx hardhat run scripts/upgrade.ts --network mainnet  # for Mainnet
  ```

<br>

## Test Coverage

Run `npx hardhat coverage` to check the test coverage.

File                   |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
-----------------------|----------|----------|----------|----------|----------------|
 contracts/            |      100 |    62.82 |      100 |      100 |                |
  VotingEscrowPump.sol |      100 |    62.82 |      100 |      100 |                |
  WeekMath.sol         |      100 |      100 |      100 |      100 |                |
 contracts/mock/       |      100 |      100 |      100 |      100 |                |
  MockPump.sol         |      100 |      100 |      100 |      100 |                |
  SimpleERC20.sol      |      100 |      100 |      100 |      100 |                |
All files              |      100 |    64.63 |      100 |      100 |                |