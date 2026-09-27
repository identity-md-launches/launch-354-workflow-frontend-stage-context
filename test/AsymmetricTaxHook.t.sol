// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HookTestBase, HookDeployment} from "./helpers/HookTestBase.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {AsymmetricTaxHook} from "../src/AsymmetricTaxHook.sol";
import {ONEW} from "../src/ONEW.sol";
import {BatchSwapRouter} from "./helpers/BatchSwapRouter.sol";

contract AsymmetricTaxHookTest is HookTestBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function test_permissionsAndMinedAddress() public view {
        Hooks.Permissions memory p = hook.getHookPermissions();
        Hooks.Permissions memory expected;
        expected.beforeSwap = true;
        expected.afterSwap = true;
        expected.beforeSwapReturnDelta = true;
        expected.afterSwapReturnDelta = true;
        assertEq(abi.encode(p), abi.encode(expected));
        assertEq(uint160(address(hook)) & 0x3fff, 0x00cc);
        assertEq(address(hook.poolManager()), address(manager));
    }

    function test_constructorRejectsWrongAddressBits() public {
        bytes memory code = abi.encodePacked(type(AsymmetricTaxHook).creationCode, abi.encode(manager));
        bytes32 salt;
        address predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code)))))
        );
        assertTrue(uint160(predicted) & 0x3fff != 0xcc);
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, predicted));
        new AsymmetricTaxHook{salt: salt}(manager);
    }

    function test_constructorRejectsZeroManager() public {
        vm.expectRevert(AsymmetricTaxHook.InvalidPoolManager.selector);
        new AsymmetricTaxHook(IPoolManager(address(0)));
    }

    function test_callbacksRefuseNonManagerEvenForNonETHPools() public {
        SwapParams memory params = SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1);
        vm.expectRevert(AsymmetricTaxHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, params, "");
        vm.expectRevert(AsymmetricTaxHook.NotPoolManager.selector);
        hook.afterSwap(address(this), key, params, BalanceDelta.wrap(0), "");
        key.currency0 = Currency.wrap(address(1));
        vm.expectRevert(AsymmetricTaxHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, params, "");
        vm.expectRevert(AsymmetricTaxHook.NotPoolManager.selector);
        hook.afterSwap(address(this), key, params, BalanceDelta.wrap(0), "");
    }

    function test_exactInputSell() public {
        _sell(10 ether);
    }

    function test_exactOutputSell() public {
        _sellExactOutput(10 ether);
    }

    function _sellExactOutput(uint256 output) internal {
        uint256 tax = output / 50;
        uint256 beforePot = hook.pot(key.toId());
        BalanceDelta control = _swap(plain, false, int256(output + tax));
        uint256 beforeETH = address(this).balance;
        vm.expectEmit(true, false, false, true, address(hook));
        emit SellTaxed(key.toId(), output, tax);
        BalanceDelta taxed = _swap(key, false, int256(output));
        assertEq(int256(taxed.amount0()), int256(output), "specified ETH output honored");
        assertEq(address(this).balance - beforeETH, output);
        assertEq(int256(taxed.amount1()), int256(control.amount1()), "tokens pay for output plus tax");
        assertEq(hook.pot(key.toId()), beforePot + tax);
        _assertSamePoolState();
        _assertClaims();
    }

    function test_exactOutputBuyHasNoBonusOrFee() public {
        _sell(100 ether);
        _buyExactOutput(10 ether);
    }

    function _buyExactOutput(uint256 output) internal {
        uint256 beforePot = hook.pot(key.toId());
        BalanceDelta control = _swap(plain, true, int256(output));
        uint256 beforeETH = address(this).balance;
        uint256 beforeTokens = token.balanceOf(address(this));
        BalanceDelta bought = _swap(key, true, int256(output));
        assertEq(BalanceDelta.unwrap(bought), BalanceDelta.unwrap(control));
        assertEq(token.balanceOf(address(this)) - beforeTokens, output);
        assertEq(beforeETH - address(this).balance, uint256(-int256(control.amount0())));
        assertEq(hook.pot(key.toId()), beforePot);
        _assertSamePoolState();
        _assertClaims();
    }

    function test_bonusEmptyPot() public {
        _buy(10 ether);
    }

    function test_bonusSmallPotDrainsExactly() public {
        _sell(1 ether);
        assertGt(hook.pot(key.toId()), 0);
        assertLt(hook.pot(key.toId()), 10 ether / 100);
        _buy(10 ether);
        assertEq(hook.pot(key.toId()), 0);
        _buy(1 ether);
    }

    function test_bonusLargePotPaysExactlyOnePercent() public {
        _sell(100 ether);
        assertGt(hook.pot(key.toId()), 10 ether / 100);
        _buy(10 ether);
        assertGt(hook.pot(key.toId()), 0);
    }

    function test_bonusExactlyEqualsPot() public {
        _sellExactOutput(1 ether);
        assertEq(hook.pot(key.toId()), 0.02 ether);
        _buy(2 ether);
        assertEq(hook.pot(key.toId()), 0);
    }

    function test_quoteUnknownPoolAndMaxInput() public {
        assertEq(hook.bonusFor(plain.toId(), type(uint256).max), 0);
        _sell(1 ether);
        assertEq(hook.bonusFor(key.toId(), type(uint256).max), hook.pot(key.toId()));
    }

    function test_dustAllModesAndRoundingThresholds() public {
        uint256[8] memory amounts = [uint256(1), 2, 49, 50, 51, 99, 100, 101];
        for (uint256 i; i < amounts.length; ++i) {
            _sell(amounts[i]);
            _sellExactOutput(amounts[i]);
            _buy(amounts[i]);
            _buyExactOutput(amounts[i]);
        }
    }

    function testFuzz_exactInputSell(uint256 input) public {
        _sell(bound(input, 1, 1000 ether));
    }

    function testFuzz_exactOutputSell(uint256 output) public {
        _sellExactOutput(bound(output, 1, 1000 ether));
    }

    function testFuzz_exactOutputBuy(uint256 output) public {
        _buyExactOutput(bound(output, 1, 1000 ether));
    }

    function testFuzz_bonusAndPlainSwapEquivalence(uint256 sellInput, uint256 buyInput) public {
        _sell(bound(sellInput, 1, 1000 ether));
        _buy(bound(buyInput, 1, 1000 ether));
    }

    function testFuzz_buyThenSellRoundTripLoses(uint256 amount) public {
        _sell(10_000 ether); // A large pre-existing pot is the most generous case for the buyer.
        uint256 input = bound(amount, 1, 100 ether);
        uint256 beforeETH = address(this).balance;
        BalanceDelta bought = _swap(key, true, -int256(input));
        if (bought.amount1() > 0) _swap(key, false, -int256(bought.amount1()));
        assertLt(address(this).balance, beforeETH);
        _assertClaims();
    }

    function testFuzz_sellThenBuyRoundTripLoses(uint256 amount) public {
        _sell(10_000 ether);
        uint256 input = bound(amount, 1, 100 ether);
        uint256 beforeTokens = token.balanceOf(address(this));
        BalanceDelta sold = _swap(key, false, -int256(input));
        if (sold.amount0() > 0) _swap(key, true, -int256(sold.amount0()));
        assertLt(token.balanceOf(address(this)), beforeTokens);
        _assertClaims();
    }

    function testFuzz_exactOutputBuyRoundTripLoses(uint256 amount) public {
        _sell(10_000 ether);
        uint256 output = bound(amount, 1, 100 ether);
        uint256 beforeETH = address(this).balance;
        _swap(key, true, int256(output));
        _swap(key, false, -int256(output));
        assertLt(address(this).balance, beforeETH);
        _assertClaims();
    }

    function testFuzz_exactOutputSellCostsMoreTokensThanBuyReceived(uint256 amount) public {
        _sell(10_000 ether);
        uint256 input = bound(amount, 1, 100 ether);
        uint256 beforeTokens = token.balanceOf(address(this));
        uint256 beforeETH = address(this).balance;
        _swap(key, true, -int256(input));
        _swap(key, false, int256(input));
        assertEq(address(this).balance, beforeETH);
        assertLt(token.balanceOf(address(this)), beforeTokens);
        _assertClaims();
    }

    function test_adjustedSpecifiedAmountMustAlsoFitInt128() public {
        _sell(100 ether);
        uint256 beforePot = hook.pot(key.toId());
        for (uint256 i; i < 2; ++i) {
            vm.expectRevert(
                abi.encodeWithSignature(
                    "WrappedError(address,bytes4,bytes,bytes)",
                    address(hook),
                    IHooks.beforeSwap.selector,
                    abi.encodeWithSelector(AsymmetricTaxHook.AmountTooLarge.selector),
                    abi.encodePacked(Hooks.HookCallFailed.selector)
                )
            );
            _swap(key, i == 0, i == 0 ? -int256(type(int128).max) : int256(type(int128).max));
        }
        assertEq(hook.pot(key.toId()), beforePot);
        _assertClaims();
    }

    function test_zeroAmountRefusedByManager() public {
        vm.expectRevert(IPoolManager.SwapAmountCannotBeZero.selector);
        _swap(key, true, 0);
    }

    function test_noAdministrativeOrWithdrawalEntrypoints() public {
        _sell(100 ether);
        uint256 beforePot = hook.pot(key.toId());
        string[7] memory calls = [
            "withdraw()",
            "claim()",
            "sweep(address)",
            "setOwner(address)",
            "pause()",
            "upgradeTo(address)",
            "setTax(uint256)"
        ];
        for (uint256 i; i < calls.length; ++i) {
            (bool ok,) = address(hook).call(abi.encodeWithSignature(calls[i], address(this)));
            assertFalse(ok);
        }
        assertEq(hook.pot(key.toId()), beforePot);
        _assertClaims();
    }

    function test_runtimeBytecodeMeetsProtectedFloorForBothContracts() public view {
        _checkRuntime(address(token));
        _checkRuntime(address(hook));
    }

    function _checkRuntime(address target) internal view {
        bytes memory code = target.code;
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xff && op != 0xf4 && op != 0xf2, "forbidden runtime opcode");
        }
    }

    function test_partialFillsRevertAllFourModesAndRollbackClaims() public {
        _sell(100 ether);
        (uint160 price,,,) = manager.getSlot0(key.toId());
        _expectPartial(true, -10 ether, price - 1);
        _expectPartial(true, 10 ether, price - 1);
        _expectPartial(false, -10 ether, price + 1);
        _expectPartial(false, 10 ether, price + 1);
        _assertSamePoolState();
        _assertClaims();
    }

    function test_emptyPotBuyPartialFillReverts() public {
        _expectPartial(true, -10 ether, Q96 - 1);
    }

    function _expectPartial(bool direction, int256 amount, uint160 limit) internal {
        uint256 beforePot = hook.pot(key.toId());
        bytes memory expected = abi.encodeWithSignature(
            "WrappedError(address,bytes4,bytes,bytes)",
            address(hook),
            IHooks.afterSwap.selector,
            abi.encodeWithSelector(AsymmetricTaxHook.PartialFill.selector),
            abi.encodePacked(Hooks.HookCallFailed.selector)
        );
        vm.expectRevert(expected);
        router.swap{value: direction ? 20 ether : 0}(
            key, SwapParams(direction, amount, limit), PoolSwapTest.TestSettings(false, false), ""
        );
        assertEq(hook.pot(key.toId()), beforePot);
    }

    function test_extremeSpecifiedAmountsRejectWithoutOverflow() public {
        int256[4] memory amounts =
            [type(int256).min, type(int256).max, int256(type(int128).max) + 1, -int256(type(int128).max) - 1];
        for (uint256 i; i < amounts.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSignature(
                    "WrappedError(address,bytes4,bytes,bytes)",
                    address(hook),
                    IHooks.beforeSwap.selector,
                    abi.encodeWithSelector(AsymmetricTaxHook.AmountTooLarge.selector),
                    abi.encodePacked(Hooks.HookCallFailed.selector)
                )
            );
            _swap(key, true, amounts[i]);
        }
        _assertClaims();
    }

    function test_nonETHPoolAllModesHaveNoEffects() public {
        ONEW other = new ONEW();
        other.approve(address(router), type(uint256).max);
        other.approve(address(liquidityRouter), type(uint256).max);
        (address a, address b) = address(other) < address(token)
            ? (address(other), address(token))
            : (address(token), address(other));
        PoolKey memory foreign = PoolKey(Currency.wrap(a), Currency.wrap(b), 3000, 60, IHooks(address(hook)));
        PoolKey memory control = PoolKey(foreign.currency0, foreign.currency1, 3000, 60, IHooks(address(0)));
        _seed(foreign);
        _seed(control);
        _sell(100 ether); // A foreign pool must not consume an existing native pot.
        uint256 nativePot = hook.pot(key.toId());
        for (uint256 i; i < 4; ++i) {
            bool direction = i < 2;
            int256 amount = i % 2 == 0 ? -int256(1 ether) : int256(1 ether);
            BalanceDelta actual = _swap(foreign, direction, amount);
            BalanceDelta expected = _swap(control, direction, amount);
            assertEq(BalanceDelta.unwrap(actual), BalanceDelta.unwrap(expected));
        }
        assertEq(hook.pot(foreign.toId()), 0);
        assertEq(hook.pot(key.toId()), nativePot);
        _assertClaims();
    }

    function test_nativePoolPotsAreIsolated() public {
        PoolKey memory second = PoolKey(key.currency0, key.currency1, 500, 10, key.hooks);
        _seed(second);
        _sell(100 ether);
        uint256 firstPot = hook.pot(key.toId());
        _swap(second, true, -1 ether); // Empty second pot cannot borrow from first.
        assertEq(hook.pot(key.toId()), firstPot);
        assertEq(hook.pot(second.toId()), 0);
        _swap(second, false, -10 ether);
        uint256 secondPot = hook.pot(second.toId());
        assertGt(secondPot, 0);
        _swap(key, true, -1 ether);
        assertEq(hook.pot(second.toId()), secondPot);
        assertEq(hook.pot(key.toId()) + secondPot, manager.balanceOf(address(hook), 0));
    }

    function test_hookDataCannotRedirectOrWithdrawBonus() public {
        _sell(100 ether);
        uint256 snapshot = vm.snapshotState();
        BalanceDelta expected = _swap(key, true, -1 ether);
        uint256 expectedPot = hook.pot(key.toId());
        vm.revertToState(snapshot);
        BalanceDelta actual = router.swap{value: 1 ether}(
            key,
            SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(false, false),
            abi.encode(address(0xBEEF))
        );
        assertEq(BalanceDelta.unwrap(actual), BalanceDelta.unwrap(expected));
        assertEq(hook.pot(key.toId()), expectedPot);
        assertEq(address(0xBEEF).balance, 0);
        assertEq(token.balanceOf(address(0xBEEF)), 0);
        _assertClaims();
    }

    function test_sellThenBonusBuyWithinOneUnlock() public {
        BatchSwapRouter batch = new BatchSwapRouter(manager);
        token.approve(address(batch), type(uint256).max);
        uint256 beforeETH = address(this).balance;
        (BalanceDelta sold, BalanceDelta bought) = batch.swapTwo{value: 1 ether}(
            key,
            SwapParams(false, 1 ether, TickMath.MAX_SQRT_PRICE - 1),
            key,
            SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1)
        );
        assertEq(int256(sold.amount0()), 1 ether);
        assertEq(int256(bought.amount0()), -1 ether);
        assertEq(address(this).balance, beforeETH, "ETH nets to zero at settlement");
        assertEq(hook.pot(key.toId()), 0.01 ether, "2% accrual less 1% bonus");
        _assertClaims();
    }

    function test_multiplePoolsWithinOneUnlock() public {
        PoolKey memory second = PoolKey(key.currency0, key.currency1, 500, 10, key.hooks);
        _seed(second);
        BatchSwapRouter batch = new BatchSwapRouter(manager);
        token.approve(address(batch), type(uint256).max);
        batch.swapTwo{value: 1 ether}(
            key,
            SwapParams(false, 1 ether, TickMath.MAX_SQRT_PRICE - 1),
            second,
            SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1)
        );
        assertEq(hook.pot(key.toId()), 0.02 ether);
        assertEq(hook.pot(second.toId()), 0, "second pool has no bonus funds");
        _assertClaims();
    }

    function test_failedRouterSettlementRollsBackBurnAndPot() public {
        _sell(100 ether);
        uint256 beforePot = hook.pot(key.toId());
        (uint160 beforePrice,,,) = manager.getSlot0(key.toId());
        uint256 beforeTokens = token.balanceOf(address(this));
        vm.expectRevert(); // Router cannot fund the full input after the hook has burned its bonus.
        router.swap{value: 1 ether - 1}(
            key,
            SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        assertEq(hook.pot(key.toId()), beforePot);
        (uint160 afterPrice,,,) = manager.getSlot0(key.toId());
        assertEq(afterPrice, beforePrice);
        assertEq(token.balanceOf(address(this)), beforeTokens);
        _assertClaims();
    }

    function test_unsolicitedClaimsAreUnallocatedSurplus() public {
        router.swap(
            key,
            SwapParams(false, -100 ether, TickMath.MAX_SQRT_PRICE - 1),
            PoolSwapTest.TestSettings(true, false),
            ""
        );
        uint256 beforePot = hook.pot(key.toId());
        assertTrue(manager.transfer(address(hook), 0, 1));
        assertEq(hook.pot(key.toId()), beforePot, "gift has no pool attribution");
        assertEq(manager.balanceOf(address(hook), 0), beforePot + 1);
        _swap(key, true, -1 ether);
        assertEq(hook.pot(key.toId()), beforePot - 0.01 ether);
        assertEq(manager.balanceOf(address(hook), 0), hook.pot(key.toId()) + 1);
    }
}
