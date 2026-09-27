// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";

/// @notice Native-ETH sell taxes subsidize later exact-input buys in the same pool.
/// @dev No owner, token custody, external swap, identity attribution or withdrawal interface.
contract AsymmetricTaxHook {
    using PoolIdLibrary for PoolKey;

    uint256 public constant SELL_TAX_BPS = 200;
    uint256 public constant BUY_BONUS_BPS = 100;
    uint256 private constant BPS = 10_000;
    // PoolManager calls before/after synchronously, with no external calls between them other
    // than this hook. This hook calls only mint/burn, which cannot call another swap.
    bytes32 private constant EXPECTED_SPECIFIED = keccak256("oneway.expectedSpecified");

    IPoolManager public immutable poolManager;
    mapping(PoolId poolId => uint256 ethClaims) public pot;

    error NotPoolManager();
    error InvalidPoolManager();
    error AmountTooLarge();
    error PartialFill();

    event SellTaxed(PoolId indexed poolId, uint256 ethLeg, uint256 tax);
    event BuyBonus(PoolId indexed poolId, uint256 input, uint256 bonus);

    constructor(IPoolManager manager) {
        if (address(manager) == address(0)) revert InvalidPoolManager();
        poolManager = manager;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    /// @notice ETH added to an exact-input buy, capped by that pool's pot.
    /// @dev Division first avoids overflow even for arbitrary uint256 quote inputs.
    function bonusFor(PoolId poolId, uint256 input) public view returns (uint256) {
        uint256 desired = input / (BPS / BUY_BONUS_BPS);
        uint256 available = pot[poolId];
        return desired < available ? desired : available;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (Currency.unwrap(key.currency0) != address(0)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDelta.wrap(0), 0);
        }

        int256 specified = params.amountSpecified;
        // v4's BalanceDelta legs are int128. Reject unrepresentable full fills before
        // calculating absolute values, rates, or returning a narrowing conversion.
        _checkAmount(specified);
        PoolId poolId = key.toId();
        int128 adjustment = 0;
        if (params.zeroForOne && specified < 0) {
            uint256 input = uint256(-specified);
            uint256 bonus = bonusFor(poolId, input);
            if (bonus != 0) {
                pot[poolId] -= bonus;
                // Burn creates a positive hook ETH delta, cancelling the negative returned
                // delta. No native ETH needs to exist in the pool before the router settles.
                poolManager.burn(address(this), 0, bonus);
                adjustment = -int128(int256(bonus));
            }
            emit BuyBonus(poolId, input, bonus);
        } else if (!params.zeroForOne && specified > 0) {
            uint256 ethLeg = uint256(specified);
            uint256 tax = ethLeg / (BPS / SELL_TAX_BPS);
            _accrue(poolId, tax);
            adjustment = int128(int256(tax));
            emit SellTaxed(poolId, ethLeg, tax);
        }

        int256 expected = specified + adjustment;
        _checkAmount(expected);
        bytes32 slot = EXPECTED_SPECIFIED;
        assembly ("memory-safe") {
            tstore(slot, expected)
        }
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(adjustment, 0), 0);
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        if (Currency.unwrap(key.currency0) != address(0)) {
            return (IHooks.afterSwap.selector, 0);
        }

        bytes32 slot = EXPECTED_SPECIFIED;
        int256 expected;
        assembly ("memory-safe") {
            expected := tload(slot)
            tstore(slot, 0)
        }
        int128 filled = (params.amountSpecified < 0) == params.zeroForOne ? delta.amount0() : delta.amount1();
        if (int256(filled) != expected) revert PartialFill();

        if (!params.zeroForOne && params.amountSpecified < 0) {
            // ETH is the unspecified output leg. Charge against what the AMM actually moved.
            uint256 ethLeg = uint256(int256(delta.amount0()));
            uint256 tax = ethLeg / (BPS / SELL_TAX_BPS);
            PoolId poolId = key.toId();
            _accrue(poolId, tax);
            emit SellTaxed(poolId, ethLeg, tax);
            return (IHooks.afterSwap.selector, int128(int256(tax)));
        }
        return (IHooks.afterSwap.selector, 0);
    }

    function _accrue(PoolId poolId, uint256 tax) private {
        if (tax == 0) return;
        pot[poolId] += tax;
        // Mint creates a negative hook ETH delta, cancelled by its positive fee delta.
        poolManager.mint(address(this), 0, tax);
    }

    function _checkAmount(int256 amount) private pure {
        if (amount > type(int128).max || amount < -int256(type(int128).max)) revert AmountTooLarge();
    }
}
