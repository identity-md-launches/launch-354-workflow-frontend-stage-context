// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {CurrencySettler} from "v4-core/test/utils/CurrencySettler.sol";

/// @dev Test router that settles two swaps only after both have completed in the same unlock.
contract BatchSwapRouter is IUnlockCallback {
    using TransientStateLibrary for IPoolManager;
    using CurrencySettler for Currency;

    IPoolManager internal immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function swapTwo(PoolKey memory first, SwapParams memory a, PoolKey memory second, SwapParams memory b)
        external
        payable
        returns (BalanceDelta, BalanceDelta)
    {
        require(first.currency0 == second.currency0 && first.currency1 == second.currency1, "same currencies");
        bytes memory result = manager.unlock(abi.encode(msg.sender, first, a, second, b));
        if (address(this).balance != 0) {
            CurrencyLibrary.ADDRESS_ZERO.transfer(msg.sender, address(this).balance);
        }
        return abi.decode(result, (BalanceDelta, BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only manager");
        (
            address payer,
            PoolKey memory first,
            SwapParams memory a,
            PoolKey memory second,
            SwapParams memory b
        ) = abi.decode(data, (address, PoolKey, SwapParams, PoolKey, SwapParams));
        BalanceDelta resultA = manager.swap(first, a, "");
        BalanceDelta resultB = manager.swap(second, b, "");
        _settle(first.currency0, payer);
        _settle(first.currency1, payer);
        return abi.encode(resultA, resultB);
    }

    function _settle(Currency currency, address payer) internal {
        int256 delta = manager.currencyDelta(address(this), currency);
        if (delta < 0) currency.settle(manager, payer, uint256(-delta), false);
        if (delta > 0) currency.take(manager, payer, uint256(delta), false);
    }
}
