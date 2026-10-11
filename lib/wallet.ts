import { Connection, Transaction } from "@solana/web3.js";

export type WalletProvider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
  signAndSendTransaction?: (transaction: Transaction) => Promise<{ signature: string }>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  on?: (event: string, callback: (key?: { toString(): string } | null) => void) => void;
  removeListener?: (event: string, callback: (key?: { toString(): string } | null) => void) => void;
};

export function installedWallets(): { name: string; provider: WalletProvider }[] {
  if (typeof window === "undefined") return [];
  const scope = window as unknown as {
    phantom?: { solana?: WalletProvider };
    solflare?: WalletProvider;
    solana?: WalletProvider;
  };
  const result: { name: string; provider: WalletProvider }[] = [];
  const phantom = scope.phantom?.solana || (scope.solana?.isPhantom ? scope.solana : undefined);
  if (phantom) result.push({ name: "Phantom", provider: phantom });
  if (scope.solflare) result.push({ name: "Solflare", provider: scope.solflare });
  if (scope.solana && !result.some((wallet) => wallet.provider === scope.solana)) {
    result.push({ name: scope.solana.isSolflare ? "Solflare" : "Solana wallet", provider: scope.solana });
  }
  return result;
}

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function signText(provider: WalletProvider, message: string): Promise<string> {
  if (!provider.signMessage) throw new Error("This wallet cannot sign messages. Please use Phantom or Solflare.");
  const signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
  return base64(signed instanceof Uint8Array ? signed : signed.signature);
}

export async function sendDeposit(provider: WalletProvider, encoded: string, rpcUrl: string): Promise<string> {
  const transaction = Transaction.from(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
  const connection = new Connection(rpcUrl, "confirmed");
  let signature: string;
  if (provider.signAndSendTransaction) {
    signature = (await provider.signAndSendTransaction(transaction)).signature;
  } else if (provider.signTransaction) {
    const signed = await provider.signTransaction(transaction);
    signature = await connection.sendRawTransaction(signed.serialize());
  } else throw new Error("This wallet cannot send transactions. Please use Phantom or Solflare.");
  for (let attempt = 0; attempt < 40; attempt++) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err) throw new Error("The transaction failed on Solana. Your stake was not accepted.");
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Transaction still pending. Check your wallet before retrying. Receipt: ${signature}`);
}

export function solToLamports(value: string): string {
  if (!/^\d+(\.\d{0,9})?$/.test(value.trim())) throw new Error("Enter a SOL amount with at most 9 decimal places.");
  const [whole, decimal = ""] = value.trim().split(".");
  return (BigInt(whole) * BigInt(1_000_000_000) + BigInt(decimal.padEnd(9, "0") || "0")).toString();
}

export function lamportsToSol(value: string | number): string {
  const padded = String(value).padStart(10, "0");
  const whole = padded.slice(0, -9);
  const fraction = padded.slice(-9).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export const shortWallet = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
