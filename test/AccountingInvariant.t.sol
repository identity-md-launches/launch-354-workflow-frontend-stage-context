// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {HookTestBase} from "./helpers/HookTestBase.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {AsymmetricTaxHook} from "../src/AsymmetricTaxHook.sol";
import {ONEW} from "../src/ONEW.sol";

contract AccountingHandler is Test {
    using PoolIdLibrary for PoolKey;
    using TransientStateLibrary for IPoolManager;

    IPoolManager internal immutable manager;
    PoolSwapTest internal immutable router;
    AsymmetricTaxHook internal immutable hook;
    PoolKey[2] internal pools;
    uint256[2] public ghostPots;
    uint256 public taxes;
    uint256 public bonuses;
    uint256 public calls;

    constructor(
        IPoolManager manager_,
        PoolSwapTest router_,
        AsymmetricTaxHook hook_,
        PoolKey memory first,
        PoolKey memory second,
        ONEW token
    ) {
        manager = manager_;
        router = router_;
        hook = hook_;
        pools[0] = first;
        pools[1] = second;
        token.approve(address(router), type(uint256).max);
    }

    /// @dev All four modes on two native pools. No rejected inputs or ignored reverts.
    function trade(uint8 poolChoice, uint8 mode, uint256 rawSize) public {
        uint256 index = poolChoice % 2;
        mode %= 4;
        uint256 size = bound(rawSize, 1, 100 ether);
        bool buy = mode < 2;
        bool exactIn = mode % 2 == 0;
        PoolKey memory key = pools[index];
        uint256 beforeETH = address(this).balance;
        uint256 bonus;
        if (buy && exactIn) bonus = size / 100 < ghostPots[index] ? size / 100 : ghostPots[index];
        vm.recordLogs();
        BalanceDelta delta = router.swap{value: buy ? 1000 ether : 0}(
            key,
            SwapParams(
                buy,
                exactIn ? -int256(size) : int256(size),
                buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        int128 coreETH;
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(manager)
                    && logs[i].topics[0]
                        == keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
            ) {
                (coreETH,,,,,) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                found = true;
            }
        }
        assertTrue(found, "must execute a real AMM swap");
        if (buy && exactIn) {
            assertEq(beforeETH - address(this).balance, size);
            assertEq(int256(coreETH), -int256(size + bonus));
            assertEq(int256(delta.amount0()), -int256(size));
            ghostPots[index] -= bonus;
            bonuses += bonus;
        } else if (!buy) {
            uint256 tax = exactIn ? uint256(int256(coreETH)) / 50 : size / 50;
            if (exactIn) {
                assertEq(int256(delta.amount1()), -int256(size));
                assertEq(int256(delta.amount0()), int256(coreETH) - int256(tax));
            } else {
                assertEq(int256(delta.amount0()), int256(size));
                assertEq(int256(coreETH), int256(size + tax));
            }
            ghostPots[index] += tax;
            taxes += tax;
        } else {
            assertEq(int256(delta.amount1()), int256(size));
            assertEq(delta.amount0(), coreETH);
        }
        ++calls;
        assertEq(hook.pot(pools[0].toId()), ghostPots[0]);
        assertEq(hook.pot(pools[1].toId()), ghostPots[1]);
        assertEq(manager.balanceOf(address(hook), 0), ghostPots[0] + ghostPots[1]);
        assertEq(manager.currencyDelta(address(hook), key.currency0), 0);
        assertEq(manager.currencyDelta(address(hook), key.currency1), 0);
    }

    receive() external payable {}
}

contract AccountingInvariantTest is StdInvariant, HookTestBase {
    using PoolIdLibrary for PoolKey;

    AccountingHandler internal handler;
    PoolKey internal second;

    function setUp() public override {
        super.setUp();
        second = PoolKey(key.currency0, key.currency1, 500, 10, key.hooks);
        _seed(second);
        handler = new AccountingHandler(manager, router, hook, key, second, token);
        token.transfer(address(handler), 1_000_000 ether);
        vm.deal(address(handler), 1_000_000 ether);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = AccountingHandler.trade.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
        targetContract(address(handler));
    }

    function invariant_potsEqualETHClaimsAndRecordedObligations() public view {
        uint256 first = hook.pot(key.toId());
        uint256 other = hook.pot(second.toId());
        assertEq(first, handler.ghostPots(0));
        assertEq(other, handler.ghostPots(1));
        assertEq(first + other, manager.balanceOf(address(hook), 0));
        assertLe(handler.bonuses(), handler.taxes());
        assertEq(first + other, handler.taxes() - handler.bonuses());
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
    }

    function invariant_tokenSupplyIsConserved() public view {
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(
            token.balanceOf(address(this)) + token.balanceOf(address(manager))
                + token.balanceOf(address(handler)),
            token.totalSupply()
        );
    }

    function testFuzz_mixedSequence(uint256 seed) public {
        for (uint256 i; i < 32; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            handler.trade(uint8(seed), uint8(seed >> 8), (seed >> 16) % (100 ether) + 1);
        }
        assertEq(handler.calls(), 32);
        invariant_potsEqualETHClaimsAndRecordedObligations();
    }
}
