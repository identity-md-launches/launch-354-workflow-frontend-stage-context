# Frontend validation — Oneway

Worker review performed 2026-09-27. This is the worker's evidence, not an independent certification. Production code is in `web/`; the exported page and runtime deployment manifest are in `dist/`.

## Scope, assumptions and conflicts

The approved workflow, deployment handoff, network handoff, pinned Better Interface workflow/core principles for all six domains, and protected Hook/Token test definitions were read. The deployed Solidity was inspected to identify actual frontend actions, immutable rates, events, and `PartialFill` behavior. No contracts, protected tests, libraries, root configuration or root lockfiles were changed. The protected Foundry tests concern the already deployed source and were not rerun for this frontend-only assignment.

The site uses native ETH exact-input buys and ONEW exact-input sells. No admin or bonus-claim control was invented: neither exists in the implementation. The task's specific PoolSwapTest instruction takes precedence over its generic Universal Router guidance. The supplied network block remains unchanged; the required PoolSwapTest address is emitted as an additional manifest integration. Consequently, the contradictory generic requirement that *all* swap/approval addresses be in the supplied network block cannot literally be satisfied. This decision and the router's weaker price-protection interface are documented in `web/README.md` and disclosed in the form.

The request for a root `DESIGN.md` conflicts with the overriding write allowance. Its complete content is delivered at `docs/DESIGN.md`. Ignore-file budget: only `web/.gitignore`, explicitly allowed by the task.

## Executed checks

| Check | Result and evidence |
| --- | --- |
| `npm --prefix web run typecheck` | Pass, strict TypeScript; `typecheck.txt` |
| `npm --prefix web run build` | Pass; relative-base Vite export followed by manifest generation and verification; `build.txt` |
| `npm --prefix web test` | 5 passed: exact decimal parsing, integer sqrt-price bounds, signed BalanceDelta decoding, canonical ABI binding/tampering, nested quoter/hook revert decoding; `unit-results.txt` |
| `FRONTEND_CHROMIUM=… npm --prefix web run test:browser` | 13 passed against the production export under `/preview/`; `browser-results.json` |
| `node web/scripts/check-live.mjs` | All 3 supplied RPCs returned the configured chain, nonempty required contract code, matching hook/router manager, live pool state and a buy quote; `live-read-results.json` |
| `node web/scripts/check-export.mjs` | Pass: exact handoff fields/contract set, unchanged network, both canonical Keccak ABI hashes, every asset SHA-256, safe paths and size bounds |
| Supplied browser tool | Actual export visually reviewed at 1440×1100, 820×1100 and 320×900; live reads and buy/sell quote behavior inspected, keyboard select focus viewed |
| Static requests / console | No browser errors or warnings in inspected live session; no failed production asset loads; `browser-console.txt`, `browser-network.txt`, `final-browser-inspection.json` |
| Packaging | See `submission-size.json`; complete tracked content and a scratch-created full Git bundle were checked below 8 MiB; no dependency/cache/archive or submodule entries |

The Vite build emits a non-fatal warning for the approximately 535 KB main JS chunk (about 163 KB gzip). The complete export is below 0.6 MB; no external font or image downloads are required. This was not hidden by changing the warning threshold.

The initial npm install encountered the worker's read-only default cache; using the permitted `test/scratch/npm-cache` resolved it. One browser rerun encountered an installed Chromium revision mismatch; explicitly selecting the provided Chromium executable resolved it. Those failed setup attempts are not counted as passing tests.

## Meaningful interaction coverage

The mock tests route every wallet/RPC operation to fixtures and never broadcast to Sepolia. Assertions inspect decoded transaction arguments rather than relying only on button text.

1. Disconnected public reads, independent typed `bonusFor`, price, event feed and missing-wallet recovery.
2. Wrong chain, 4902 switch failure, exact `wallet_addEthereumChain` payload and a second switch; no accidental transaction.
3. Buy review/confirm, simulation before signing, exact native input/value, correct pool/hooks, price-limit direction, no approval, successful receipt.
4. Sell exact-amount approval to PoolSwapTest as a separate step, receipt/allowance refresh, followed by a zero-native-value sell.
5. Swap simulation revert with partial-fill recovery; no signature request.
6. Wallet connection rejection and retry.
7. Missing required contract code blocks trading.
8. Quote failure keeps the independent buy-bonus read and disables trading.
9. Negative/invalid amounts, insufficient balance, changed input and account disconnection invalidate review.
10. Tampered implementation ABI prevents RPC actions and trading.
11. Responsive reflow at 1440, 820, 680, 375 and 320 CSS pixels; keyboard skip link and refresh control; reduced-motion behavior; automated accessibility scan; 200% root-font enlargement.
12. Quote expiry prevents confirmation; explicit refresh restores eligibility.
13. RPC outage displays a recovery instruction and disables dependent actions.

## Better Interface consolidated review

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native headings/landmarks/form controls, persistent field labels, `aria-invalid`, button-group pressed state, skip link, visible focus, 44px target patterns, status/alert regions, reduced motion. Keyboard interactions and axe-core run. Automated review flagged the fee group's unsupported label; corrected with an explicit group role. A real screen-reader session was not performed. |
| Layout | Checked | Desktop, intermediate and mobile screenshots; no page overflow at five tested widths. Contract disclosure uses wrapping full addresses, the trade/explanation grids stack and event rows adapt. 200% text enlargement passed. Browser-native zoom, RTL and localization are not verified. |
| Writing | Checked | Explicit buy/sell/approve/review/confirm verbs, no-value notice, fees distinguished, bonus described as swap input, empty/error/retry copy, quote freshness and router-limit disclosure. Raw RPC errors were supplemented with a visible retry instruction. |
| Typography | Checked | Source scale, descending heading hierarchy, system-font stack, actual rendered wrapping, tabular monetary digits, selectable/wrapping identifiers, 16px+ input controls. Platform-specific font availability and physical iOS behavior were not verified. |
| Colors | Checked | Semantic tokens reviewed; actual rendered foreground/background pairs measured (see `rendered-contrast.json`): normal muted text 5.21–5.68:1, action text 10.39:1, pot text 7.67–11.27:1. Status is textual as well as colored. One light theme; no dark theme requirement. |
| UI | Checked | Hover/source rules, pressed/selected/disabled/loading/error/empty/review/confirmed states, aligned SVG icons, restrained surfaces, natural document flow. Screenshot review at three widths. Reduced-motion emulation passed. No animation timeline slow-motion inspection; no overlays, media or charts are present. |

`accessibility-results.json` records 43 automated rule passes and zero violations. Remaining automated “incomplete” contrast checks concern non-text characters (`≈` and a decorative coin); the relevant foreground/background tokens were separately checked. This does not establish complete WCAG compliance.

## Findings, corrections and rechecks

| Severity | Location | Observed issue and impact | Correction and evidence |
| --- | --- | --- | --- |
| Medium | `web/src/App.tsx:150` | Fee labels used `aria-label` on a generic div; axe requested manual review because the name may not be announced. | Added `role="group"`; reran production build and accessibility/browser checks. |
| Medium | `web/src/App.tsx:55` | Mock RPC outage produced viem's generic invalid-parameters message without an app-level recovery action. | Added “Check your connection and use Refresh pool data to retry”; outage test passes with trading disabled. |
| Medium | `web/src/chain.ts:119`, `web/scripts/shared.mjs` | Live sell quote exposed opaque selector `0x6190b2b0`, hiding the nested hook failure. | Exported `UnexpectedRevertBytes` and decoded nested quoter/PoolManager errors with loaded ABIs. Live sell now reports `PartialFill` with recovery guidance; unit and browser checks pass. |
| Medium | `web/src/chain.ts:105` | Source review found gas estimation could outlast the prior quote-expiry check. | Added a freshness check after gas estimation and final account/chain verification. Expiry interaction test passes; artificially slow gas-estimation timing was not separately injected. |
| Medium | `web/src/chain.ts:109` | Source review found a successful cancellation/replacement receipt could be labeled as the original swap's success. | Treat only repricing as equivalent; a different replacement/cancellation reports that the visitor should inspect the explorer. This branch was source-reviewed, not exercised against a real replacement. |

No known unresolved implementation finding blocks the specified browser flows. The first two source/type errors found during implementation were repaired before the successful typecheck and build. Setup failures and earlier failing mock expectations were corrected and rerun; final artifacts contain the passing reports.

## Live-chain observations and limits

The handoff source is `b616e7acde036293543346c60d811dd53a7e7020`; both implementation ABI hashes match. The RPC probes verified ONEW, hook, PoolManager, PoolSwapTest, StateView and Quoter have nonempty code. This proves presence and manager binding, not bytecode equivalence to an independently verified attestation; the publisher's admission checks remain separate.

At the recorded blocks the pot was zero, fee was 3000, token decimals 18, and sell-tax constant 200 bps. Live StateView implied approximately 50,000,000 ONEW/ETH, different from the handoff's historical initial price. A 0.0001 ETH buy quote returned approximately 4,962.985601 ONEW. A 1 ONEW sell quote reverted with nested `PartialFill` on all three RPCs. The current pool cannot complete that sell; the interface reports the condition and disables the action. Empty recent-event history was observed live. Tax/bonus populated history and successful approval/buy/sell receipt UI were validated with mocks.

No live wallet was connected, no real approval or swap was signed or broadcast, and funded/live settlement behavior remains untested. PoolSwapTest offers no minimum output or on-chain deadline. Price bounds, preflight simulation and UI expiry are implemented, but delayed signing/mining and bonus changes can change output. Native wallets, screen readers, physical mobile devices, real replacements/reorgs, every RPC failure mode and full historical event indexing are not verified. IPFS publication, fixed CID/named-entrypoint checks and URL/CID issuance belong to the later publisher/control plane.

## Screenshot provenance

- `desktop-live.png`: supplied browser tool, 1440px, live public reads and typed buy quote, no wallet. Visible keyboard focus on the price-limit select.
- `mobile-live.png`: supplied browser tool, 320px, same live state.
- `desktop-connected.png`: Playwright, 1440px, **mock** wallet and successful mock buy receipt/event feed.
- `mobile-320.png`: Playwright, 320px, **mock** RPC/typed amount, disconnected wallet.

The actual screenshots were inspected; mock balances and events are not represented as live chain evidence. Production source was rebuilt after the final source correction, with the manifest regenerated from final bytes.

## Completion and Git limitation

The frontend source, lockfile, static export and worker validation are complete within the allowed write scope, with the documented router/path requirement conflicts. `git add -- web dist docs` failed because this workspace mounts `.git` read-only (`index.lock: Read-only file system`). Therefore this worker could not stage or commit the delivery in the task repository. All deliverables remain present for the publisher's submission process; no Git permission workaround was attempted on the protected repository. A disposable scratch clone was used only to measure a representative complete submission bundle and is excluded from delivery.
