# Geo Duels — Delivery Phases

## Current delivery — devnet prototype

- [x] Build the Windows 95 game-only UI, 30-second countdown, stake shortcuts, friend rooms, movable zoomed map, result-only connecting lines, and manual rematch.
- [x] Implement D1 room/session/guess persistence and wallet-signed authorization.
- [x] Implement integer-lamport escrow instructions, fixed deadlines, winner/tie payout, cancellation, timeout refunds, and program unit checks.
- [x] Add licensed Panoramax 360° scenes; encrypt target catalog at rest and keep active-room answer data private.
- [x] Add service tests covering wallet signatures, guess privacy/tampering/replay, concurrency, distance/payout cases, timeouts, and fail-closed escrow.
- [x] Recover confirmed settlement receipts safely; schedule original-payer rent return after the terminal timestamp plus 24 hours.
- [x] Pass 15 service, 7 native Rust, and 4 client tests; record local-validator transaction evidence.
- [x] Deploy executable program `9knNnYeDQh1suoAx6tmhAgtmsYQvcoguTn6CkssZArsU` to Solana devnet and fund its referee with 5 test SOL.
- [x] Verify a full two-wallet API duel against the deployed program: two confirmed deposits, two signed guesses, private active target, exact winner pot and confirmed payout.
- [x] Publish the Sites Worker with D1 and a minute cron, route the public Vercel site to it, and verify `/api/config` reports escrow ready.
- [x] Publish the project source to GitHub.
- [ ] Complete the full funded duel verification through the current public Vercel route and save its confirmed receipt.

Do not mark the end-to-end game complete from unit tests or a successful static build alone. Save the two-wallet chain receipts and deployed program/site references as completion evidence.

Earlier deployed-program round **GYHZPJ** passed. `chain/devnet-game-receipt.json` records the exact **2,000,002-lamport** winner pot and [confirmed payout](https://explorer.solana.com/tx/CyxbQPagrYKGwCZQYoz4auQeYYYvsUCL9qqmLLPzPVckCWTb8jB43kFSiurHrsNsV28dEgrKqkcF8ZpVnoVtZ94?cluster=devnet). The current public site is [geopumpp.vercel.app](https://geopumpp.vercel.app/), backed by the published Sites Worker. Private Helius devnet RPC replaced the rate-limited public provider; its key stays in server secrets. All 15 service tests passed, including the exact trusted proxy-origin regression.

The sponsored deployment has seven-day idle retention and sponsor-held upgrade authority; plan continued availability or replacement before relying on it beyond this prototype.

## Next phase — operational confidence

- Independently review the native program and the hosted referee trust assumptions.
- Exercise waiting expiry, cancellation races, a stale/failed settlement, and both timeout-recovery branches on devnet.
- Check scheduled settlement, timeout refunds and 24-hour rent sweeps, log redaction, secret rotation and room migration behavior.
- Verify panorama attributions, mobile layout, accessibility, and supported map/panorama interactions.
- Add an operator playbook for pausing room creation, replacing a referee key for new rooms, refunds, and devnet RPC outages.

## Future real-SOL release (not authorized)

- Complete a security audit and address findings.
- Define program upgrade authority, referee decentralization or proofs, randomness quality, dispute process, monitoring, and key recovery.
- Resolve product, legal, jurisdiction, age, and gambling eligibility obligations before accepting real value.
- Set final stake and fee policy and obtain explicit user authorization before any mainnet deployment or funded action.

Never switch the devnet site or wallet instructions to mainnet as an implementation shortcut. The current feature boundary remains one equal-stake, two-player geography round; leaderboards, public matchmaking, chat, tournaments, bots, and tokens are out of scope.
