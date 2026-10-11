# Geo Duels — Project Memory

Last updated: 2026-10-11, Asia/Calcutta.

## User decisions

- Product: Geo Duels / `geopump`: two friends see the same random supported Earth location, guess on a map, and the closer wins their equal-stake pot.
- Keep user flow simple and rounds short, with a visible countdown and Solana wallet stake controls inspired by the supplied half/2×/MAX image.
- Use a retro 1990s computer desktop aesthetic based on the supplied MSN Messenger/Windows XP reference.
- Build the full product, delegate specialized work to agents, use real geolocations, proper payout math, and working user actions.
- Initial chain: **Solana devnet with test SOL**.
- Push the code to `https://github.com/debojyoti10CC/geopump.git`, branch `main`, with README heading `# geopump` and initial commit message `first commit`.

## Implemented design

- Exact equal stake range: 0.001–1 SOL, stored as lamports; zero house fee.
- 30-second round; invitation expiry 15m; ready-to-start window 60s; referee settlement 5m then wallet-triggered refunds.
- Synchronized, nonce-bound wallet-signed guesses. Haversine distance, Earth radius 6,371,000 m, nearest whole metre.
- Closest guess receives 2S; exact tie returns S each; a single valid guess at timeout receives 2S; no guesses returns S each.
- Native Solana escrow PDA stores deposits/outcome, direct atomic transfer, no repeat payout; account rent is separate and returned to its payer on close.
- Licensed but limited Panoramax scene pool. Target catalog encrypted in source; runtime secret `GEO_SCENE_SECRET` is needed. Target and opponent guess are hidden during active room.
- Cloudflare Worker + D1, private session cookies backed by signed wallets, service settlement/refund, independent room reconciliation.
- Visual style: Windows 95/XP blue window bars, beveled controls, desktop shortcuts, panorama/map duel view, explicit rematch; no auto-stake.

## Current delivery status

- Frontend, backend/D1 API, native escrow source/client/referee, local licensed scenes, and first-pass unit/security tests exist in `outputs/geo-duels/`.
- Service agent reports `node --test tests/game-service.test.mjs`: 9 passed, 0 failed; includes privacy, signatures, replay/tamper, concurrency, scoring, timeout, and fail-closed escrow checks.
- Both D1 migrations must be applied in order: `0000_geo_duels.sql`, then `0001_pin_escrow_authorities.sql`.
- Still requires final integrated build, local API/worker check, on-chain devnet deploy/execution evidence, Sites deployment, and GitHub push. Never claim these complete until verified.
- Devnet referee/scene secrets are ignored under `.secrets/`/`.dev.vars`; do not copy secret values to source or logs.
- Owner-private Sites deployment is the default audience. Do not change site access unless the user explicitly requests it.

## Fairness and safety caveats

The escrow enforces that the pinned referee can submit only a committed result for the recorded players and pay once; timeout refunds do not need its secret. The hosted referee still chooses scenes, validates guesses, and calculates scores. Commitment/reveal permits checking after a round, not trustless selection or scoring. This is a test-SOL prototype, not audited and not approved for mainnet or real-money use.

## Continuity

Keep Architecture.md, Rules.md, Phases.md, and this file in sync with shipped code. In final status report distinguish implementation, test evidence, actual chain transactions, deployment, and repository push. Cite repo path exactly; do not report an unverified deployment or mainnet safety.
