// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "v4-core/test/utils/LiquidityAmounts.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {HookDeployment} from "./helpers/HookTestBase.sol";
import {LaunchParameters as P} from "./helpers/LaunchParameters.sol";
import {AsymmetricTaxHook} from "../src/AsymmetricTaxHook.sol";
import {ONEW} from "../src/ONEW.sol";

/// @dev Rehearses the specified factory lifecycle, including factory ownership of the position.
/// The actual factory source and final manifest were not supplied; these are explicit parameters.
contract RehearsalFactory is IUnlockCallback {
    IPoolManager public immutable manager;
    ONEW public token;
    AsymmetricTaxHook public hook;
    uint128 public liquidity;
    BalanceDelta public seedDelta;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function launch() external returns (PoolKey memory key) {
        require(address(token) == address(0), "already launched");
        token = new ONEW();
        require(token.balanceOf(address(this)) == P.TOKEN_SEED, "factory supply mismatch");
        hook = HookDeployment.deploy(manager);
        key = PoolKey(
            Currency.wrap(address(0)),
            Currency.wrap(address(token)),
            P.FEE,
            P.TICK_SPACING,
            IHooks(address(hook))
        );
        manager.initialize(key, P.SQRT_PRICE_X96);
        liquidity = LiquidityAmounts.getLiquidityForAmount1(
            TickMath.getSqrtPriceAtTick(P.TICK_LOWER), TickMath.getSqrtPriceAtTick(P.TICK_UPPER), P.TOKEN_SEED
        );
        manager.unlock(abi.encode(key));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only manager");
        PoolKey memory key = abi.decode(data, (PoolKey));
        (seedDelta,) = manager.modifyLiquidity(
            key, ModifyLiquidityParams(P.TICK_LOWER, P.TICK_UPPER, int256(uint256(liquidity)), 0), ""
        );
        require(seedDelta.amount0() == 0 && seedDelta.amount1() < 0, "not one-sided ONEW");
        manager.sync(key.currency1);
        token.transfer(address(manager), uint256(-int256(seedDelta.amount1())));
        manager.settle();
        return "";
    }
}

contract LaunchRehearsalTest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IPoolManager internal manager;
    RehearsalFactory internal factory;
    PoolSwapTest internal router;
    PoolKey internal key;
    ONEW internal token;
    AsymmetricTaxHook internal hook;

    function setUp() public {
        vm.chainId(P.CHAIN_ID);
        vm.deal(address(this), 100 ether);
        manager = IPoolManager(address(new PoolManager(address(this))));
        factory = new RehearsalFactory(manager);
        key = factory.launch();
        token = factory.token();
        hook = factory.hook();
        router = new PoolSwapTest(manager);
        token.approve(address(router), type(uint256).max);
    }

    function test_factoryInitializationOneSidedSeedAndFirstBuy() public {
        (uint160 price, int24 tick,,) = manager.getSlot0(key.toId());
        assertEq(price, P.SQRT_PRICE_X96);
        assertEq(tick, 138162);
        assertEq(address(manager).balance, 0, "ETH-less manager before first trade");
        assertEq(address(factory).balance, 0);
        assertEq(factory.seedDelta().amount0(), 0);
        assertLe(token.balanceOf(address(factory)), 1000, "only liquidity rounding dust remains");
        (uint128 seeded,,) =
            manager.getPositionInfo(key.toId(), address(factory), P.TICK_LOWER, P.TICK_UPPER, 0);
        assertEq(seeded, factory.liquidity());
        assertGt(seeded, 0);
        assertEq(manager.getLiquidity(key.toId()), 0, "starts above the token-only range");

        uint256 beforeETH = address(this).balance;
        BalanceDelta bought = _trade(true, -1 ether);
        assertEq(int256(bought.amount0()), -1 ether);
        assertEq(beforeETH - address(this).balance, 1 ether);
        assertGt(bought.amount1(), 0);
        assertEq(token.balanceOf(address(this)), uint256(int256(bought.amount1())));
        assertEq(address(manager).balance, 1 ether);
        assertEq(hook.pot(key.toId()), 0);
        assertEq(manager.balanceOf(address(hook), 0), 0);
        assertGt(manager.getLiquidity(key.toId()), 0);

        BalanceDelta sold = _trade(false, -int256(bought.amount1()));
        assertGt(sold.amount0(), 0);
        assertLt(sold.amount0(), 1 ether, "first round trip loses");
        uint256 potBefore = hook.pot(key.toId());
        assertGt(potBefore, 0);
        assertEq(potBefore, manager.balanceOf(address(hook), 0));
        beforeETH = address(this).balance;
        _trade(true, -1 ether);
        assertEq(beforeETH - address(this).balance, 1 ether);
        assertEq(hook.pot(key.toId()), potBefore - 0.01 ether);
        assertEq(hook.pot(key.toId()), manager.balanceOf(address(hook), 0));
    }

    function test_firstBuyExactOutputAlsoWorksWithNoETH() public {
        assertEq(address(manager).balance, 0);
        BalanceDelta bought = _trade(true, 1000 ether);
        assertEq(int256(bought.amount1()), 1000 ether);
        assertLt(bought.amount0(), 0);
        assertEq(hook.pot(key.toId()), 0);
    }

    function _trade(bool direction, int256 amount) internal returns (BalanceDelta) {
        return router.swap{value: direction ? 2 ether : 0}(
            key,
            SwapParams(
                direction, amount, direction ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
    }

    receive() external payable {}
}
