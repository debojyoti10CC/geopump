# Geo Duels — Delivery Phases

## Current delivery — devnet prototype

- [x] Build the 90s desktop-style UI, short 30-second round, stake presets, friend rooms, map guess, result, practice mode, and manual rematch.
- [x] Implement D1 room/session/guess persistence and wallet-signed authorization.
- [x] Implement integer-lamport escrow instructions, fixed deadlines, winner/tie payout, cancellation, timeout refunds, and program unit checks.
- [x] Add licensed Panoramax 360° scenes; encrypt target catalog at rest and keep active-room answer data private.
- [x] Add service tests covering wallet signatures, guess privacy/tampering/replay, concurrency, distance/payout cases, timeouts, and fail-closed escrow.
- [ ] Complete final integrated build and browser/API verification.
- [ ] Verify one creator and one opponent use two devnet wallets end to end, with confirmed deposit and correct on-chain payout/refund.
- [ ] Confirm production Site deployment and public-source GitHub push.

Do not mark the end-to-end game complete from unit tests or a successful static build alone. Save the two-wallet chain receipts and deployed program/site references as completion evidence.

## Next phase — operational confidence

- Independently review the native program and the hosted referee trust assumptions.
- Exercise waiting expiry, cancellation races, a stale/failed settlement, and both timeout-recovery branches on devnet.
- Check scheduled settlement sweeps, log redaction, secret rotation and room migration behavior.
- Verify panorama attributions, mobile layout, accessibility, and supported map/panorama interactions.
- Add an operator playbook for pausing room creation, replacing a referee key for new rooms, refunds, and devnet RPC outages.

## Future real-SOL release (not authorized)

- Complete a security audit and address findings.
- Define program upgrade authority, referee decentralization or proofs, randomness quality, dispute process, monitoring, and key recovery.
- Resolve product, legal, jurisdiction, age, and gambling eligibility obligations before accepting real value.
- Set final stake and fee policy and obtain explicit user authorization before any mainnet deployment or funded action.

Never switch the devnet site or wallet instructions to mainnet as an implementation shortcut. The current feature boundary remains one equal-stake, two-player geography round; leaderboards, public matchmaking, chat, tournaments, bots, and tokens are out of scope.
