# Geo Duels — Project Memory

Last updated: 2026-10-11, Asia/Calcutta.

## User decisions

- Product: Geo Duels / `geopump`: two friends see the same random supported Earth location, guess on a map, and the closer wins their equal-stake pot.
- Keep user flow simple and rounds short, with a visible countdown and Solana wallet stake controls inspired by the supplied half/2×/MAX image.
- Use classic Windows 95 from the latest reference: teal desktop, gray beveled panels, navy bars, square controls, red countdown.
- Game only: remove practice and marketing header. Maps preserve 2:1 proportions, support drag after zoom/lock, and connect guesses to the target only after reveal.
- Build the full product, delegate specialized work to agents, use real geolocations, proper payout math, and working user actions.
- Initial chain: **Solana devnet with test SOL**.
- Push the code to `https://github.com/debojyoti10CC/geopump.git`, branch `main`, with README heading `# geopump` and initial commit message `first commit`.

## Implemented design

- Exact equal stake range: 0.001–1 SOL, stored as lamports; zero house fee.
- 30-second round; invitation expiry 15m; ready-to-start window 60s; referee settlement 5m then wallet-triggered refunds.
- Synchronized, nonce-bound wallet-signed guesses. Haversine distance, Earth radius 6,371,000 m, nearest whole metre.
- Closest guess receives 2S; exact tie returns S each; a single valid guess at timeout receives 2S; no guesses returns S each.
- Native Solana escrow PDA stores deposits/outcome, direct atomic transfer, no repeat payout; account rent is separate and automatically returned to its recorded payer after the terminal timestamp plus 24 hours. The operator pays the closing fee; D1 tracks completion.
- Licensed but limited Panoramax scene pool. Target catalog encrypted in source; runtime secret `GEO_SCENE_SECRET` is needed. Target and opponent guess are hidden during active room.
- Cloudflare Worker + D1, private session cookies backed by signed wallets, service settlement/refund, independent room reconciliation.
- Visual style: Windows 95 game-only duel view, navy window bars, beveled controls, 2:1 map with movable zoom, result-only connecting lines and explicit rematch; no auto-stake or simulated players.

## Current delivery status

- Frontend, backend/D1 API, native escrow source/client/referee, local licensed scenes, and first-pass unit/security tests exist in `outputs/geo-duels/`.
- `node --test tests/game-service.test.mjs`: 14 passed, 0 failed; covers privacy, signatures, replay/tamper, concurrency, scoring, timeout, fail-closed escrow, receipt recovery, exact rent timing/recipient, close markers and wallet-funded recovery without an operator secret.
- Native Rust program: 7 checks pass. Client: 4 checks pass. Local validator execution: 15 confirmed transactions with exact winner/tie payouts, refunds, rent accounting, invalid commitment and replay rejection, recorded in `chain/e2e-receipts.json`.
- Executable devnet program deployed: `9knNnYeDQh1suoAx6tmhAgtmsYQvcoguTn6CkssZArsU`, verified in `chain/deployment.json`. Referee was funded with 5 devnet SOL.
- Full deployed API round **GYHZPJ passed** on 2026-10-11: two confirmed deposits, two signed guesses, target hidden during play, and exact **2,000,002-lamport** winner payout. Evidence: `chain/devnet-game-receipt.json` and [confirmed payout](https://explorer.solana.com/tx/CyxbQPagrYKGwCZQYoz4auQeYYYvsUCL9qqmLLPzPVckCWTb8jB43kFSiurHrsNsV28dEgrKqkcF8ZpVnoVtZ94?cluster=devnet).
- Official RPC returned HTTP 403 from the Worker; runtime uses the verified public OnFinality devnet endpoint `https://solana-devnet.api.onfinality.io/public`. Worker HTTP confirmations and server RPC pacing were fixed; all 14 service tests passed again.
- Sponsor: `https://deployer.devnet.solana.com`; idle retention seven days. Sponsor holds upgrade authority `FEvT5nka9qBSXryv65P8ScjvGtfLUE7LgPu1rzuJ38h8`; registered upgrade owner is recorded separately in the deployment file. Do not present this sponsored prototype as permanently hosted or immutable.
- Apply D1 migrations in order: `0000_geo_duels.sql`, `0001_pin_escrow_authorities.sql`, `0002_reclaim_escrow_rent.sql`.
- Final browser/public Site checks, Sites publication and GitHub push remain pending. Deployed two-wallet API verification is complete; never infer publication from that evidence.
- Devnet referee/scene secrets are ignored under `.secrets/`/`.dev.vars`; do not copy secret values to source or logs.
- Owner-private Sites deployment is the default audience. Do not change site access unless the user explicitly requests it.

## Fairness and safety caveats

The escrow enforces that the pinned referee can submit only a committed result for the recorded players and pay once; timeout refunds do not need its secret. The hosted referee still chooses scenes, validates guesses, and calculates scores. Commitment/reveal permits checking after a round, not trustless selection or scoring. This is a test-SOL prototype, not audited and not approved for mainnet or real-money use.

## Continuity

Keep Architecture.md, Rules.md, Phases.md, and this file in sync with shipped code. In final status report distinguish implementation, test evidence, actual chain transactions, deployment, and repository push. Cite repo path exactly; do not report an unverified deployment or mainnet safety.
