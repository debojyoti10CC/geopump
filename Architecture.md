# Geo Duels — Architecture

## Product shape

Two friends join a code-based room, deposit equal amounts of devnet SOL, view the same real 360° street panorama, and place one map guess before a synchronized 30-second timer expires. The closer guess receives the full pot. The interface evokes a 90s desktop and keeps the journey compact: connect → room → deposit → guess → result.

## Runtime pieces

| Layer | Implementation and responsibility |
| --- | --- |
| Browser | React/Vinext Windows 95 game-only UI; Phantom/Solflare signing; zoomable, draggable 2:1 world map; Pannellum panorama; countdown, manual rematch, and recovery. Connecting lines appear only with revealed results. |
| Worker API | Room creation/join, wallet-signature sessions, accepted guess receipts, random supported-scene selection, result scoring, escrow reconciliation, and recovery. |
| Durable state | Cloudflare D1 room/session/guess records; SQL migrations in `drizzle/`. Room terms and each room's program/referee addresses are pinned at creation. |
| Scene vault | A small licensed Panoramax scene catalog is AES-GCM encrypted and gzip-compressed in source. `GEO_SCENE_SECRET` decrypts it only inside the server Worker. Active room responses do not disclose target coordinates, scene labels/source links, or the opponent's guess. |
| Escrow | `programs/geo-duels/`: native Solana program derives one escrow PDA per unique room, enforces exact equal deposits, freezes fixed deadlines and outcome, sends one atomic winner/tie/refund transfer, and prevents replay. |
| Settlement | Dedicated devnet referee key signs start/result instructions and pays their transaction fees. The API retries safely; program timeout refunds are available to the recorded players without requiring the operator key. |
| Hosting | Cloudflare Worker + D1 through the Codex Sites build and deployment workflow. `build/sites-worker.ts` owns the request handler and scheduled recovery sweep. |

## Money and lifecycle

Each stake is an integer lamport amount between 1,000,000 (0.001 SOL) and 1,000,000,000 (1 SOL). Both wallets sign their own deposits; the backend never takes custody. The room PDA holds two stakes plus the account's separate rent reserve. A unique room ID prevents joining by guessed room codes alone; wallet signatures bind each API session and guess to its wallet.

```text
WAITING → READY → ACTIVE → SETTLED
    └───────┴────────┴────→ REFUNDED
```

Room invite expiry is 15 minutes. Starting must occur within 60 seconds after the second deposit. The active round lasts exactly 30 seconds; settlement has a five-minute retry window. Waiting cancellation returns the creator's stake. Fixed expiry recovery returns each recorded stake. A terminal room cannot pay twice. After its on-chain terminal timestamp plus 24 hours, the scheduled worker returns the rent reserve to the recorded original payer; the operator pays the closing fee and D1 records completion to prevent repeat attempts.

The browser selects integer latitude/longitude microdegrees. The server accepts one nonce-bound, signed guess per wallet, records receipt time, and scores with haversine distance using Earth radius 6,371,000 metres, rounded to the nearest metre. That whole-metre distance determines the result; receipt time does not break ties.

## Payouts

For equal stake `S` and no platform fee:

| Result | Creator | Opponent |
| --- | ---: | ---: |
| Creator is closer | `2S` | `0` |
| Opponent is closer | `0` | `2S` |
| Distances tie | `S` | `S` |
| One valid guess before timeout | `2S` to that player | `0` |
| No valid guesses | `S` | `S` |

Normal game payouts are atomic transfers from escrow. The UI reports settlement after confirming chain state. A missing transaction receipt is recovered from matching confirmed history or explicitly shown as unavailable; the service never repeats a payout to recover its receipt. SOL network fees remain separate. The program validates recorded participants, pinned referee, fixed deadlines, commitment/reveal consistency, and terminal status.

## Fairness boundary

The location target is committed before play and revealed with the result, but location selection, request acceptance, and distance calculation are performed by the hosted referee. The escrow enforces that authorized result and one-time payout; it does not independently prove the referee's geographic sample was uniform or that a guess arrived before a deadline. This is an early devnet trust model, not trustless randomness. Only licensed, supported real panoramas are eligible; current coverage is a limited scene pool rather than every point on Earth.

## Deployment and verification

The executable devnet program is `9knNnYeDQh1suoAx6tmhAgtmsYQvcoguTn6CkssZArsU`; deployment evidence is in `chain/deployment.json`. The referee has been funded with 5 test SOL. The Worker uses the verified OnFinality public devnet RPC because the official endpoint returned HTTP 403 from this environment.

This sponsored deployment has a seven-day idle retention policy. Its sponsor holds upgrade authority `FEvT5nka9qBSXryv65P8ScjvGtfLUE7LgPu1rzuJ38h8`; the registered upgrade owner is a separate identity recorded in the deployment file. Retention and sponsor upgrades are additional devnet operational dependencies.

Current evidence: 14 service tests, 7 native Rust tests, 4 client tests, and local-validator transaction checks. The deployed devnet API round **GYHZPJ passed**: two confirmed deposits, two signed guesses, a hidden target during play, and the exact **2,000,002-lamport** winner payout. `chain/devnet-game-receipt.json` records the checks and [confirmed payout](https://explorer.solana.com/tx/CyxbQPagrYKGwCZQYoz4auQeYYYvsUCL9qqmLLPzPVckCWTb8jB43kFSiurHrsNsV28dEgrKqkcF8ZpVnoVtZ94?cluster=devnet).

Worker confirmations use HTTP transaction-status polling; server RPC requests are paced to the public provider's limits. The 14 service tests passed again after these integration fixes. Public Site publication and GitHub push remain separate pending delivery steps.

## Source map

- `app/`, `components/` — browser screens and user actions.
- `app/api/`, `lib/game-server.ts`, `lib/game-store.ts` — room APIs, DB access, auth, settlement.
- `lib/game-math.ts` — timer, coordinate bounds, distance and payout rules.
- `lib/locations.server.ts`, `lib/scene-data.server.enc.json` — private runtime scene decode and media response.
- `lib/chain.ts`, `lib/game-chain.server.ts`, `chain/referee.ts` — client escrow calls and server settlement/recovery.
- `programs/geo-duels/src/lib.rs` — on-chain escrow program and native program tests.
- `tests/game-service.test.mjs` — service security, auth, race, scoring and escrow-boundary tests.
- `drizzle/` — ordered D1 migrations.
