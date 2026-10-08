// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {StellarBank} from "../src/StellarBank.sol";
import {IVladToken} from "../src/interfaces/IVladToken.sol";
import {IStellarPool} from "../src/interfaces/IStellarPool.sol";

/// @notice Deploys StellarBank (10% savings APR, 20% borrow APR) and grants it MINTER_ROLE on VLAD (2 transactions).
/// @dev Env: PRIVATE_KEY (must hold DEFAULT_ADMIN_ROLE on VLAD), VLAD_TOKEN, STELLAR_POOL. Never hard-code keys.
/// @dev Run with `--broadcast --slow --skip-simulation` (README "Deploy"): Sepolia prices contract creation far above
///      the local Cancun simulation, and the EIP-7702-delegated deployer accepts one in-flight tx at a time.
contract Deploy is Script {
    uint256 internal constant SAVINGS_BPS = 1000;
    uint256 internal constant BORROW_BPS = 2000;

    function run() external returns (StellarBank bank) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        IVladToken vlad = IVladToken(vm.envAddress("VLAD_TOKEN"));
        IStellarPool pool = IStellarPool(vm.envAddress("STELLAR_POOL"));
        require(address(vlad).code.length > 0, "VLAD_TOKEN has no code");
        require(address(pool).code.length > 0, "STELLAR_POOL has no code");
        bytes32 minterRole = vlad.MINTER_ROLE();

        vm.startBroadcast(deployerKey);
        bank = new StellarBank(vlad, pool, SAVINGS_BPS, BORROW_BPS); // tx 1
        vlad.grantRole(minterRole, address(bank)); // tx 2
        vm.stopBroadcast();

        require(vlad.hasRole(minterRole, address(bank)), "bank is not a VLAD minter");
        console.log("Deployer    :", vm.addr(deployerKey));
        console.log("StellarBank :", address(bank));
    }
}
