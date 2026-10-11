# geopump

**Geo Duels** is a fast, two-player geography wager game on Solana devnet. Friends open a room, stake equal amounts of test SOL, get the same real-world 360° panorama, and drop one guess on the map before the 30-second clock runs out. The closest guess takes the pot.

The interface recreates a late-90s desktop: blue title bars, gray beveled windows, desktop shortcuts, and compact pixel-era controls. Stake buttons include half, double, and maximum shortcuts. Rematches are manual; the site never stakes automatically.

## Game and payouts

- Native SOL stakes are 0.001–1 test SOL per player, represented internally as integer lamports.
- Both players deposit the same amount to a room-specific Solana program-derived escrow address. Deposits are verified on devnet before the round begins.
- Each player submits one wallet-authenticated map guess during a synchronized 30-second round.
- The server computes great-circle distances in integer metres. The smaller distance wins; an exact tie returns each player's stake.
- A winner receives both stakes. The game takes no cut; wallets still pay their normal transaction fees. Escrow account rent is tracked separately and returned on close.
- The independently submitted target, source attribution, both guesses, measured distances, and settlement transaction are shown after the round. Timeout recovery returns recorded deposits to their owners.
- Real panorama coordinates are encrypted in the deployed runtime configuration and are not returned during an active round. The app currently uses a limited collection of licensed Panoramax scenes, rather than a globally exhaustive random Earth sampler.

This is an early devnet build. Its off-chain referee selects locations, accepts valid guesses, and reports the result to the escrow program. A target commitment supports later verification but does not make the referee trustless. Do not use real funds or treat devnet results as production-grade fairness.

## Run locally

Requires Node.js 22.13 or newer and a Solana wallet browser extension configured for devnet.

```powershell
npm ci
npm run dev
```

The home screen includes a practice round that does not use SOL. Room play requires the program and database bindings to be configured. For a production-style local Worker preview, use `npm run build` then `npm start`; local D1 migrations are in `drizzle/`.

## Runtime configuration

Site-only values belong in the hosting provider's secret store, not the repository. The deployed Worker uses a D1 binding named `DB` and these values:

| Variable | Purpose |
| --- | --- |
| `SOLANA_PROGRAM_ID` | Deployed Geo Duels escrow program address on devnet. |
| `SOLANA_RPC_URL` | Optional devnet RPC endpoint; defaults to Solana devnet. |
| `SOLANA_REFEREE_SECRET` | Secret key for the dedicated devnet settlement/refund referee. Store as a secret. |
| `GEO_SCENE_SECRET` | 32-byte hex AES key for the encrypted real-location catalog. Store as a secret. |
| `GEO_OPERATOR_TOKEN` | Optional secret to restrict an operator-triggered room sweep. |

For local Worker runs, put the secret values in an ignored `.dev.vars` file. `scripts/encrypt-scenes.mjs` can encrypt a local scene catalog into `lib/scene-data.server.enc.json`; keep `.secrets/scene.key` private and set its hex value as `GEO_SCENE_SECRET`. Never commit private keys or that key file.

## Project map

- `app/`, `components/` — retro desktop UI, wallet actions, map and panorama views.
- `app/api/`, `lib/game-server.ts`, `lib/game-store.ts` — authenticated room/practice service, scoring and durable D1 state.
- `programs/geo-duels/` — native Solana escrow program.
- `lib/chain.ts`, `lib/game-chain.server.ts`, `chain/referee.ts` — wallet transactions and server settlement/recovery.
- `lib/game-math.ts` — round duration, exact lamport boundaries, distance and payout rules.
- `lib/scene-data.server.enc.json` — authenticated encrypted scenes; coordinates and source records stay server-only.
- `public/world.json`, `public/vendor/` — Natural Earth world map and local Pannellum viewer.
- `Architecture.md`, `Rules.md`, `Phases.md`, `Memory.md` — maintained product and implementation notes.

Panoramax scene authorship and CC BY-SA license links are displayed with each result. The bundled Pannellum viewer is MIT-licensed; the Natural Earth map data is public domain. See the corresponding asset license files and in-app attribution.
