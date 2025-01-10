// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev This contract is only for testing purposes.
 *  The token issued by this contract can be used for testing the 
 *   reward mechanism of the VotingEscrowPump contract.
 */
contract SimpleERC20 is ERC20 {

    uint8 private immutable _DECIMALS;

    constructor(
        string memory _name, 
        string memory _symbol, 
        uint8 _decimals,
        uint256 _initialSupply
    ) ERC20(_name, _symbol) {
        _mint(msg.sender, _initialSupply);
        _DECIMALS = _decimals;
    }

    function decimals() public view override returns (uint8) {
        return _DECIMALS;
    }

}
