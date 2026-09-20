# Bitstamp reference and Stelpools implementation

Reviewed on 2026-09-20. The public reference was the current Bitstamp by Robinhood
site, not the older blue / sans-serif identity.

## Inspected page templates

- https://www.bitstamp.net/ — dark forest hero, fluorescent green highlighted
  serif title, app artwork, feature columns, product sections, numbered steps,
  light multi-column footer.
- https://www.bitstamp.net/crypto-staking/ — light product intro, highlighted
  title, green line illustrations, asset details and explanatory copy.
- https://www.bitstamp.net/pro/ — dark editorial product hero, product preview.
- https://www.bitstamp.net/about-us/ — light highlighted heading, illustrated
  columns, long-form company information.
- https://www.bitstamp.net/fee-schedule/ — editorial title, promotion and fee content.
- https://www.bitstamp.net/faq/ — large serif questions with horizontal separators
  and expand controls.
- https://www.bitstamp.net/mobile/ — light hero and prominent product metrics.
- https://www.bitstamp.net/institutional-trading/ — dark hero and line illustrations.
- https://www.bitstamp.net/onboarding/login/ — attempted; initial capture was blank.

This is a review of public page templates. It is not an exhaustive crawl of all
legal, API, article, market-detail or authenticated account pages.

## Application map

- `#/home`: editorial landing, product preview illustration, features, liquidity
  section, onboarding steps, CTA.
- `#/vault`: existing live pool, position, chart, swap, activity and requirements.
- `#/vault/deposit`, `#/vault/withdraw`: direct links to existing transaction tabs.
- `#/learn`: onboarding and searchable native disclosure FAQ.
- `#/fees`: fee explanation, with current values available from the live pool.
- `#/about`: protocol overview, contract explorer and material risks.

All pages share responsive navigation, language controls, wallet integration and
footer. Financial transaction implementations are retained. No authentication,
identity data, or live transactions are performed as part of visual verification.

## Verification

- `npm run build`: passed; existing wallet/SDK bundle-size advisory remains.
- `npm run lint`: no errors; two existing Fast Refresh export warnings in
  `Requirements.tsx` remain.
- Browser: home, about, fees, help, and live vault render. Public testnet vault
  balances, event chart, history and anchor quote loaded successfully.
- 375px mobile: home, help, fees and withdrawal view have no horizontal overflow.
- Mobile menu: opens, Escape closes and restores trigger focus.
- FAQ search: matching question, no-result state and expanded answer verified.
- Direct deposit link selects Deposit; ArrowRight selects Withdraw and updates URL.
- Turkish/English editorial copy and language control verified.
- No wallet signatures or financial transactions were submitted during testing.
- 768px tablet and 1280px desktop home layout checked; no horizontal overflow.
- Turkish mobile home and about layouts checked at 375px.
