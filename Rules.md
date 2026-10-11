# Geo Duels — Rules

These rules describe the current devnet build. Stakes are test SOL only.

## Start a duel

1. Connect a Solana wallet on devnet and create a room with a stake from **0.001 to 1 test SOL**.
2. Approve the wallet transaction that deposits the exact stake into that room's program escrow. Share the six-character room link/code.
3. The opponent joins before the 15-minute invite deadline and approves the same stake. Each wallet is distinct and signs its own deposit.
4. The referee starts the round within 60 seconds of the second confirmed deposit. The program records a salted target commitment and a fixed 30-second deadline.

## Guess and score

- Both players see the same licensed real-world 360° scene.
- Zoom or drag the world map and place one guess during the countdown. The wallet signs the deployment, room, wallet, nonce, deadline, and exact coordinates. A valid guess must reach the server before the deadline and receive a durable acknowledgement; it cannot be replaced.
- The server computes great-circle (haversine) distance with Earth radius **6,371,000 m**, rounded to the nearest whole metre. Lower distance wins; equal distance is a tie.
- The target, both guesses, whole-metre distances, and connecting lines appear after the round. Active scenes show author/license credits, but conceal target coordinates, source links and the opponent's guess. A confirmed settlement remains settled if its historical receipt is unavailable.

## Pot distribution

There is **no game fee**. With each player staking `S` lamports:

- One closer guess: that player receives `2 × S`; the other receives zero.
- Equal whole-metre distances: each receives `S` back.
- Only one player submits a valid guess: that player receives `2 × S` when the timer ends.
- Neither submits a valid guess: each receives `S` back.

The escrow program pays recorded wallets directly in an atomic transaction. Wallets pay their own normal transaction fees; the referee pays start, settlement and automatic recovery fees. The separate account rent reserve is returned automatically to its recorded original payer after settlement/refund plus 24 hours, with the operator paying the closing fee. Rent is outside the pot.

## Cancellation and recovery

- Before an opponent joins, the creator may cancel and recover their stake.
- If the invite expires, the funded creator can recover the waiting stake.
- If the second player joins but the referee fails to start in 60 seconds, both players can recover their deposits.
- After the round ends, the referee can settle during the five-minute settlement window. If it does not, either player can trigger the program's fixed refund path for the recorded depositors.
- Recovery always pays the wallets stored by the program. Duplicate settlements and altered result data are rejected.
- Wallet-paid timeout recovery does not require the referee's private key or funded operating account. Scheduled recovery and rent return depend on the service and its fee balance.

## Fairness and responsible play

The referee selects from a limited supported scene pool, accepts timely signed guesses, and computes distance. A salted target commitment makes a settled result auditable after reveal; it does not make scene selection or scoring trustless. The program constrains the referee's allowed room, participants, deadlines, commitment, and one-time payout. This is a devnet prototype. Use test SOL only and do not treat the early referee design as security-audited or suitable for real-money play.

Rounds are short by design. Rematches require a fresh explicit action and wallet transaction; there is no auto-stake setting.

The deployed devnet program uses a sponsor that retains upgrade authority and applies a seven-day idle retention policy. This temporary deployment must remain available for funded rooms and recovery; it is not a permanent mainnet service. Deployed round **GYHZPJ** verified both deposits and signed guesses, a hidden target during play, and the exact **2,000,002-lamport** winner pot. Its [payout is confirmed](https://explorer.solana.com/tx/CyxbQPagrYKGwCZQYoz4auQeYYYvsUCL9qqmLLPzPVckCWTb8jB43kFSiurHrsNsV28dEgrKqkcF8ZpVnoVtZ94?cluster=devnet).
