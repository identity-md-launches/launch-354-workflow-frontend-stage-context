# Delta accounting

The implementation follows the pinned [v4 Hooks library](https://github.com/Uniswap/v4-core/blob/46c6834698c48bc4a463a86d8420f4eb1d7f3b75/src/libraries/Hooks.sol) and [PoolManager](https://github.com/Uniswap/v4-core/blob/46c6834698c48bc4a463a86d8420f4eb1d7f3b75/src/PoolManager.sol). PoolManager adds the before-hook specified delta to `amountSpecified`, then subtracts the hook's total delta from the AMM delta to obtain the router's delta. Positive amounts are credits, negative amounts are debts.

Let `I` be buy input, `B = min(floor(I/100), pot)`, `E` be the sell's ETH leg and `T = floor(E/50)`.

| Operation | AMM ETH delta | Returned hook ETH delta | Router ETH delta | Settlement performed by hook |
| --- | ---: | ---: | ---: | --- |
| Exact-input buy | `-(I+B)` | `-B` specified | `-I` | Burn `B` claims, creating `+B` transient credit |
| Exact-output buy | Actual negative ETH input | `0` | Unchanged | None |
| Exact-input sell | `+E` | `+T` unspecified | `E-T` | Mint `T` claims, creating `-T` transient debt |
| Exact-output sell | `E+T` | `+T` specified | `+E` | Mint `T` claims, creating `-T` transient debt |

Each hook delta cancels its claim operation exactly. The router settles the remaining user deltas through the manager. No hook ETH balance, recipient callback, `take()`, native transfer, nested swap or pull-credit ledger is involved. Pot debits happen before claim burns. The general workflow's burn-and-take `unlockCallback` payout pattern applies to separate cash withdrawals; this hook has no such payout, identity-based credit or withdrawal interface. Its specified payout is the same-swap subsidy, burned in `beforeSwap` as required.

The negative buy delta expands an already-negative specified amount, so it cannot change an exact-input buy into an exact-output swap. A positive exact-output sell tax expands an already-positive amount. No path consumes all the user's specified input as a hook fee or changes the swap's mode. Both the original and adjusted specified amounts must lie within `[-int128.max, int128.max]`.

The before callback stores the **adjusted** expected specified amount in transient storage. The after callback selects the actual specified leg from the AMM's unadjusted `BalanceDelta` and requires exact equality. It clears the transient slot before proceeding. A mismatch reverts the entire operation, including mint/burn, events and pot changes. The slot can be shared across pools because v4 executes each before/core/after sequence synchronously. The only external hook calls are trusted PoolManager `mint` and `burn`; neither invokes user code. No other external call occurs between these two callbacks in the pinned manager. Cancun support is required.

Rates divide first (`input / 100`, `ethLeg / 50`), so view inputs as large as `uint256.max` cannot overflow. Zero tax or bonus skips the claim operation. Native-pool exact-input buys emit `BuyBonus` even with zero bonus; sells emit `SellTaxed` even with zero tax. Exact-output buys and non-ETH pools emit no hook event.

For all supported swap sequences:

```text
pot[p] = cumulative tax[p] - cumulative bonuses[p] >= 0
sum(pot[p]) = PoolManager.balanceOf(hook, 0)
hook transient ETH delta after swap = 0
```

Claim ID `0` is native ETH. Non-ETH pools cannot spend a native pot. Anyone can create another native pool referencing the hook; the token is learned from the pool key, and that pool gets an independent pot. There is no single-token allowlist or one-time pool binding because the constructor only receives PoolManager and initialization callbacks are disabled.

The equality invariant has an unavoidable external-transfer boundary: v4's [ERC-6909 implementation](https://github.com/Uniswap/v4-core/blob/46c6834698c48bc4a463a86d8420f4eb1d7f3b75/src/ERC6909.sol) permits anyone to transfer their own claims to any address without a receiver callback. Such an unsolicited transfer to this hook creates surplus claims that cannot be attributed to a pool. Supported swaps still conserve each pot exactly, but global claims then exceed recorded pots by the donated surplus. The hook cannot reject those transfers, and offers no sweep. Monitoring should distinguish that surplus from an accounting deficit; a deficit is never produced by the hook. The stateful test exercises buy/sell sequences, without externally fabricated claims or unsolicited transfers.
