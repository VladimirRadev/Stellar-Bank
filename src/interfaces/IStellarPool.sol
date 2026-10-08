// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IStellarPool {
    function getReserves() external view returns (uint256 ethReserve, uint256 vladReserve);
    function lastUpdateBlock() external view returns (uint256);
}
