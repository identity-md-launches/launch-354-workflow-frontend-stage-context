# ABI exports

`docs/abi/ONEW.json` and `docs/abi/AsymmetricTaxHook.json` are standard ABI arrays exported from the compiled artifacts using `forge inspect <contract> abi --json`. Pool IDs encode as `bytes32`; currencies encode as addresses; balances and pot amounts use wei. Events index only `poolId` in addition to their signature topic.

| Hook member | Meaning |
| --- | --- |
| `poolManager() -> address` | Immutable constructor argument |
| `SELL_TAX_BPS() -> uint256` | Constant `200` |
| `BUY_BONUS_BPS() -> uint256` | Constant `100` |
| `getHookPermissions() -> tuple` | v4's 14 booleans in interface order; exactly beforeSwap, afterSwap and their return-delta flags true |
| `pot(bytes32 poolId) -> uint256` | Unspent ETH tax claims allocated to that pool |
| `bonusFor(bytes32 poolId, uint256 input) -> uint256` | Minimum of `floor(input/100)` and that pool's current pot; zero for unknown pools |
| `beforeSwap(address, PoolKey, SwapParams, bytes)` | PoolManager-only callback; returns selector, packed BeforeSwapDelta, zero LP-fee override |
| `afterSwap(address, PoolKey, SwapParams, int256 delta, bytes)` | PoolManager-only callback; returns selector and signed unspecified delta |
| `SellTaxed(bytes32 indexed poolId, uint256 ethLeg, uint256 tax)` | For exact-in sells, ETH leg is the pool's gross output; for exact-out sells it is the user's requested ETH output |
| `BuyBonus(bytes32 indexed poolId, uint256 input, uint256 bonus)` | Original exact-input buy size and subsidy, including zero subsidies |

`PoolKey` order: `currency0`, `currency1`, `fee` (`uint24`), `tickSpacing` (`int24`), `hooks` (address). `SwapParams` order: `zeroForOne` (`bool`), `amountSpecified` (`int256`), `sqrtPriceLimitX96` (`uint160`). An input has negative `amountSpecified`; an output has positive `amountSpecified`.

Errors are `NotPoolManager()`, `InvalidPoolManager()`, `AmountTooLarge()` and `PartialFill()`, plus the v4 constructor error `HookAddressNotValid(address)`. PoolManager wraps failed swap callbacks in `WrappedError(address,bytes4,bytes,bytes)` with the underlying hook error. A zero swap amount is rejected by PoolManager itself. There is no standalone bonus claim or unlock callback.

ONEW exposes standard ERC-20 `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `allowance`, `approve`, `transfer` and `transferFrom`; events are `Transfer` and `Approval`, and errors use OpenZeppelin's ERC-6093 definitions. It has no privileged selectors.

Regenerate after any contract change:

```sh
forge inspect ONEW abi --json > docs/abi/ONEW.json
forge inspect AsymmetricTaxHook abi --json > docs/abi/AsymmetricTaxHook.json
```
