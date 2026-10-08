// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVladToken is IERC20 {
    function MINTER_ROLE() external view returns (bytes32);
    function mint(address to, uint256 amount) external;
    function grantRole(bytes32 role, address account) external;
    function hasRole(bytes32 role, address account) external view returns (bool);
}
