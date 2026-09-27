# Oneway (ONEW)

Oneway is a Sepolia test toy. ONEW and its bonus pot have no value, and nothing here promises a return. This repository delivers the fixed-supply token, `AsymmetricTaxHook`, ABI exports and local Foundry verification. Publication, independent review, manifest generation, attestation, admission, deployment and the frontend are separate service responsibilities.

Run with Foundry and Solidity 0.8.26 installed:

```sh
forge build
forge test
forge fmt --check
```

All Solidity dependencies are ordinary vendored files. Building and testing require no network, environment variables, fork endpoint, FFI or filesystem cheatcodes. `foundry.toml` pins Solidity 0.8.26, Cancun, optimizer runs 200 and `bytecode_hash = "none"`. Dependency revisions and licenses are in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).

`ONEW` has no constructor arguments. It mints exactly 1,000,000,000 tokens, with 18 decimals, to its deployer. It uses the OpenZeppelin ERC-20 implementation without transfer fees or an external mint function.

`AsymmetricTaxHook` takes exactly one constructor argument, `IPoolManager`. All rates are constants. Its address must carry exactly `0x00cc` in the low 14 bits; the constructor validates every permission using `Hooks.validateHookPermissions`. There is no owner, setter, pause, upgrade, sweep, withdrawal, external swap or administrative mint. The only hook callbacks are `beforeSwap` and `afterSwap`, and both require the configured PoolManager as caller.

| Native-ETH pool trade | Hook behavior |
| --- | --- |
| Exact-input buy (`zeroForOne`, negative amount) | Burn `min(floor(input / 100), pot)` ETH claims; return a negative specified delta; AMM spends input plus bonus and buyer pays exactly input. |
| Exact-output buy (`zeroForOne`, positive amount) | No hook fee or bonus; requested ONEW output is exact. |
| Exact-input sell (`oneForZero`, negative amount) | Mint ETH claims for `floor(gross pool ETH output / 50)`; positive unspecified delta reduces ETH received. Requested ONEW input is exact. |
| Exact-output sell (`oneForZero`, positive amount) | Mint ETH claims for `floor(requested ETH output / 50)`; positive specified delta makes the pool produce requested ETH plus tax. Seller receives exactly requested ETH. |

Every native-pool partial fill reverts with `PartialFill`, including a partially consumed bonus. Zero-rounded fees and bonuses are zero. Unrepresentable specified amounts, including the adjustment, revert with `AmountTooLarge`. Currency legs use v4's `int128` range. A pool with non-native currency0 receives zero deltas, no hook events and no pot changes; its ordinary v4 partial-fill rules remain in force.

Pots are isolated by `PoolId`. With one pool, its pot equals the hook's PoolManager ETH claim balance; with several, the **sum** of their pots equals that balance. Each sell mints claims and each bonus burns claims atomically with its returned delta. The hook never transfers ETH or takes ETH during a swap callback, allowing the factory's ETH-less first buy. Details, including the boundary concerning unsolicited claim transfers, are in [docs/ACCOUNTING.md](docs/ACCOUNTING.md).

A buy/sell round trip pays 2% on the sell and receives at most 1% on the buy, plus LP fees. Under the same pool state and ordinary round-trip conditions this loses value, including when the pot is already full; the tests cover both directions and exact-output paths. The pot only moves sellers' tax to later buyers. This is not a guarantee about trades with intervening price changes, outside markets, LP positions or other participants.

No swapper identity is needed. `hookData` is unauthenticated and ignored: neither missing nor forged data creates an address-level credit, and a router has no separate claim function. A bonus improves the output of the current swap; the router is responsible for returning that output to its user. Frontends must apply slippage bounds and display that bonus quotes can change before execution.

The suite deploys real v4-core PoolManagers and CREATE2-mined hooks. It includes a factory-style one-sided launch, the first exact-in and exact-out buy with zero manager ETH, plain-pool comparisons, tax and bonus events, dust, boundary amounts, access failures, non-ETH pools, pool isolation, partial-fill rollback, token behavior, opcode checks, fuzzed round trips and a two-pool stateful accounting invariant. The invariant handler allows no ignored reverts and maintains an independent ledger from core swap events.

The supplied workflow contains no numeric manifest price, seed allocation, factory source or tick range. [LaunchParameters.sol](test/helpers/LaunchParameters.sol) therefore records **proposed rehearsal inputs**, not a verified final manifest: 1,000,000 ONEW per ETH and the full supply seeded below the starting price. The manifest contributor must use matching inputs or the service must rerun the rehearsal using the final inputs. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the exact values and handoff requirements. Local tests do not substitute for the separately assigned independent adversarial review.

Generated ABI arrays: [ONEW.json](docs/abi/ONEW.json) and [AsymmetricTaxHook.json](docs/abi/AsymmetricTaxHook.json). Their views, errors and events are documented in [docs/ABI.md](docs/ABI.md).
