// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {AsymmetricTaxHook} from "../../src/AsymmetricTaxHook.sol";
import {ONEW} from "../../src/ONEW.sol";

library HookDeployment {
    function deploy(IPoolManager manager) internal returns (AsymmetricTaxHook hook) {
        bytes memory code = abi.encodePacked(type(AsymmetricTaxHook).creationCode, abi.encode(manager));
        bytes32 hash = keccak256(code);
        for (uint256 salt; salt < 1_000_000; ++salt) {
            address predicted = address(
                uint160(
                    uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), hash)))
                )
            );
            if (uint160(predicted) & 0x3fff != 0x00cc) continue;
            hook = new AsymmetricTaxHook{salt: bytes32(salt)}(manager);
            require(address(hook) == predicted, "CREATE2 mismatch");
            return hook;
        }
        revert("salt search exhausted");
    }
}

abstract contract HookTestBase is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    uint160 internal constant Q96 = 79228162514264337593543950336;
    IPoolManager internal manager;
    ONEW internal token;
    AsymmetricTaxHook internal hook;
    PoolSwapTest internal router;
    PoolModifyLiquidityTest internal liquidityRouter;
    PoolKey internal key;
    PoolKey internal plain;

    event SellTaxed(PoolId indexed poolId, uint256 ethLeg, uint256 tax);
    event BuyBonus(PoolId indexed poolId, uint256 input, uint256 bonus);

    function setUp() public virtual {
        vm.deal(address(this), 1_000_000_000 ether);
        manager = IPoolManager(address(new PoolManager(address(this))));
        token = new ONEW();
        hook = HookDeployment.deploy(manager);
        router = new PoolSwapTest(manager);
        liquidityRouter = new PoolModifyLiquidityTest(manager);
        token.approve(address(router), type(uint256).max);
        token.approve(address(liquidityRouter), type(uint256).max);
        key = PoolKey(
            Currency.wrap(address(0)), Currency.wrap(address(token)), 3000, 60, IHooks(address(hook))
        );
        plain = PoolKey(key.currency0, key.currency1, 3000, 60, IHooks(address(0)));
        _seed(key);
        _seed(plain);
    }

    function _seed(PoolKey memory pool) internal {
        manager.initialize(pool, Q96);
        liquidityRouter.modifyLiquidity{value: 1_000_001 ether}(
            pool, ModifyLiquidityParams(-887220, 887220, 1_000_000 ether, 0), ""
        );
    }

    function _swap(PoolKey memory pool, bool zeroForOne, int256 amount) internal returns (BalanceDelta) {
        return router.swap{value: zeroForOne ? 100_000 ether : 0}(
            pool,
            SwapParams(
                zeroForOne, amount, zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
    }

    function _sell(uint256 input) internal returns (BalanceDelta taxed) {
        BalanceDelta control = _swap(plain, false, -int256(input));
        uint256 gross = uint256(int256(control.amount0()));
        uint256 tax = gross / 50;
        uint256 beforePot = hook.pot(key.toId());
        vm.expectEmit(true, false, false, true, address(hook));
        emit SellTaxed(key.toId(), gross, tax);
        taxed = _swap(key, false, -int256(input));
        assertEq(int256(taxed.amount1()), -int256(input), "exact-in seller token debit");
        assertEq(int256(taxed.amount0()), int256(gross - tax), "2% of pool ETH output");
        assertEq(hook.pot(key.toId()), beforePot + tax);
        _assertSamePoolState();
        _assertClaims();
    }

    function _buy(uint256 input) internal returns (BalanceDelta subsidized) {
        uint256 beforePot = hook.pot(key.toId());
        uint256 bonus = input / 100 < beforePot ? input / 100 : beforePot;
        assertEq(hook.bonusFor(key.toId(), input), bonus);
        uint256 beforeClaims = manager.balanceOf(address(hook), 0);
        uint256 beforeETH = address(this).balance;
        uint256 beforeTokens = token.balanceOf(address(this));
        vm.expectEmit(true, false, false, true, address(hook));
        emit BuyBonus(key.toId(), input, bonus);
        subsidized = _swap(key, true, -int256(input));
        assertEq(beforeETH - address(this).balance, input, "buyer's actual ETH debit");
        assertEq(int256(subsidized.amount0()), -int256(input));
        assertEq(token.balanceOf(address(this)) - beforeTokens, uint256(int256(subsidized.amount1())));
        assertEq(beforeClaims - manager.balanceOf(address(hook), 0), bonus, "bonus burns claims");
        assertEq(hook.pot(key.toId()), beforePot - bonus);
        BalanceDelta control = _swap(plain, true, -int256(input + bonus));
        assertEq(int256(subsidized.amount1()), int256(control.amount1()), "plain input + bonus output");
        _assertSamePoolState();
        _assertClaims();
    }

    function _assertSamePoolState() internal view {
        (uint160 hookedPrice, int24 hookedTick,,) = manager.getSlot0(key.toId());
        (uint160 plainPrice, int24 plainTick,,) = manager.getSlot0(plain.toId());
        assertEq(hookedPrice, plainPrice);
        assertEq(hookedTick, plainTick);
    }

    function _assertClaims() internal view {
        assertEq(hook.pot(key.toId()), manager.balanceOf(address(hook), 0));
        assertEq(manager.currencyDelta(address(hook), key.currency0), 0);
        assertEq(manager.currencyDelta(address(hook), key.currency1), 0);
        assertEq(address(hook).balance, 0);
    }

    receive() external payable {}
}
