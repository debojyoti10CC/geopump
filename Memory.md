# Geo Duels — Project Memory

Last updated: 2026-10-13, Asia/Calcutta.

## User decisions

- Product: Geo Duels / `geopump`: two friends see the same random supported Earth location, guess on a map, and the closer wins their equal-stake pot.
- Keep user flow simple and rounds short, with a visible countdown and Solana wallet stake controls inspired by the supplied half/2×/MAX image.
- Use classic Windows 95 from the latest reference: teal desktop, gray beveled panels, navy bars, square controls, red countdown.
- Game only: remove practice and marketing header. Maps preserve 2:1 proportions, support drag after zoom/lock, and connect guesses to the target only after reveal.
- Build the full product, delegate specialized work to agents, use real geolocations, proper payout math, and working user actions.
- Initial chain: **Solana devnet with test SOL**.
- Latest small follow-up: show a live USDC market reference beside the chosen SOL stake and pot, without changing deposited tokens or payout mathematics.
- Publish at `https://github.com/debojyoti10CC/geopump.git`, branch `main`; initial commit message was `first commit`. Latest README request uses a centered geopump title/badges, actual product screenshot, game flow, architecture, setup, configuration, source map and evidence, inspired by the supplied Soleil structure without copying its assets/claims.

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
- `node --test tests/game-service.test.mjs`: 15 passed, 0 failed; covers privacy, signatures, replay/tamper, concurrency, scoring, timeout, fail-closed escrow, receipt recovery, rent timing/recipient, close markers, wallet-funded recovery without an operator secret, and exact trusted proxy-origin handling.
- `npm test` now runs **40 passing Node tests**: 15 service + 4 client + 9 referee + 2 wallet + 10 relay. Native Rust adds 7 passing tests, for 47 total. `npm run check` checks TypeScript. Local-validator transaction evidence covers winner/tie payouts, refunds, rent, commitment and replay checks in `chain/e2e-receipts.json`.
- Executable devnet program deployed: `9knNnYeDQh1suoAx6tmhAgtmsYQvcoguTn6CkssZArsU`, verified in `chain/deployment.json`. Referee was funded with 5 devnet SOL.
- Full public round **WG4UB2 passed**: both deposits, two signed guesses, hidden target, authenticated panorama `200`, anonymous panorama `404`, and exact **2,000,002-lamport** winner balance increase. Evidence: `chain/devnet-game-receipt.json` and [payout](https://explorer.solana.com/tx/bn3RyeAnpKaxfq1qV2DRULxRxPPbjwdZfncFBKFGjip27n8m8Z2UQa35hUZh1CRgFTiuG7rwD7PrTYYZcxHjTMb?cluster=devnet).
- The user's room **TASTNV** finalized a [0.002 SOL two-player payout](https://explorer.solana.com/tx/3R54WRH9XSXe2VnDfku3YBaDbtfaaKoaN9yG3E68Z5V73KEcDddTzbuthsmASfHR69B8mYw9p25X8jPGdQbPf144?cluster=devnet).
- Official Worker RPC returned HTTP 403, public OnFinality was rate-limited and Helius intermittently returned missing accounts. Active server and wallet RPC is `https://geopumpp.vercel.app/api/rpc`, a Vercel Node.js 22 bounded relay to fixed official devnet. Helius key remains stored privately but inactive; no automatic fallback is wired. Never publish any credential. Worker confirmations use HTTP polling and paced requests.
- Sponsor: `https://deployer.devnet.solana.com`; idle retention seven days. Sponsor holds upgrade authority `FEvT5nka9qBSXryv65P8ScjvGtfLUE7LgPu1rzuJ38h8`; registered upgrade owner is recorded separately in the deployment file. Do not present this sponsored prototype as permanently hosted or immutable.
- Apply D1 migrations in order: `0000_geo_duels.sql`, `0001_pin_escrow_authorities.sql`, `0002_reclaim_escrow_rent.sql`.
- Public site: `https://geopumpp.vercel.app/`, proxying UI/API/media to `https://geo-duels-arcade.ddmpersonalworkspace.chatgpt.site`; Vercel separately executes `/api/rpc`. Sites owns D1, encrypted scenes, referee and minute cron. GitHub source is published at `https://github.com/debojyoti10CC/geopump`.
- Final visual/flow publication succeeded: Sites runtime version 6, deployment `appgdep_6acc478809cc8191b94a0e2560652962`, version ID `appgprj_6acae8e608888191ba6c512952ff57da~appgver_b091543f1744819186f75b6579a88f27`, environment revision 8, verified runtime source `66866d7ba317616de31bad54435b0decd8db770e`. A following docs-only Git commit may differ; do not equate current Git HEAD with this runtime source without checking.
- Funded public two-wallet verification and final UI/flow publication are complete. Approved README screenshot `public/geopump-preview.jpg` shows the actual public game. Root is performing final live checks and pushing the documentation updates; do not claim that push finished before its confirmation.
- USDC reference follow-up: client-only Coinbase SOL-USDC quote on mount and each 60-second refresh, bounded request timeout and unavailable fallback for failed/stale data. Caption identifies a test-SOL market reference; funds stay native SOL. This follow-up's new publication is pending. Preserve the version 6 record above as the last verified runtime until root confirms the new release. Existing test counts are unchanged.
- Devnet referee/scene secrets are ignored under `.secrets/`/`.dev.vars`; do not copy secret values to source or logs.
- The current Vercel site and its backing Sites Worker are public. Preserve existing access and secret boundaries during later changes.

## Fairness and safety caveats

The escrow enforces that the pinned referee can submit only a committed result for the recorded players and pay once; timeout refunds do not need its secret. The hosted referee still chooses scenes, validates guesses, and calculates scores. Commitment/reveal permits checking after a round, not trustless selection or scoring. This is a test-SOL prototype, not audited and not approved for mainnet or real-money use.

## Continuity

Keep Architecture.md, Rules.md, Phases.md, and this file in sync with shipped code. In final status report distinguish implementation, test evidence, actual chain transactions, deployment, and repository push. Cite repo path exactly; do not report an unverified deployment or mainnet safety.
