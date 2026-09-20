# Brand — Stelpools

_Status: active · updated 2026-09-20 at the user's request_

## Direction

The current Bitstamp website is the visual reference: forest-green hero sections,
bright green text highlights, editorial serif headings, generous whitespace,
light surfaces, flat rectangular actions, fine dividers and a structured footer.
Stelpools retains its own name, wordmark and product claims.

## Tokens

Source of truth: `web/src/index.css`. This is a light interface with dark hero
sections; the previous Vault Blue theme and `.brand-preview` generator are retired
and must not be run over these tokens.

- Forest / hero / buttons: `--forest: #062e24`
- Bright accent / highlights: `--lime: #16f58b`
- Accessible green for text and links: `--primary: #086844`
- Background: `--background: #fafbf9`
- Cards: `--card: #ffffff`
- Text: `--foreground: #092f26`
- Secondary text: `--muted-foreground: #59665f`
- Section background: `--mint: #eaf2e9`
- Dividers: `--border: #d9e1da`

Bright green is paired with forest text, never white text. Inline links use the
darker accessible green. Semantic errors retain red.

## Type and layout

- Editorial headings: Georgia / Times New Roman / serif.
- Interface and body: DM Sans / system sans.
- Financial values: DM Mono, tabular numbers (`.tnum`).
- Content width: 1200px. Gutters: 48px desktop, 32px tablet, 20px mobile.
- Panels and buttons use a 4px radius; the decorative product window uses 12px.
- Reference artwork is recreated as lightweight CSS / SVG illustrations.
- Navigation collapses to a keyboard-accessible mobile menu.

## Copy

All new product copy is available in Turkish and English using the existing
language preference. Existing transaction translations remain in `i18n.ts`;
editorial translations use `useCopy`.

Describe the actual product: TRY anchor transfers, Stellar USDC, vault shares,
fees and liquidity. Do not import Bitstamp's customer counts, licenses, rates,
security guarantees or unsupported products. Testnet and simulated bank transfers
must stay clearly identified. Never invent a live price or yield.

## Logo

Use `/logo-dark-bg.png` (near-black transparent wordmark) on light backgrounds.
Use `/logo.png` (white transparent wordmark) on dark backgrounds. Keep the existing
brand artwork and its proportions.
