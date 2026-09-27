# Vendored dependencies

All dependencies are ordinary source files under `lib/`, with no git submodules, package installation or network resolution required for verification. Source contents are unmodified; unused upstream files were omitted. `dependencies.sha256` records each delivered vendored file's digest.

| Dependency | Pinned revision | Delivered subset |
| --- | --- | --- |
| [Uniswap/v4-core](https://github.com/Uniswap/v4-core/tree/46c6834698c48bc4a463a86d8420f4eb1d7f3b75) | `46c6834698c48bc4a463a86d8420f4eb1d7f3b75` | Production `src`, PoolSwapTest / PoolModifyLiquidityTest / PoolTestBase, CurrencySettler and LiquidityAmounts test utilities, licenses |
| [foundry-rs/forge-std](https://github.com/foundry-rs/forge-std/tree/3e2295d50379faa6c8e9859d51b1f97a69a830d1) | `3e2295d50379faa6c8e9859d51b1f97a69a830d1` | `src`, MIT and Apache licenses |
| [transmissions11/solmate](https://github.com/transmissions11/solmate/tree/4b47a19038b798b4a33d9749d25e570443520647) | `4b47a19038b798b4a33d9749d25e570443520647` | `src/auth/Owned.sol` required by PoolManager; license |
| [OpenZeppelin/openzeppelin-contracts](https://github.com/OpenZeppelin/openzeppelin-contracts/tree/69c8def5f222ff96f2b5beff05dfba996368aa79) | `69c8def5f222ff96f2b5beff05dfba996368aa79` (v5.1.0) | ERC20, IERC20, IERC20Metadata, Context, ERC-6093 errors; license |

Uniswap files carry their individual upstream SPDX identifiers, including BUSL-1.1 for PoolManager. Preserve and review the bundled licenses for downstream use. No compiler binary is vendored or path-pinned; the verification environment supplies Solidity 0.8.26 as specified in `foundry.toml`.
