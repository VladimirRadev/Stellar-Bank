// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Test stand-in for StellarPool: reserves and the last-update block are set directly by the test.
contract MockPool {
    uint256 public ethReserve;
    uint256 public vladReserve;
    uint256 public lastUpdateBlock;

    function setReserves(uint256 e, uint256 v) external {
        ethReserve = e;
        vladReserve = v;
    }

    function setLastUpdateBlock(uint256 b) external {
        lastUpdateBlock = b;
    }

    function getReserves() external view returns (uint256, uint256) {
        return (ethReserve, vladReserve);
    }
}
