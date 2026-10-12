"use client";

import { useEffect, useState } from "react";
import { lamportsToSol, solToLamports } from "@/lib/wallet";

const PRICE_URL = "https://api.coinbase.com/v2/prices/SOL-USDC/spot";
const REFRESH_MS = 60_000;
const STALE_MS = 120_000;
type Quote = { rate: number; fetchedAt: number };

export default function SolValueEstimate({ stakeSol, stakeLamports, potLamports }: { stakeSol?: string; stakeLamports?: string; potLamports?: string }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [now, setNow] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stopped = false;
    let pending: AbortController | null = null;
    const refresh = async () => {
      if (pending) return;
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 7_000);
      try {
        const response = await fetch(PRICE_URL, { signal: controller.signal, cache: "no-store", credentials: "omit" });
        if (!response.ok) throw new Error("Price unavailable");
        const payload = await response.json() as { data?: { amount?: unknown; base?: unknown; currency?: unknown } };
        const data = payload?.data;
        if (data?.base !== "SOL" || data.currency !== "USDC" || typeof data.amount !== "string" || data.amount.length > 40 || !/^\d+(?:\.\d+)?$/.test(data.amount)) throw new Error("Invalid price");
        const rate = Number(data.amount);
        if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid price");
        if (!stopped) {
          const fetchedAt = Date.now();
          setQuote({ rate, fetchedAt }); setNow(fetchedAt);
        }
      } catch {
        if (!stopped) setQuote(null);
      } finally {
        clearTimeout(timeout);
        if (pending === controller) pending = null;
        if (!stopped) setLoading(false);
      }
    };
    setNow(Date.now());
    void refresh();
    const refreshTimer = setInterval(() => { void refresh(); }, REFRESH_MS);
    const clockTimer = setInterval(() => setNow(Date.now()), 1_000);
    return () => { stopped = true; clearInterval(refreshTimer); clearInterval(clockTimer); pending?.abort(); };
  }, []);

  let stakeAmount: bigint | null = null;
  let potAmount: bigint | null = null;
  try {
    const selected = stakeLamports ?? solToLamports(stakeSol ?? "");
    if (!/^\d+$/.test(selected) || (potLamports !== undefined && !/^\d+$/.test(potLamports))) throw new Error("Invalid amount");
    stakeAmount = BigInt(selected);
    potAmount = potLamports === undefined ? stakeAmount * 2n : BigInt(potLamports);
    if (stakeAmount <= 0n || !Number.isFinite(Number(lamportsToSol(stakeAmount.toString()))) || !Number.isFinite(Number(lamportsToSol(potAmount.toString())))) throw new Error("Invalid amount");
  } catch { stakeAmount = null; potAmount = null; }

  const age = quote ? now - quote.fetchedAt : 0;
  const fresh = !!quote && age >= 0 && age <= STALE_MS;
  const estimate = (amount: bigint | null) => {
    if (amount === null || !fresh || !quote) return "—";
    const value = Number(lamportsToSol(amount.toString())) * quote.rate;
    if (!Number.isFinite(value)) return "—";
    return value > 0 && value < 0.01 ? "≈ <0.01" : `≈ ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return <div className="sol-value-estimate" aria-label="SOL to USDC market reference">
    <div className="sol-value-row"><span>Your stake</span><strong>{estimate(stakeAmount)} <small>USDC</small></strong></div>
    <div className="sol-value-row"><span>Pot</span><strong>{estimate(potAmount)} <small>USDC</small></strong></div>
    <small className="sol-value-caption">SOL/USDC market reference · test SOL</small>
    <small className="sol-value-source"><a href="https://www.coinbase.com/converter/sol/usdc" target="_blank" rel="noreferrer" title="Coinbase SOL/USDC market reference">Coinbase</a> · {stakeAmount === null ? "Enter a valid SOL amount" : loading ? "Loading price…" : fresh && quote ? <time dateTime={new Date(quote.fetchedAt).toISOString()} title={`Price fetched at ${new Date(quote.fetchedAt).toLocaleTimeString()}`}>updated {Math.floor(age / 1_000)}s ago</time> : "Price unavailable"} · refreshes every minute</small>
  </div>;
}
