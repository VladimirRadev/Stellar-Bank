// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StellarBank} from "../src/StellarBank.sol";
import {IVladToken} from "../src/interfaces/IVladToken.sol";
import {IStellarPool} from "../src/interfaces/IStellarPool.sol";
import {MockVlad} from "./mocks/MockVlad.sol";
import {MockPool} from "./mocks/MockPool.sol";

contract StellarBankTest is Test {
    StellarBank bank;
    MockVlad vlad;
    MockPool pool;

    address alice = makeAddr("alice"); // saver / lender
    address bob = makeAddr("bob"); // borrower
    address carol = makeAddr("carol"); // liquidator

    event InterestAccrued(address indexed user, uint256 interest);
    event Liquidated(address indexed borrower, address indexed liquidator, uint256 debtRepaid, uint256 ethSeized);

    function setUp() public {
        vlad = new MockVlad();
        pool = new MockPool();
        pool.setReserves(100 ether, 200_000e18); // 1 ETH = 2,000 VLAD
        bank = new StellarBank(IVladToken(address(vlad)), IStellarPool(address(pool)), 1000, 2000);
        vlad.grantRole(vlad.MINTER_ROLE(), address(bank));

        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < users.length; i++) {
            vlad.mint(users[i], 100_000e18);
            vm.deal(users[i], 100 ether);
            vm.prank(users[i]);
            vlad.approve(address(bank), type(uint256).max);
        }
    }

    function _lend(uint256 amount) internal {
        vm.prank(alice);
        bank.depositSavings(amount);
    }

    function _collateralAndBorrow(uint256 eth, uint256 amount) internal {
        vm.startPrank(bob);
        bank.depositCollateral{value: eth}();
        bank.borrow(amount);
        vm.stopPrank();
    }

    function test_SavingsAccrueMintedInterest() public {
        _lend(1000e18);
        uint256 supplyBefore = vlad.totalSupply();

        vm.warp(block.timestamp + 365 days);
        assertEq(bank.savingsBalanceOf(alice), 1100e18, "10% APR after one year");

        vm.expectEmit(address(bank));
        emit InterestAccrued(alice, 100e18);
        vm.prank(alice);
        bank.withdrawSavings(100e18);

        assertEq(vlad.totalSupply(), supplyBefore + 100e18, "interest minted");
        assertEq(vlad.balanceOf(address(bank)), 1000e18, "minted to the bank, then 100 paid out");
        (uint256 principal,) = bank.savings(alice);
        assertEq(principal, 1000e18);

        vm.prank(alice);
        bank.withdrawSavings(type(uint256).max);
        assertEq(vlad.balanceOf(alice), 100_100e18, "deposit + interest returned");
        assertEq(bank.savingsBalanceOf(alice), 0);
    }

    function test_BorrowUpToLtvAndRevertBeyond() public {
        _lend(10_000e18);
        _collateralAndBorrow(1 ether, 1000e18); // 50% of 2,000 VLAD
        assertEq(bank.debtOf(bob), 1000e18);
        assertEq(vlad.balanceOf(bob), 101_000e18);

        vm.prank(bob);
        vm.expectRevert(StellarBank.ExceedsLtv.selector);
        bank.borrow(1);
    }

    function test_BorrowWithoutLiquidityReverts() public {
        vm.startPrank(bob);
        bank.depositCollateral{value: 1 ether}();
        vm.expectRevert(StellarBank.InsufficientLiquidity.selector);
        bank.borrow(500e18);
        vm.stopPrank();
    }

    function test_RepayIncludesInterestAndMaxRepaysAll() public {
        _lend(10_000e18);
        _collateralAndBorrow(1 ether, 1000e18);

        vm.warp(block.timestamp + 365 days);
        assertEq(bank.debtOf(bob), 1200e18, "20% APR after one year");

        vm.prank(bob);
        bank.repay(200e18);
        assertEq(bank.debtOf(bob), 1000e18);

        vm.prank(bob);
        bank.repay(type(uint256).max);
        assertEq(bank.debtOf(bob), 0);
        assertEq(vlad.balanceOf(address(bank)), 10_200e18, "interest stays as liquidity");

        vm.prank(bob);
        vm.expectRevert(StellarBank.NoDebt.selector);
        bank.repay(1);
    }

    function test_WithdrawCollateralRespectsLtv() public {
        _lend(10_000e18);
        _collateralAndBorrow(2 ether, 1000e18); // capacity 2,000 VLAD

        vm.startPrank(bob);
        vm.expectRevert(StellarBank.ExceedsLtv.selector);
        bank.withdrawCollateral(1.5 ether); // 0.5 ETH -> capacity 500 < 1,000 debt

        vm.expectRevert(StellarBank.InsufficientCollateral.selector);
        bank.withdrawCollateral(3 ether);

        uint256 ethBefore = bob.balance;
        bank.withdrawCollateral(1 ether); // 1 ETH -> capacity 1,000 == debt
        vm.stopPrank();

        assertEq(bob.balance, ethBefore + 1 ether);
        (uint256 collateral,,) = bank.loans(bob);
        assertEq(collateral, 1 ether);
    }

    function test_LiquidateSeizesWithBonusAndLeavesRemainder() public {
        _lend(10_000e18);
        _collateralAndBorrow(1 ether, 1000e18);

        vm.prank(carol);
        vm.expectRevert(StellarBank.Healthy.selector);
        bank.liquidate(bob);

        pool.setReserves(100 ether, 120_000e18); // 1 ETH = 1,200 VLAD -> health 0.9
        assertEq(bank.healthFactorOf(bob), 0.9e18);

        uint256 seize = uint256(1100e18) * 1e18 / 1200e18; // debt * 110% / price
        uint256 carolEth = carol.balance;
        vm.expectEmit(address(bank));
        emit Liquidated(bob, carol, 1000e18, seize);
        vm.prank(carol);
        bank.liquidate(bob);

        assertEq(carol.balance, carolEth + seize);
        assertEq(vlad.balanceOf(carol), 99_000e18, "liquidator paid the full debt");
        assertEq(bank.debtOf(bob), 0);
        (uint256 collateral,,) = bank.loans(bob);
        assertEq(collateral, 1 ether - seize, "remainder stays with the borrower");

        uint256 bobEth = bob.balance;
        vm.prank(bob);
        bank.withdrawCollateral(collateral);
        assertEq(bob.balance, bobEth + collateral);
    }

    function test_SameBlockGuardBlocksBorrowAndLiquidate() public {
        _lend(10_000e18);
        _collateralAndBorrow(1 ether, 500e18);

        pool.setLastUpdateBlock(block.number);
        vm.prank(bob);
        vm.expectRevert(StellarBank.SameBlockPriceUpdate.selector);
        bank.borrow(100e18);

        pool.setReserves(100 ether, 60_000e18); // 1 ETH = 600 VLAD -> health 0.9
        vm.prank(carol);
        vm.expectRevert(StellarBank.SameBlockPriceUpdate.selector);
        bank.liquidate(bob);

        vm.roll(block.number + 1);
        vm.prank(carol);
        bank.liquidate(bob);
        assertEq(bank.debtOf(bob), 0);
    }

    function test_Views() public {
        assertEq(bank.ethPrice(), 2000e18);
        assertEq(bank.healthFactorOf(bob), type(uint256).max, "no debt");

        _lend(10_000e18);
        _collateralAndBorrow(1 ether, 500e18);
        vm.prank(bob);
        bank.depositCollateral{value: 1 ether}();

        assertEq(bank.collateralValueOf(bob), 4000e18);
        assertEq(bank.maxBorrowOf(bob), 2000e18);
        assertEq(bank.healthFactorOf(bob), 6e18); // 4,000 * 75% / 500
        assertEq(bank.availableLiquidity(), 9500e18);
        assertEq(bank.borrowersCount(), 1);
        assertEq(bank.borrowers(0), bob);

        pool.setReserves(0, 0);
        vm.expectRevert(StellarBank.NoLiquidityInPool.selector);
        bank.ethPrice();
    }
}
