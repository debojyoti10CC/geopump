export const ROUND_SECONDS = 30;
export const STAKE_MIN = 1_000_000;
export const STAKE_MAX = 1_000_000_000;
export type Coordinates = { latE6: number; lngE6: number };

export function validateCoordinates(latE6: unknown, lngE6: unknown): Coordinates {
  if (!Number.isSafeInteger(latE6) || !Number.isSafeInteger(lngE6) ||
      (latE6 as number) < -90_000_000 || (latE6 as number) > 90_000_000 ||
      (lngE6 as number) < -180_000_000 || (lngE6 as number) > 180_000_000) {
    throw new Error("Choose a valid point on the world map.");
  }
  return { latE6: latE6 as number, lngE6: lngE6 === 180_000_000 ? -180_000_000 : lngE6 as number };
}

/** The published game rule: haversine, R=6,371,000 m, nearest whole metre. */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const radians = Math.PI / 180_000_000;
  const dLat = (b.latE6 - a.latE6) * radians;
  const dLng = (b.lngE6 - a.lngE6) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latE6 * radians) *
    Math.cos(b.latE6 * radians) * Math.sin(dLng / 2) ** 2;
  return Math.floor(6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h)))) + 0.5);
}

export type AcceptedGuess = Coordinates & { wallet: string; message: string; signature: string; acceptedAt: number };
export function calculateResult(target: Coordinates, creator: string, opponent: string, stakeLamports: number, guesses: AcceptedGuess[]) {
  const scored = guesses.map(guess => ({ ...guess, distanceMeters: distanceMeters(target, guess) }));
  const first = scored.find(guess => guess.wallet === creator);
  const second = scored.find(guess => guess.wallet === opponent);
  const winnerWallet = first && second ? first.distanceMeters === second.distanceMeters ? null :
    first.distanceMeters < second.distanceMeters ? creator : opponent : first ? creator : second ? opponent : null;
  return {
    winnerWallet,
    tie: winnerWallet === null,
    reason: (!first && !second ? "both_missed" : !first || !second ? "timeout" : "closest") as "both_missed" | "timeout" | "closest",
    target,
    guesses: scored,
    winnerPayoutLamports: winnerWallet ? stakeLamports * 2 : stakeLamports,
    payouts: [{ wallet: creator, lamports: winnerWallet === null ? stakeLamports : winnerWallet === creator ? stakeLamports * 2 : 0 },
      { wallet: opponent, lamports: winnerWallet === null ? stakeLamports : winnerWallet === opponent ? stakeLamports * 2 : 0 }],
    signature: null as string | null,
  };
}

export function formatGuessMessage(code: string, wallet: string, nonce: string, expiresAt: number, point: Coordinates, programId: string): string {
  return ["Geo Duels guess v1", "Network: devnet", `Program: ${programId}`, "RulesVersion: 1", `Room: ${code}`, `Wallet: ${wallet}`,
    `Nonce: ${nonce}`, `LatitudeE6: ${point.latE6}`, `LongitudeE6: ${point.lngE6}`, `ExpiresAt: ${expiresAt}`].join("\n");
}
