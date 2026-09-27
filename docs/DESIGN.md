# Oneway implemented design

## Overview

A single-page Sepolia trading experiment for people exploring ONEW's asymmetric sell tax. The interface makes the economics visible before the transaction: headline and fee strip, shared bonus pot, swap form, event feed, then explanation and contract disclosure. Warm neutral surfaces, dark green text and a pale green action fill create a calm, legible interface. This direction was inferred from the task, not provided as a brand brief.

The implementation is `web/src/App.tsx` and `web/src/styles.css`. This file resides under `docs/` to honor the assignment's overriding path allowance; no root DESIGN.md was created.

## Colors

All recurring roles are CSS custom properties in `web/src/styles.css:1`. The project uses hex values consistently and implements one light theme.

| Token | Value | Role |
| --- | --- | --- |
| `--page` | `#f5f4ef` | Page background |
| `--surface` | `#fffefa` | Swap card, inputs, selected direction |
| `--subtle` | `#eeeee6` | Estimate well, segmented-control track, disabled primary |
| `--text` | `#25322a` | Main text, wordmark |
| `--muted` | `#62685e` | Secondary text and descriptions |
| `--border` | `#d9dcd0` | Structural separators and cards |
| `--control-border` | `#818779` | Input, select, review and secondary-button boundaries |
| `--accent` / `--accent-hover` | `#d8ef9e` / `#c8e486` | Primary action fill |
| `--accent-text` | `#263521` | Text on primary actions |
| `--dark` / `--on-dark` | `#26382e` / `#f2f5e9` | Bonus pot surface and principal text |
| `--dark-muted` | `#c2cfbb` | Secondary pot text |
| `--error` / `--error-bg` | `#982f27` / `#faece6` | Error text and wrong-network notice |
| `--focus` | `#376624` | Focus outline, testnet marker |

Small supporting values: `#637761` for pot outlines; `#e8e9e7` and `#39403b` for the decorative ETH symbol. Status always has text; green dots alone do not establish connection or success. Filled accent identifies the current primary action; its preceding review action becomes neutral when disabled.

Measured browser contrast: muted text on page 5.21:1; muted text on swap surface 5.68:1; primary text on accent 10.39:1; secondary pot text 7.67:1; pot value 11.27:1. Exact computed pairs are in `frontend/rendered-contrast.json`. These measurements describe those sampled states, not a blanket compliance claim.

## Typography

System stack: `'Segoe UI', 'Helvetica Neue', Arial, sans-serif`; no font downloads or font assets. The browser's actual available fallback can vary. Weights used are 400, 500, 600 and 700; font synthesis is disabled. Code/addresses use `ui-monospace, SFMono-Regular, Consolas, monospace`.

Base body is 16px/1.55. Tokens: caption 13px, small 14px, body 16px, section 24px. Large desktop heading scales from 44.8px to 70px with 1.04 line height and −.065em letter spacing; explanatory lead is 17px/1.65. Section headings use 1.25 line height; component headings are 17–21px. Eyebrows are 11px, uppercase through CSS, 600 weight and .13em tracking. Operational metadata is 11–13px, with descriptions at 12px/1.6.

Amounts use tabular numbers; input text is 28–32px, and the select is 16px, including mobile. Headings use balanced wrapping and prose uses pretty wrapping. Descriptions are capped by character measure. Addresses wrap and full values are available in contract disclosure; shortened connected addresses have a full-value title. Full monetary amounts are shown in review while estimate display deliberately limits precision. No USD valuations are invented.

## Layout

`.shell` is capped at 1200px including 36px inline padding. The desktop trade section has a flexible pool column and a 450px form column, separated by 80px. The semantic order is always pool context → trading → activity → explanation → deployment details. The form is in normal flow, with no fixed panel covering content.

Spacing uses a compact 4/8/12/16/20/24/28/32px vocabulary inside components and 36/48/60/80px between sections. The three fee figures share aligned column edges; the shared pot groups state by background rather than many borders.

Breakpoints reflect content fit:

- At 64rem, the trade gap becomes 36px and the form column 420px.
- At 53rem, header anchor navigation hides; both columns share available space, horizontal padding becomes 24px and form padding 20px.
- At 44rem, trading and explanations stack, header/wallet controls wrap, and event transaction hashes give way to accessible labeled link icons.
- At 24rem, gutters become 16px, form padding 18px and event rows wrap their value onto a second line.

Observed at 1440, 820, 680, 375 and 320 CSS pixels without horizontal page overflow. Browser screenshots were visually reviewed at desktop, 820 and 320. Automated 200% root-font enlargement also passed reflow; native browser zoom and real mobile devices were not tested.

## Elevation & Depth

The bonus pot is a flat dark surface. The form uses two restrained shadows (`0 4px 20px #25322a05`, `0 1px 2px #25322a04`) and a structural border. The selected direction has a small neutral shadow. No gradients, overlays or modals are used. Inline review keeps transaction context visible.

## Shapes

The shared radius token is 20px, control radius 10px. Form radius is 24px (20px at the narrowest breakpoint), nested fields and wells 12px, segmented track 12px with 8px child buttons. Small labels use 5–6px corners. Coin/arrow decorations and the refresh button use circles. The event empty state has a dashed border, distinguishing it from populated rows.

## Components

`App.tsx` contains page patterns rather than a separate component library:

- `Arrow`: one inline decorative SVG, 1.8px stroke, optional diagonal direction; uses currentColor.
- `External`: a real link with a new-tab announcement, noreferrer, and a decorative arrow.
- `.button`: 48px minimum height, compact 44px variant; `.primary` is 54px and full width. Explicit hover, focus, disabled and busy text states.
- `.direction`: two native buttons with `aria-pressed`, which retain native Tab/Enter/Space keyboard behavior. It is a button group, not an ARIA tab widget.
- `.amount-field`: persistent label, decimal keyboard, visible unit, balance, validation association and `aria-invalid`. Controls disable when a transaction is pending.
- `.bonus-preview` / `.receive-box`: distinct bonus and output estimates. Missing data is an em dash; loading is labeled; no fabricated zero balances.
- `.review-box`: exact input, estimated output, price-limit explanation, confirm/cancel controls, with no modal focus trap.
- `.event-list` / `.empty-state`: textual event types, block numbers, amounts and explorer links. Separate empty, loading and retryable error content.
- `.deployment-details`: native details/summary disclosure for full addresses, pool ID and manifest provenance.

Keyboard focus uses a 3px outline with a 4px offset; forced-colors mode preserves system Highlight. The skip link is first. Main, heading order, native form elements and stable status regions support navigation. The reduced-motion default removes button transforms; 120ms background/press transitions and `.96` press scale are enabled only under `prefers-reduced-motion: no-preference`. Hover changes are gated by pointer capability.

## Do's and Don'ts

Reuse `.shell`, the role tokens, actual form patterns and source-defined spacings. Keep economic explanations close to consequential controls. Label estimated quantities and preserve the separation between LP fees, sell tax and buy bonus. Use the manifest and live reads for financial state; never replace unknown values with plausible numbers.

To extend the page, use an h2 section under main, group content with space, use existing neutral surfaces, and reserve the accent fill for the next action. Keep full identifiers accessible and controls at least 44px where practical. Do not add price charts, profit promises, dark-theme tokens, animation dependencies or bespoke icons without a real task requirement.

Design guidance applied: Jakub Krehel's Better Interface, MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`; documentation method adapted in the supplied guide from Paul Bakaus's Impeccable, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. The supplied pinned reference, rather than a fetched revision, governed the six-domain review.
