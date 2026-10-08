// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVladToken} from "./interfaces/IVladToken.sol";
import {IStellarPool} from "./interfaces/IStellarPool.sol";

/// @title StellarBank
/// @author Vladimir Radev
/// @notice Credit-distribution bank: VLAD savings earn minted simple interest; ETH collateral backs VLAD credit lines.
/// @dev Price = StellarPool AMM spot with a same-block guard. Demo oracle; production would use Chainlink/TWAP.
contract StellarBank is Ownable, ReentrancyGuard {
    using SafeERC20 for IVladToken;

    uint256 public constant LTV_BPS = 5000;
    uint256 public constant LIQ_THRESHOLD_BPS = 7500;
    uint256 public constant LIQ_BONUS_BPS = 1000;
    uint256 public constant YEAR = 365 days;

    IVladToken public immutable vlad;
    IStellarPool public immutable pool;
    uint256 public savingsRateBps;
    uint256 public borrowRateBps;

    struct Savings {
        uint256 principal;
        uint256 lastAccrued;
    }

    struct Loan {
        uint256 collateralEth;
        uint256 principal;
        uint256 lastAccrued;
    }

    mapping(address => Savings) public savings;
    mapping(address => Loan) public loans;
    address[] public borrowers;
    mapping(address => bool) public isBorrower;

    event SavingsDeposited(address indexed user, uint256 amount);
    event SavingsWithdrawn(address indexed user, uint256 amount);
    event InterestAccrued(address indexed user, uint256 interest);
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event Liquidated(address indexed borrower, address indexed liquidator, uint256 debtRepaid, uint256 ethSeized);
    event RatesUpdated(uint256 savingsRateBps, uint256 borrowRateBps);

    error ZeroAmount();
    error InsufficientLiquidity();
    error InsufficientSavings();
    error ExceedsLtv();
    error Healthy();
    error NoLiquidityInPool();
    error SameBlockPriceUpdate();
    error EthTransferFailed();
    error InsufficientCollateral();
    error NoDebt();

    constructor(IVladToken vlad_, IStellarPool pool_, uint256 savingsBps, uint256 borrowBps) Ownable(msg.sender) {
        vlad = vlad_;
        pool = pool_;
        savingsRateBps = savingsBps;
        borrowRateBps = borrowBps;
        emit RatesUpdated(savingsBps, borrowBps);
    }

    // ---------------------------------------------------------------- savings

    function depositSavings(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _accrueSavings(msg.sender);
        savings[msg.sender].principal += amount;
        emit SavingsDeposited(msg.sender, amount);
        vlad.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @param amount VLAD to withdraw; `type(uint256).max` withdraws principal plus all accrued interest.
    function withdrawSavings(uint256 amount) external nonReentrant {
        _accrueSavings(msg.sender);
        Savings storage s = savings[msg.sender];
        if (amount == type(uint256).max) amount = s.principal;
        if (amount == 0) revert ZeroAmount();
        if (amount > s.principal) revert InsufficientSavings();
        if (vlad.balanceOf(address(this)) < amount) revert InsufficientLiquidity();
        s.principal -= amount;
        emit SavingsWithdrawn(msg.sender, amount);
        vlad.safeTransfer(msg.sender, amount);
    }

    // ----------------------------------------------------------------- credit

    function depositCollateral() external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        if (!isBorrower[msg.sender]) {
            isBorrower[msg.sender] = true;
            borrowers.push(msg.sender);
        }
        loans[msg.sender].collateralEth += msg.value;
        emit CollateralDeposited(msg.sender, msg.value);
    }

    /// @dev Price (and the same-block guard) is only consulted when the caller has debt.
    function withdrawCollateral(uint256 eth) external nonReentrant {
        if (eth == 0) revert ZeroAmount();
        _accrueLoan(msg.sender);
        Loan storage l = loans[msg.sender];
        if (eth > l.collateralEth) revert InsufficientCollateral();
        l.collateralEth -= eth;
        if (l.principal > 0 && l.principal > _value(l.collateralEth, _requireFreshPrice()) * LTV_BPS / 1e4) {
            revert ExceedsLtv();
        }
        emit CollateralWithdrawn(msg.sender, eth);
        _sendEth(msg.sender, eth);
    }

    function borrow(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 price = _requireFreshPrice();
        _accrueLoan(msg.sender);
        Loan storage l = loans[msg.sender];
        if (l.principal + amount > _value(l.collateralEth, price) * LTV_BPS / 1e4) revert ExceedsLtv();
        if (vlad.balanceOf(address(this)) < amount) revert InsufficientLiquidity();
        l.principal += amount;
        emit Borrowed(msg.sender, amount);
        vlad.safeTransfer(msg.sender, amount);
    }

    /// @param amount VLAD to repay; anything above the debt (e.g. `type(uint256).max`) repays it all.
    /// @dev Repaid interest stays in the bank as lending liquidity.
    function repay(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _accrueLoan(msg.sender);
        Loan storage l = loans[msg.sender];
        if (l.principal == 0) revert NoDebt();
        if (amount > l.principal) amount = l.principal;
        l.principal -= amount;
        emit Repaid(msg.sender, amount);
        vlad.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Repay a borrower's whole debt and seize debt * 110% worth of ETH (capped at the collateral).
    function liquidate(address borrower) external nonReentrant {
        uint256 price = _requireFreshPrice();
        _accrueLoan(borrower);
        Loan storage l = loans[borrower];
        uint256 debt = l.principal;
        if (debt == 0) revert NoDebt();
        if (_health(l.collateralEth, debt, price) >= 1e18) revert Healthy();
        uint256 seize = debt * (1e4 + LIQ_BONUS_BPS) / 1e4 * 1e18 / price;
        if (seize > l.collateralEth) seize = l.collateralEth;
        l.principal = 0;
        l.collateralEth -= seize;
        emit Liquidated(borrower, msg.sender, debt, seize);
        vlad.safeTransferFrom(msg.sender, address(this), debt);
        _sendEth(msg.sender, seize);
    }

    function setRates(uint256 savingsBps, uint256 borrowBps) external onlyOwner {
        savingsRateBps = savingsBps;
        borrowRateBps = borrowBps;
        emit RatesUpdated(savingsBps, borrowBps);
    }

    // ------------------------------------------------------------------ views

    /// @notice VLAD (18 dec) per 1 ETH, scaled 1e18, from the pool's spot reserves.
    function ethPrice() public view returns (uint256) {
        (uint256 ethReserve, uint256 vladReserve) = pool.getReserves();
        if (ethReserve == 0 || vladReserve == 0) revert NoLiquidityInPool();
        return vladReserve * 1e18 / ethReserve;
    }

    function savingsBalanceOf(address u) public view returns (uint256) {
        Savings memory s = savings[u];
        return s.principal + _interest(s.principal, savingsRateBps, s.lastAccrued);
    }

    function debtOf(address u) public view returns (uint256) {
        Loan memory l = loans[u];
        return l.principal + _interest(l.principal, borrowRateBps, l.lastAccrued);
    }

    function collateralValueOf(address u) public view returns (uint256) {
        return _value(loans[u].collateralEth, ethPrice());
    }

    function maxBorrowOf(address u) external view returns (uint256) {
        return collateralValueOf(u) * LTV_BPS / 1e4;
    }

    /// @notice 1e18 = liquidation boundary; `type(uint256).max` when there is no debt.
    function healthFactorOf(address u) external view returns (uint256) {
        uint256 debt = debtOf(u);
        return debt == 0 ? type(uint256).max : _health(loans[u].collateralEth, debt, ethPrice());
    }

    function availableLiquidity() external view returns (uint256) {
        return vlad.balanceOf(address(this));
    }

    function borrowersCount() external view returns (uint256) {
        return borrowers.length;
    }

    // --------------------------------------------------------------- internal

    function _accrueSavings(address u) internal {
        Savings storage s = savings[u];
        uint256 interest = _interest(s.principal, savingsRateBps, s.lastAccrued);
        s.lastAccrued = block.timestamp;
        if (interest > 0) {
            s.principal += interest;
            emit InterestAccrued(u, interest);
            vlad.mint(address(this), interest);
        }
    }

    function _accrueLoan(address u) internal {
        Loan storage l = loans[u];
        l.principal += _interest(l.principal, borrowRateBps, l.lastAccrued);
        l.lastAccrued = block.timestamp;
    }

    function _requireFreshPrice() internal view returns (uint256) {
        if (pool.lastUpdateBlock() >= block.number) revert SameBlockPriceUpdate();
        return ethPrice();
    }

    function _interest(uint256 principal, uint256 rateBps, uint256 since) internal view returns (uint256) {
        return principal * rateBps * (block.timestamp - since) / (YEAR * 1e4);
    }

    function _value(uint256 eth, uint256 price) internal pure returns (uint256) {
        return eth * price / 1e18;
    }

    function _health(uint256 eth, uint256 debt, uint256 price) internal pure returns (uint256) {
        return _value(eth, price) * LIQ_THRESHOLD_BPS * 1e18 / (debt * 1e4);
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
