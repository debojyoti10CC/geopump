# geopump

**Geo Duels** is a fast, two-player geography wager game on Solana devnet. Friends open a room, stake equal amounts of test SOL, get the same real-world 360° panorama, and drop one guess on the map before the 30-second clock runs out. The closest guess takes the pot.

The game-only interface recreates Windows 95: a teal desktop, navy title bars, gray beveled windows, square controls, and a red digital countdown. Stake buttons include half, double, and maximum shortcuts. Rematches are manual. The 2:1 map supports zoom and mouse/touch dragging; connecting lines appear only after the guesses and target are revealed.

## Game and payouts

- Native SOL stakes are 0.001–1 test SOL per player, represented internally as integer lamports.
- Both players deposit the same amount to a room-specific Solana program-derived escrow address. Deposits are verified on devnet before the round begins.
- Each player submits one wallet-authenticated map guess during a synchronized 30-second round.
- The server computes great-circle distances in integer metres. The smaller distance wins; an exact tie returns each player's stake.
- A winner receives both stakes. The game takes no cut; wallets pay deposit fees and the referee pays automatic settlement fees. Account rent is separate and automatically returned to its recorded payer after the on-chain terminal timestamp plus 24 hours; the operator pays the closing fee.
- The independently submitted target, source attribution, both guesses, measured distances, and settlement transaction are shown after the round. Timeout recovery returns recorded deposits to their owners.
- Real panorama coordinates are encrypted in the deployed runtime configuration and are not returned during an active round. The app currently uses a limited collection of licensed Panoramax scenes, rather than a globally exhaustive random Earth sampler.

This is an early devnet build. Its off-chain referee selects locations, accepts valid guesses, and reports the result to the escrow program. A target commitment supports later verification but does not make the referee trustless. Do not use real funds or treat devnet results as production-grade fairness.

## Deployment and checks

The executable devnet program is [`9knNnYeDQh1suoAx6tmhAgtmsYQvcoguTn6CkssZArsU`](https://explorer.solana.com/address/9knNnYeDQh1suoAx6tmhAgtmsYQvcoguTn6CkssZArsU?cluster=devnet). `chain/deployment.json` records deployment evidence; its referee was funded with 5 test SOL.

**Full deployed API round GYHZPJ passed:** two confirmed deposits, two signed guesses, the target hidden during play, and the exact **2,000,002-lamport** winner payout. `chain/devnet-game-receipt.json` records the evidence and [confirmed payout](https://explorer.solana.com/tx/CyxbQPagrYKGwCZQYoz4auQeYYYvsUCL9qqmLLPzPVckCWTb8jB43kFSiurHrsNsV28dEgrKqkcF8ZpVnoVtZ94?cluster=devnet). Worker transaction confirmations use HTTP polling, with paced server RPC requests. Public Site publication and GitHub push remain pending.

Current checks pass: **14 service tests, 7 native Rust tests, and 4 client tests**; the service suite passed again after integration fixes. Separate local-validator transaction evidence lives in `chain/e2e-receipts.json`.

The sponsored deployment has seven-day idle retention and sponsor-held upgrade authority (`FEvT5nka9qBSXryv65P8ScjvGtfLUE7LgPu1rzuJ38h8`). The registered upgrade owner is recorded separately in the deployment file. This temporary devnet hosting is an operational dependency.

```powershell
node --test tests/game-service.test.mjs
```

## Run locally

Requires Node.js 22.13 or newer and a Solana wallet browser extension configured for devnet.

```powershell
npm ci
npm run dev -- --port 4173 --host 127.0.0.1
```

Open http://127.0.0.1:4173/. The screen contains only the friend-duel game. The development server reflects edits immediately. Room play requires the deployed program, funded referee, scene secret, and local database migrations. Apply every migration in `drizzle/` in order to the local D1 database; hosted migrations are applied during Sites publication.

## Runtime configuration

Site-only values belong in the hosting provider's secret store, not the repository. The deployed Worker uses a D1 binding named `DB` and these values:

| Variable | Purpose |
| --- | --- |
| `SOLANA_PROGRAM_ID` | Deployed Geo Duels escrow program address on devnet. |
| `SOLANA_RPC_URL` | Server devnet RPC. Integrated verification uses `https://solana-devnet.api.onfinality.io/public`; the official endpoint returned HTTP 403 from the Worker. |
| `SOLANA_REFEREE_SECRET` | Secret key for the dedicated devnet settlement/refund referee. Store as a secret. |
| `GEO_SCENE_SECRET` | 32-byte hex AES key for the encrypted real-location catalog. Store as a secret. |
| `GEO_OPERATOR_TOKEN` | Optional secret to restrict an operator-triggered room sweep. |

For local Worker runs, put the secret values in an ignored `.dev.vars` file. `scripts/encrypt-scenes.mjs` can encrypt a local scene catalog into `lib/scene-data.server.enc.json`; keep `.secrets/scene.key` private and set its hex value as `GEO_SCENE_SECRET`. Never commit private keys or that key file.

Apply all three D1 migrations in order: `0000_geo_duels.sql`, `0001_pin_escrow_authorities.sql`, then `0002_reclaim_escrow_rent.sql`. Scheduled sweeps settle/refund eligible rooms and reclaim terminal account rent. Wallet-paid timeout recovery remains available without the referee's private key or fee balance.

## Project map

- `app/`, `components/` — retro desktop UI, wallet actions, map and panorama views.
- `app/api/`, `lib/game-server.ts`, `lib/game-store.ts` — authenticated room service, scoring and durable D1 state.
- `programs/geo-duels/` — native Solana escrow program.
- `lib/chain.ts`, `lib/game-chain.server.ts`, `chain/referee.ts` — wallet transactions and server settlement/recovery.
- `lib/game-math.ts` — round duration, exact lamport boundaries, distance and payout rules.
- `lib/scene-data.server.enc.json` — authenticated encrypted scenes; coordinates and source records stay server-only.
- `public/world.json`, `public/vendor/` — Natural Earth world map and local Pannellum viewer.
- `Architecture.md`, `Rules.md`, `Phases.md`, `Memory.md` — maintained product and implementation notes.

Panoramax scene authorship and CC BY-SA license links are displayed with each result. The bundled Pannellum viewer is MIT-licensed; the Natural Earth map data is public domain. See the corresponding asset license files and in-app attribution.
