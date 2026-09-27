# Oneway frontend

A single static React/TypeScript page for the deployed ONEW native-ETH pool on Sepolia. Source and the exact npm lockfile are here; the complete production export is in `../dist/`. No backend, credentials, external fonts, or runtime CDN libraries are required. Reads and wallet transactions need an RPC connection.

## Install, build and preview

Use Node 24 and npm 11 (the versions used on this worker). From the repository root:

```sh
npm --prefix web ci --cache test/scratch/npm-cache
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run preview
```

Open the URL Vite prints. `npm --prefix web run dev` generates the runtime manifest and starts the development server. All frontend build configuration stays under `web/`. Vite uses `base: './'`, and the application uses same-directory manifest/ABI requests and document anchors, so `dist/` works below an IPFS gateway subpath without rewrites. Serve it over HTTP(S), not `file://`.

`build` always regenerates `dist/imd-deployment.json` **after** the final Vite export, then checks it. Do not edit any exported asset without rebuilding its manifest. The publisher should deliver the entire `dist/` directory; it does not need to rebuild or install npm packages.

## One runtime deployment configuration

`src/config.ts` fetches `./imd-deployment.json`; the app imports no address, RPC, chain or contract ABI constants. It fetches each referenced ABI JSON and verifies the implementation ABI's canonical Keccak hash before rendering trading controls. The runtime chain, explorer, faucets, token, hook, pool key, Uniswap integrations, and wallet chain-add data all come from this manifest.

Build inputs:

- `config/deployment.json`: exact supplied deployment handoff, including source commit, ABI hashes and pool description.
- `config/network.json`: exact supplied network/wallet-add-chain handoff.
- `config/integration.json`: the assignment's explicit PoolSwapTest router and ABI asset paths.
- `scripts/shared.mjs`: minimal public Uniswap interface ABIs, exported as separate JSON assets. They are interfaces for external integrations, not substitutes for the implementation-derived ONEW/hook ABIs.

`export.mjs` uses `git show <sourceCommit>:docs/abi/<Contract>.json` to recover the pinned, implementation-derived arrays, compares their recursively key-sorted JSON Keccak-256 to the handoff, checks the working ABI exports, and copies the original pinned bytes. A Git checkout containing the deployed commit is needed to rebuild. The app only needs the exported files. The original Solidity and implementation ABI files remain unchanged.

The manifest copies the exact contract set, identifiers, addresses and ABI hashes, and the unchanged `network` object. It additionally carries `walletAddChain`, pool/token metadata, deployment block and `integration`. Every exported file except the manifest is inventoried with SHA-256. Current export: 9 assets plus the manifest, approximately 577 KB; well inside the 128-asset and HTTP-budget limits.

### Resolution of conflicting router requirements

This assignment and the approved workflow explicitly require **PoolSwapTest**, while the generic network guidance prescribes Universal Router/Permit2. The network handoff does not contain PoolSwapTest. The specific site requirement wins: its exact address is held once in the source integration input and emitted into the same runtime manifest. The supplied `network` block is not altered. StateView, quoter and PoolManager come directly from that block. Swaps and token approvals use the manifest's PoolSwapTest address. Universal Router and Permit2 are unused. This is an explicit exception to the generic “every swap/approval uses network-block addresses” sentence; satisfying both router directives literally is impossible.

The interface signatures were checked against the repository's pinned `lib/v4-core/src/test/PoolSwapTest.sol` and `PoolTestBase.sol`, the [Uniswap IV4Quoter interface](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Quoter.sol), and [QuoterRevert](https://github.com/Uniswap/v4-periphery/blob/main/src/libraries/QuoterRevert.sol). Network addresses are taken from supplied task data, not substituted from online tables. The deployed router's `manager()` and the hook's `poolManager()` are checked against the supplied PoolManager.

## Trading and reads

The page reads pot, bonusFor, hook rate constants, token decimals, balances, allowances and StateView `getSlot0`. Pool ID is Keccak-256 of the ABI-encoded pool key. The displayed price uses live sqrtPriceX96, not the handoff's initial price. Public RPCs are tried in supplied order, with a connected wallet on the correct chain as a final read fallback. Data refreshes every 30 seconds, and a manual refresh is available.

`SellTaxed` and `BuyBonus` logs are filtered to this pool, sorted newest first and linked to the explorer. The page shows up to 20 events from at most the latest 1,500 blocks, queried in 500-block batches, starting no earlier than deployment. This is a bounded recent feed, not complete history. Event failures have a retry control and do not erase successful pool reads.

Injected EIP-1193 browser wallets are supported. There is no WalletConnect project ID or remote-wallet connector. Account and chain changes invalidate review. A wrong-network wallet sees one switch control. Error 4902/unknown-chain responses trigger the exact handoff's `wallet_addEthereumChain`, then another switch request. No accounts are requested on load; “Disconnect” clears the app session rather than revoking wallet-side permissions.

Buy flow: enter native test ETH → simulated quoter result and independent `bonusFor` preview → connect/switch → review → simulate PoolSwapTest → estimate gas and check balance → wallet signature → receipt/explorer link. The transaction sends exactly the entered ETH and requests no approval. The pot bonus is additional swap input, not a cash payout or standalone claim.

Sell flow: enter ONEW → quote including the ETH-leg sell tax → if necessary, separately simulate and sign `approve(PoolSwapTest, exactInput)` → wait for approval → refresh allowance/quote → review and simulate the sell → sign and observe receipt. Approval is exact, not unlimited. Neither Permit2 nor ERC-6909 claim settlement is used. Router settings are `takeClaims=false`, `settleUsingBurn=false`; hookData is empty because this hook does not attribute rewards to identities. There is no admin, pause, mint or claim action in the deployed hook.

### Price protection and limitations

PoolSwapTest accepts a sqrt-price limit but has **no minimum-output or on-chain deadline argument**. The page explicitly calls its setting “Price movement limit”, with 0.5%, 1% or 3% choices. It derives the square-root bound with integer arithmetic from the quoted slot0 price. This bounds pool price movement, including this trade's impact; it is not a guaranteed quoted output. The attested hook reverts partial fills.

The reviewed bound stays fixed during simulation/signing. The app refuses stale quotes after 45 seconds, refuses state older than 60 seconds, verifies chain/code/manager binding, simulates the exact router call, rejects a material output deterioration before signing, and checks gas funds. Account/chain are checked again immediately before signing. Wallet approval delays and mempool delays cannot be bounded by this router; changing bonus availability can also alter output. The page does not promise a minimum received amount. Failed or replaced transactions retain an explorer link; cancellation/replacement with a different action is not reported as a successful swap.

## Validation

```sh
npm --prefix web test
npm --prefix web run test:browser
node web/scripts/check-live.mjs
node web/scripts/check-export.mjs
```

The browser tests use mocked RPC and wallet responses; they never broadcast live transactions. They exercise the actual compiled `dist/` under `/preview/`. If the tool-managed preview is absent, Playwright starts and terminates `tests/serve.mjs` itself. Set `FRONTEND_PREVIEW_URL` to use another preview. Install Playwright's Chromium with `cd web && npx playwright install chromium`, or set `FRONTEND_CHROMIUM` to an existing browser executable. Keep browser downloads and package caches outside submitted source. Worker browser command:

```sh
FRONTEND_CHROMIUM=/home/imd1/.cache/ms-playwright/chromium-1246/chrome-linux64/chrome npm --prefix web run test:browser
```

`check-live.mjs` performs only RPC reads and `eth_call` quoter simulations. Full results, screenshot provenance, six-domain review and remaining unperformed checks are in [validation](../docs/frontend/VALIDATION.md); implemented design tokens are in [DESIGN.md](../docs/DESIGN.md).

## Scope and packaging

Only `web/`, `dist/` and new frontend documentation in `docs/` are deliverables. The explicit ignore-file budget is **one path: `web/.gitignore`**. Its dependency/cache patterns apply at every nesting level beneath `web/`. No other dotfile, root configuration, Solidity, libraries, GitHub workflows or submodules were changed. No vendored registry, node_modules, package cache or dependency archive is delivered.

The requested root `DESIGN.md` is supplied as `docs/DESIGN.md` because the overriding write allowlist excludes the root path. Publication, naming, CIDs, contract redeployment and live funded trading are outside this worker assignment.
