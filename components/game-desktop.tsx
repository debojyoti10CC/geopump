"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { ArrowRight, Check, ChevronRight, Copy, Globe2, HelpCircle, MapPin, Monitor, Music2, Radio, RotateCcw, ShieldCheck, Sparkles, Trophy, Users, Volume2, VolumeX, Wallet, X, ExternalLink, LoaderCircle, LockKeyhole, FolderOpen, Clock3, Heart, MousePointer2 } from "lucide-react";
import GameMap, { type Coordinates } from "./game-map";
import GamePanorama from "./game-panorama";
import { installedWallets, lamportsToSol, sendDeposit, shortWallet, signText, solToLamports, type WalletProvider } from "@/lib/wallet";

type Attribution = { author: string; license: string; licenseUrl: string };
type Location = Attribution & { label: string; sourceUrl: string };
type Config = { network: string; programId: string | null; rpcUrl: string; stakeMin: string; stakeMax: string; roundSeconds: number; escrowReady: boolean; serverTime?: number };
type Guess = Coordinates & { wallet: string; distanceMeters: number };
type DuelResult = { winnerWallet: string | null; tie: boolean; reason: string; target: Coordinates; guesses: Guess[]; winnerPayoutLamports: string; signature: string | null; receiptStatus?: "unavailable"; location?: Location };
type Challenge = { nonce: string; expiresAt: number; programId: string; rulesVersion: number };
type Room = { code: string; status: string; stakeLamports: string; potLamports: string; creatorWallet: string; opponentWallet: string | null; roundSeconds: number; deadline: number | null; refundAt: number | null; sceneUrl: string | null; ownLocked: boolean; players: { wallet: string; locked: boolean }[]; result: DuelResult | null; challenge: Challenge | null; serverTime?: number; attribution?: Attribution };
type Practice = { id: string; sceneUrl: string; deadline: number; roundSeconds: number; result?: PracticeResult; serverTime?: number; attribution?: Attribution };
type PracticeResult = { target: Coordinates; guess: Coordinates | null; distanceMeters: number | null; score: number; remainingMs: number; location?: Location };
type Deposit = { room: Room; transaction?: string; auth?: { message: string } };
type HistoryItem = { id: string; kind: "practice" | "duel"; distance: number | null; won: boolean; time: number };
type Dialog = "rules" | "wallet" | "scores" | "about" | null;

const defaults: Config = { network: "devnet", programId: null, rpcUrl: "https://api.devnet.solana.com", stakeMin: "1000000", stakeMax: "1000000000", roundSeconds: 30, escrowReady: false };
const distanceLabel = (meters: number | null | undefined) => meters == null ? "No guess" : meters < 1000 ? `${meters} m` : `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";

async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const data = await response.json() as { message?: string; error?: string | { message?: string } };
  if (!response.ok) throw new Error(data.message || (typeof data.error === "string" ? data.error : data.error?.message) || "The game service couldn’t complete that request.");
  return data as T;
}

function WindowFrame({ title, icon, children, className = "", label }: { title: string; icon?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return <section className={`retro-window ${className}`} aria-label={label || title}>
    <div className="window-title"><span>{icon || <Monitor size={15} />}{title}</span><div className="window-chrome" aria-hidden="true"><i>_</i><i>□</i><i className="chrome-close">×</i></div></div>
    {children}
  </section>;
}

function PlayerAvatar({ other = false }: { other?: boolean }) {
  return <div className={`player-avatar ${other ? "other-avatar" : ""}`} aria-hidden="true"><i /><b /><span>✦</span></div>;
}

export default function GameDesktop() {
  const [config, setConfig] = useState(defaults);
  const [configured, setConfigured] = useState(false);
  const [wallet, setWallet] = useState("");
  const provider = useRef<WalletProvider | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [mode, setMode] = useState<"duel" | "practice">("duel");
  const [stake, setStake] = useState("0.001");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [practiceResult, setPracticeResult] = useState<PracticeResult | null>(null);
  const [pin, setPin] = useState<Coordinates | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewAttribution, setPreviewAttribution] = useState<Attribution | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [walletOptions, setWalletOptions] = useState<ReturnType<typeof installedWallets>>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [sound, setSound] = useState(false);
  const [now, setNow] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [startMenu, setStartMenu] = useState(false);
  const savedResult = useRef("");
  const clockOffset = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  const active = room?.status === "active" || (!!practice && !practiceResult);
  const result = room?.result;
  const hasResult = !!result || !!practiceResult;
  const deadline = room?.deadline || practice?.deadline || null;
  const seconds = (active || room?.status === "settling") && deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : config.roundSeconds;
  const locked = !!room?.ownLocked || !!practiceResult;
  const ownGuess = result?.guesses.find((guess) => guess.wallet === wallet);
  const ownDistance = practiceResult?.distanceMeters ?? ownGuess?.distanceMeters ?? null;
  const won = !!result?.winnerWallet && result.winnerWallet === wallet;
  const target = result?.target || practiceResult?.target;
  const best = history.filter((item) => item.distance != null).reduce<number | null>((value, item) => value == null ? item.distance : Math.min(value, item.distance!), null);
  const unavailable = configured && !config.escrowReady;

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now() + clockOffset.current), 200);
    request<Config>("/api/config").then((value) => { if (value.serverTime) clockOffset.current = value.serverTime - Date.now(); setConfig({ ...defaults, ...value }); setConfigured(true); }).catch((cause) => { setError(errorMessage(cause)); setConfigured(true); });
    request<{ sceneUrl: string; attribution: Attribution }>("/api/preview-scene").then((value) => { setPreview(value.sceneUrl); setPreviewAttribution(value.attribution); }).catch(() => {});
    try {
      const stored = JSON.parse(localStorage.getItem("geopump-history") || "[]");
      if (Array.isArray(stored)) setHistory(stored.slice(0, 20));
      setSound(localStorage.getItem("geopump-sound") === "true");
    } catch {}
    const code = new URLSearchParams(window.location.search).get("room");
    if (code) setJoinCode(code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12));
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!dialog) return;
    dialogRef.current?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialog(null);
      if (event.key === "Tab" && dialogRef.current) {
        const elements = dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, summary");
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { last?.focus(); event.preventDefault(); }
        else if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [dialog]);

  const refreshBalance = useCallback(async (address: string) => {
    try { setBalance(String(await new Connection(config.rpcUrl, "confirmed").getBalance(new PublicKey(address)))); }
    catch { setBalance(null); }
  }, [config.rpcUrl]);

  useEffect(() => {
    const selected = provider.current;
    if (!selected || !wallet) return;
    const accountChanged = (key?: { toString(): string } | null) => {
      const address = key?.toString() || "";
      setWallet(address); setBalance(null);
      if (address) { void refreshBalance(address); setNotice("Wallet account changed. Use your funded wallet to restore room access."); }
      else setNotice("Wallet disconnected. Funded room deadlines continue.");
    };
    selected.on?.("accountChanged", accountChanged);
    selected.on?.("disconnect", accountChanged);
    return () => { selected.removeListener?.("accountChanged", accountChanged); selected.removeListener?.("disconnect", accountChanged); };
  }, [wallet, refreshBalance]);

  useEffect(() => {
    if (!room?.code) return;
    let stopped = false;
    const poll = async () => {
      try {
        const data = await request<{ room: Room } | Room>(`/api/rooms/${room.code}${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ""}`);
        if (!stopped) { const current = "room" in data ? data.room : data; if (current.serverTime) clockOffset.current = current.serverTime - Date.now(); setRoom(current); }
      } catch (cause) { if (!stopped) setNotice(`Room connection: ${errorMessage(cause)}`); }
    };
    const timer = setInterval(poll, 1300);
    return () => { stopped = true; clearInterval(timer); };
  }, [room?.code, wallet]);

  useEffect(() => {
    if (!practice?.id || practiceResult) return;
    let stopped = false;
    const poll = async () => {
      try {
        const data = await request<Practice & { result?: PracticeResult }>(`/api/practice/${practice.id}`);
        if (!stopped) { if (data.serverTime) clockOffset.current = data.serverTime - Date.now(); if (data.result) setPracticeResult(data.result); }
      } catch {}
    };
    const timer = setInterval(poll, 1000);
    return () => { stopped = true; clearInterval(timer); };
  }, [practice?.id, practiceResult]);

  useEffect(() => {
    if (!hasResult || (room && wallet !== room.creatorWallet && wallet !== room.opponentWallet)) return;
    const id = room?.code || practice?.id || "";
    if (!id || savedResult.current === id) return;
    savedResult.current = id;
    const item: HistoryItem = { id, kind: room ? "duel" : "practice", distance: ownDistance, won, time: Date.now() };
    setHistory((previous) => {
      const updated = [item, ...previous.filter((entry) => entry.id !== id)].slice(0, 20);
      try { localStorage.setItem("geopump-history", JSON.stringify(updated)); } catch {}
      return updated;
    });
    if (wallet) void refreshBalance(wallet);
  }, [hasResult, room, practice, ownDistance, won, wallet, refreshBalance]);

  const playTone = useCallback(() => {
    if (!sound) return;
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.type = "sine"; oscillator.frequency.value = 620;
      oscillator.connect(gain); gain.connect(context.destination); gain.gain.setValueAtTime(.045, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .15);
      oscillator.start(); oscillator.stop(context.currentTime + .15); oscillator.onended = () => { void context.close(); };
    } catch {}
  }, [sound]);

  function openWallet() { setWalletOptions(installedWallets()); setDialog("wallet"); }

  async function connectWallet(selected: ReturnType<typeof installedWallets>[number]) {
    setBusy("Connecting wallet…"); setError("");
    try {
      const connected = await selected.provider.connect();
      provider.current = selected.provider; const address = connected.publicKey.toString(); setWallet(address);
      setDialog(null); await refreshBalance(address); setNotice(`${selected.name} connected. Devnet uses test SOL.`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  async function disconnect() {
    try { await provider.current?.disconnect(); } catch {}
    provider.current = null; setWallet(""); setBalance(null); setNotice("Wallet disconnected. Funded room deadlines continue.");
  }

  async function authenticate(code: string) {
    if (!wallet || !provider.current) throw new Error("Connect the wallet that funded this room first.");
    const response = await request<{ auth: { message: string } }>(`/api/rooms/${code}/auth`, { wallet });
    const signature = await signText(provider.current, response.auth.message);
    const accepted = await request<{ room: Room }>(`/api/rooms/${code}/auth`, { wallet, message: response.auth.message, signature });
    setRoom(accepted.room); return accepted.room;
  }

  async function processDeposit(data: Deposit) {
    setRoom(data.room); setPractice(null); setPracticeResult(null); setPin(null);
    if (!data.transaction) return;
    if (!provider.current) throw new Error("Connect your wallet to approve this stake.");
    setBusy("Approve your test SOL stake…");
    const signature = await sendDeposit(provider.current, data.transaction, config.rpcUrl);
    setBusy("Confirming your room access…");
    const authMessage = data.auth?.message;
    if (!authMessage) throw new Error("Room access message missing. Use Restore room access to recover your confirmed deposit.");
    const authSignature = await signText(provider.current, authMessage);
    const confirmed = await request<{ room: Room }>(`/api/rooms/${data.room.code}/confirm`, { wallet, signature, authMessage, authSignature });
    setRoom(confirmed.room); await refreshBalance(wallet); playTone();
    const url = new URL(window.location.href); url.searchParams.set("room", confirmed.room.code); window.history.replaceState({}, "", url);
  }

  async function createRoom() {
    if (!wallet) { openWallet(); return; }
    setError(""); setNotice(""); setBusy("Creating your room…");
    try {
      const stakeLamports = solToLamports(stake);
      if (BigInt(stakeLamports) < BigInt(config.stakeMin) || BigInt(stakeLamports) > BigInt(config.stakeMax)) throw new Error(`Stake must be ${lamportsToSol(config.stakeMin)}–${lamportsToSol(config.stakeMax)} SOL.`);
      if (balance && BigInt(stakeLamports) + BigInt(6_000_000) > BigInt(balance)) throw new Error("Not enough test SOL. Keep 0.006 SOL available for transaction fees and refundable account storage.");
      await processDeposit(await request<Deposit>("/api/rooms", { wallet, stakeLamports }));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  async function joinRoom() {
    if (!joinCode.trim()) { setError("Enter the room code your friend shared."); return; }
    if (!wallet) { openWallet(); return; }
    setBusy("Finding your friend’s room…"); setError(""); setNotice("");
    try {
      const code = joinCode.trim().toUpperCase();
      const existing = await request<{ room: Room }>(`/api/rooms/${code}?wallet=${wallet}`);
      if (existing.room.creatorWallet === wallet || existing.room.opponentWallet === wallet) {
        setBusy("Restore your existing room access…"); await authenticate(code); setPractice(null); setPracticeResult(null); setPin(null);
      } else await processDeposit(await request<Deposit>(`/api/rooms/${code}/join`, { wallet }));
    }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  async function startPractice() {
    setError(""); setNotice(""); setBusy("Finding your next location…");
    try {
      const next = await request<Practice>("/api/practice", {});
      if (next.serverTime) clockOffset.current = next.serverTime - Date.now();
      setRoom(null); setPractice(next); setPracticeResult(null); setPin(null); setMode("practice"); playTone();
      const url = new URL(window.location.href); url.searchParams.delete("room"); window.history.replaceState({}, "", url);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  async function lockGuess() {
    if (!pin || busy || seconds <= 0) return;
    setError(""); setBusy(room ? "Sign your final guess…" : "Locking your guess…");
    try {
      if (practice) setPracticeResult(await request<PracticeResult>(`/api/practice/${practice.id}/guess`, pin));
      else if (room && provider.current && wallet) {
        const current = room.challenge ? room : await authenticate(room.code);
        if (!current.challenge) throw new Error("Your round is not ready to accept a guess.");
        const challenge = current.challenge;
        const message = ["Geo Duels guess v1", "Network: devnet", `Program: ${challenge.programId}`, "RulesVersion: 1", `Room: ${current.code}`, `Wallet: ${wallet}`, `Nonce: ${challenge.nonce}`, `LatitudeE6: ${pin.latE6}`, `LongitudeE6: ${pin.lngE6}`, `ExpiresAt: ${challenge.expiresAt}`].join("\n");
        const signature = await signText(provider.current, message);
        const data = await request<{ room: Room }>(`/api/rooms/${room.code}/guess`, { wallet, ...pin, message, signature });
        setRoom(data.room); setNotice("Guess locked. Your friend’s guess stays hidden until time’s up.");
      } else throw new Error("Reconnect your wallet before locking your guess.");
      playTone();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  async function cancelRoom(recover = false) {
    if (!room || !provider.current || !wallet) { openWallet(); return; }
    setBusy(recover ? "Preparing timeout refund…" : "Preparing stake refund…"); setError("");
    try {
      const data = await request<Deposit>(`/api/rooms/${room.code}/${recover ? "recover" : "cancel"}`, { wallet });
      if (data.transaction) {
        setBusy("Approve your refund transaction…");
        const signature = await sendDeposit(provider.current, data.transaction, config.rpcUrl);
        setNotice(`Refund transaction confirmed. Receipt: ${signature.slice(0, 12)}…`);
      }
      const updated = await request<{ room: Room } | Room>(`/api/rooms/${room.code}?wallet=${wallet}`);
      setRoom("room" in updated ? updated.room : updated); await refreshBalance(wallet);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  function adjustStake(action: "half" | "double" | "max") {
    try {
      let amount = BigInt(solToLamports(stake));
      if (action === "max") {
        if (!wallet) { openWallet(); return; }
        if (balance == null) throw new Error("Wallet balance is unavailable. Try reconnecting.");
        amount = BigInt(balance) > BigInt(6_000_000) ? BigInt(balance) - BigInt(6_000_000) : BigInt(0);
        if (amount < BigInt(config.stakeMin)) throw new Error("Your wallet needs more test SOL to cover the minimum stake and fees.");
      } else amount = action === "half" ? amount / BigInt(2) : amount * BigInt(2);
      amount = amount > BigInt(config.stakeMax) ? BigInt(config.stakeMax) : amount;
      if (amount < BigInt(config.stakeMin)) amount = BigInt(config.stakeMin);
      setStake(lamportsToSol(amount.toString())); setError("");
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function copyInvite() {
    if (!room) return;
    try {
      const url = new URL(window.location.href); url.searchParams.set("room", room.code);
      await navigator.clipboard.writeText(url.toString()); setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch { setNotice(`Copy this room code: ${room.code}`); }
  }

  function resetLobby() {
    if (room && !["finished", "cancelled", "refunded", "funding"].includes(room.status)) { setNotice("Your funded room is still open. Cancel before a friend joins, or finish this round first."); return; }
    setRoom(null); setPractice(null); setPracticeResult(null); setPin(null); setError(""); setNotice(""); setMode("duel");
    const url = new URL(window.location.href); url.searchParams.delete("room"); window.history.replaceState({}, "", url);
  }

  const terminal = room && ["finished", "cancelled", "refunded"].includes(room.status);
  const waiting = room && ["funding", "waiting", "starting"].includes(room.status);
  const canStartNew = !room || !!terminal;
  const timerPercentage = active ? (seconds / config.roundSeconds) * 100 : 100;
  const mapPins = target ? [{ ...target, color: "#68aa3d", label: "Actual location" }, ...(result?.guesses || []).map((guess) => ({ ...guess, color: guess.wallet === wallet ? "#ed79a6" : "#537add", label: guess.wallet === wallet ? "Your guess" : "Friend’s guess" })), ...(practiceResult?.guess ? [{ ...practiceResult.guess, color: "#ed79a6", label: "Your guess" }] : [])] : [];
  const sceneSrc = room?.sceneUrl || practice?.sceneUrl || preview;
  const sceneAttribution = room?.attribution || practice?.attribution || previewAttribution;
  const locationResult = result?.location || practiceResult?.location;

  return <main className="desktop">
    <div className="desktop-texture" aria-hidden="true" />
    <aside className="desktop-shortcuts" aria-label="Desktop shortcuts">
      <button onClick={resetLobby} title="Go to lobby"><span className="shortcut-art computer-art"><Monitor /></span><span>My World</span></button>
      <button onClick={() => setDialog("rules")}><span className="shortcut-art folder-art"><FolderOpen /></span><span>How to play</span></button>
      <button onClick={() => setDialog("scores")}><span className="shortcut-art trophy-art"><Trophy /></span><span>My scores</span></button>
      <button onClick={() => { setSound(!sound); try { localStorage.setItem("geopump-sound", String(!sound)); } catch {} }}><span className="shortcut-art music-art"><Music2 /></span><span>Sound {sound ? "on" : "off"}</span></button>
    </aside>

    <div className="desktop-workspace">
      <header className="desktop-header">
        <button className="brand" onClick={resetLobby} aria-label="geopump home"><span className="brand-globe"><Globe2 size={31} /><span>✦</span></span><span>geo<span className="brand-pump">pump</span><small>geo duels · est. 2026</small></span></button>
        <div className="header-actions"><span className="network-badge"><i />SOLANA DEVNET</span><button className="help-button" onClick={() => setDialog("rules")}><HelpCircle size={17} />How it works</button><button className={`wallet-button ${wallet ? "connected" : ""}`} onClick={wallet ? disconnect : openWallet}><Wallet size={16} />{wallet ? shortWallet(wallet) : "Connect wallet"}{wallet && <span className="disconnect-hint">×</span>}</button></div>
      </header>

      <section className="intro-heading">
        <div><p className="eyebrow"><span>★</span> THE INTERNET IS BETTER WITH FRIENDS</p><h1>a little lost.<br /><span>a lot competitive.</span><span className="heading-sparkle" aria-hidden="true">✳</span></h1><p className="intro-description">Same place. Two friends. <strong>30 seconds.</strong><br className="mobile-break" /> Closest guess takes the pot.</p></div>
        <div className="sticky-note"><span className="note-tape" /><span className="note-globe">🌎</span><p>touch grass.<br />from your desk.</p><span className="note-arrow">↙</span></div>
      </section>

      <div className="game-grid">
        <div className="control-column">
          <WindowFrame title="let’s play.exe" icon={<Users size={16} />} className="play-window">
            <div className="window-menu"><span>File</span><span>Friends</span><button onClick={() => setDialog("rules")}>Help</button><span className="menu-stamp">ONLINE <i /></span></div>
            <div className="play-body">
              <div className="mode-tabs" role="tablist" aria-label="Game mode"><button role="tab" aria-selected={mode === "duel"} className={mode === "duel" ? "selected" : ""} onClick={() => canStartNew ? setMode("duel") : setNotice("Finish your funded room before changing game mode.")}><Users size={16} />Friend duel</button><button role="tab" aria-selected={mode === "practice"} className={mode === "practice" ? "selected" : ""} onClick={() => canStartNew ? setMode("practice") : setNotice("Finish your funded room before changing game mode.")}><MousePointer2 size={15} />Practice</button></div>
              {room ? <div className="room-controls">
                <div className="room-code-label">YOUR FRIEND ROOM <span>{room.status === "active" ? "● LIVE" : room.status.toUpperCase()}</span></div>
                <div className="room-code"><strong>{room.code}</strong><button title="Copy room invite" aria-label="Copy room invite" onClick={copyInvite}>{copied ? <Check size={18} /> : <Copy size={17} />}</button></div>
                <p className="room-help">{waiting ? "Send the invite to a friend. Both players stake the same amount." : room.status === "active" ? "Find the location. Drop a pin. Sign your final guess before zero." : "Your round receipt is below. A new room needs a new approval."}</p>
                <div className="pot-display"><span>IN THE POT</span><strong><span className="sol-icon" />{lamportsToSol(room.potLamports)} <small>SOL</small></strong><span>Test SOL · 0% house fee</span></div>
                {((room.status === "funding" || (room.status === "active" && !room.challenge) || (room.status === "waiting" && !room.sceneUrl))) && <button className="retro-button wide" onClick={async () => { setBusy("Restoring room access…"); try { await authenticate(room.code); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(""); } }} disabled={!!busy}>Restore room access</button>}
                {room.status === "funding" && <button className="retro-button wide quiet" onClick={resetLobby} disabled={!!busy}>Back to lobby</button>}{waiting && room.status !== "funding" && room.creatorWallet === wallet && !room.opponentWallet && <button className="retro-button wide quiet" disabled={!!busy} onClick={() => cancelRoom()}>Cancel & refund stake</button>}
                {(room.status === "refundable" || (!!room.refundAt && now >= room.refundAt && !terminal)) && <button className="retro-button wide" disabled={!!busy} onClick={() => cancelRoom(true)}>Recover expired stakes</button>}
                {terminal && <button className="primary-button wide" disabled={!!busy} onClick={resetLobby}>New friend duel <ArrowRight size={17} /></button>}
              </div> : mode === "duel" ? <>
                <label className="stake-label" htmlFor="stake-amount">Your stake <span>TEST SOL</span></label>
                <div className="stake-counter"><span className="sol-icon" /><input id="stake-amount" aria-label="Your stake in SOL" value={stake} onChange={(event) => setStake(event.target.value)} inputMode="decimal" autoComplete="off" /><span className="sol-unit">SOL</span><div className="stake-adjust"><button aria-label="Halve stake" onClick={() => adjustStake("half")}>½</button><button aria-label="Double stake" onClick={() => adjustStake("double")}>2×</button><button aria-label="Maximum stake leaving fee reserve" onClick={() => adjustStake("max")}>MAX</button></div></div>
                <div className="stake-summary"><span>Winner’s pot</span><strong>{(() => { try { return lamportsToSol((BigInt(solToLamports(stake)) * BigInt(2)).toString()); } catch { return "—"; } })()} SOL <span>↗</span></strong></div>
                <button className="primary-button wide" onClick={createRoom} disabled={!!busy || unavailable}><Users size={17} />{wallet ? "Create a room" : "Connect & create room"}<ArrowRight size={17} /></button>
                {unavailable && <p className="service-notice">Escrow deployment is being connected. Practice is available now.</p>}
                <div className="or-divider"><span />or join your friend<span /></div>
                <form className="join-form" onSubmit={(event) => { event.preventDefault(); void joinRoom(); }}><input aria-label="Friend room code" placeholder="ENTER ROOM CODE" value={joinCode} maxLength={12} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /><button aria-label="Join friend room" type="submit" disabled={!!busy || unavailable}><ArrowRight size={18} /></button></form>
                <p className="funds-note"><ShieldCheck size={13} /><span>Equal stakes. Program escrow. No house fee.<br />Wallet approval required for every deposit.</span></p>
              </> : <div className="practice-controls"><div className="practice-sticker"><Globe2 size={35} /><span>NO WALLET<br />JUST WANDER</span><Sparkles size={17} /></div><h3>Get lost for a minute.</h3><p>Real places. A 30-second timer. A world map and your best guess.</p><button className="primary-button wide" onClick={startPractice} disabled={!!busy}><MousePointer2 size={17} />{practice ? "Play another location" : "Start a quick practice"}<ArrowRight size={17} /></button><p className="practice-note">Free play · no stake · no payout</p></div>}
              <div className="wallet-balance"><Wallet size={12} /><span>{wallet ? `Balance: ${balance == null ? "unavailable" : `${lamportsToSol(balance)} test SOL`}` : "Wallet offline. Practice is always free."}</span>{wallet && <a href="https://faucet.solana.com/" target="_blank" rel="noreferrer" title="Get devnet test SOL">Faucet <ExternalLink size={11} /></a>}</div>
            </div>
            <div className="window-status"><span className="green-status" />{busy || (wallet ? "Connected on devnet" : "Ready to explore")}<span>v.1.0</span></div>
          </WindowFrame>

          <WindowFrame title="friends online (2)" icon={<Heart size={13} />} className="friends-window">
            <div className="friend-row"><PlayerAvatar /><div><strong>You <span>(the explorer)</span></strong><p><span className="green-status" />{room?.ownLocked ? "Guess locked. Nice." : wallet ? shortWallet(wallet) : "Feeling geographically lucky"}</p></div></div>
            <div className="friend-row"><PlayerAvatar other /><div><strong>{room?.opponentWallet ? "Your friend" : "Your +1"}<span> (the rival)</span></strong><p><span className={`green-status ${!room?.opponentWallet ? "offline-status" : ""}`} />{room?.opponentWallet ? room.players.find((player) => player.wallet === room.opponentWallet)?.locked ? "Guess locked" : shortWallet(room.opponentWallet) : "One invite away"}</p></div><span className="friend-doodle">♡</span></div>
          </WindowFrame>
        </div>

        <WindowFrame title={room ? `geo duels — room ${room.code}` : practice ? "somewhere on Earth — practice mode" : "somewhere on Earth — world explorer"} icon={<Globe2 size={16} />} className="explorer-window">
          <div className="explorer-toolbar"><div><span className="address-icon"><Globe2 size={13} /></span><span>{hasResult ? "earth://location-found" : active ? "earth://where-are-we?" : "earth://your-next-adventure"}</span><LockKeyhole size={11} /></div><span className="explorer-round"><Radio size={12} />{room ? "FRIEND DUEL" : practice ? "PRACTICE" : "360° REAL PLACES"}</span></div>
          <div className="scene-wrapper"><GamePanorama src={sceneSrc} active={active} /><div className={`round-counter ${active && seconds <= 5 ? "urgent" : ""}`}><span>{hasResult ? "ROUND COMPLETE" : room?.status === "settling" ? "REVEALING…" : active ? "TIME TO GUESS" : "ONE QUICK ROUND"}</span><strong>{hasResult ? <Check size={36} /> : <>00<span>:</span>{String(seconds).padStart(2, "0")}</>}</strong><div className="counter-progress"><i style={{ width: `${hasResult ? 100 : timerPercentage}%` }} /></div></div>{!active && !hasResult && <div className="scene-postcard"><span>you could be anywhere.</span><span className="postcard-arrow">↗</span></div>}</div>
          {sceneAttribution && <div className="image-credit">Street imagery by {sceneAttribution.author} · <a href={sceneAttribution.licenseUrl} target="_blank" rel="noreferrer">{sceneAttribution.license}</a></div>}<div className="map-header"><div><MapPin size={15} /><strong>{hasResult ? "The big reveal" : "So… where are we?"}</strong><span>{hasResult ? locationResult?.label || "The truth, and how close you got." : "Trust your gut. Drop your pin."}</span></div>{target ? <span className="map-legend"><i className="actual-dot" />Actual <i className="guess-dot" />You {result?.guesses.some((guess) => guess.wallet !== wallet) && <><i className="friend-dot" />Friend</>}</span> : <span className="map-stamp">WORLD MAP</span>}</div>
          <GameMap value={pin} onChange={(point) => { setPin(point); playTone(); }} disabled={!active || locked || seconds <= 0} pins={mapPins} />
          {hasResult ? <div className="result-panel"><div className="result-medal"><Trophy size={28} /></div><div className="result-copy"><span>{practiceResult ? "EXPLORATION COMPLETE" : result?.tie ? "A FRIENDLY DRAW" : won ? "YOU FOUND IT FIRST" : "ROUND COMPLETE"}</span><h3>{practiceResult ? ownDistance == null ? "Time’s up, explorer." : `${distanceLabel(ownDistance)} from the spot.` : result?.tie ? result.reason === "both_missed" ? "Nobody locked a guess." : "Great minds guess alike." : won ? "You take the pot!" : result?.reason === "timeout" ? "Your friend takes the pot." : "Your friend was closer."}</h3><p>{practiceResult ? ownDistance == null ? "Next time, drop a pin and lock it before zero." : `${practiceResult.score.toLocaleString()} geography points. Keep exploring at your own pace.` : result?.signature ? `${lamportsToSol(result.winnerPayoutLamports)} test SOL ${result.tie ? "returned per player" : "paid to the winner"}.` : result?.receiptStatus === "unavailable" ? "Settled — receipt unavailable." : "Result recorded. Solana settlement is pending."}</p>{result?.signature && <a className="receipt-link" href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`} target="_blank" rel="noreferrer">View payout receipt <ExternalLink size={12} /></a>}</div><button className="retro-button rematch-button" disabled={!!busy || (!!room && !terminal)} onClick={room ? resetLobby : startPractice}><RotateCcw size={15} />{room ? "New duel" : "Another place"}</button></div> : <div className="guess-action"><div><span className={`guess-status-dot ${locked ? "locked-dot" : ""}`} /><span>{locked ? "Your guess is locked. Waiting for time’s up." : (seconds <= 0 && active) || room?.status === "settling" ? "Time’s up. Revealing the location…" : active ? pin ? "Pin placed. Make it your final answer." : "Look around, then click the map to guess." : waiting ? "Waiting for your friend to join…" : terminal ? "Stakes refunded. Create a fresh room when ready." : "Your next 30-second adventure starts here."}</span></div><button className="lock-button" disabled={!active || !pin || locked || !!busy || seconds <= 0} onClick={lockGuess}>{locked ? <Check size={16} /> : <LockKeyhole size={15} />}{locked ? "GUESS LOCKED" : "LOCK MY GUESS"}{!locked && <ArrowRight size={15} />}</button></div>}
          {result && <div className="duel-distances"><div><span className="guess-dot" />You<strong>{distanceLabel(ownGuess?.distanceMeters)}</strong></div><div><span className="friend-dot" />Your friend<strong>{distanceLabel(result.guesses.find((guess) => guess.wallet !== wallet)?.distanceMeters)}</strong></div></div>}<div className="window-status"><span><span className="green-status" />{hasResult ? "Location revealed" : "Real street imagery · Panoramax"}</span><span>{hasResult && target ? `${(target.latE6 / 1e6).toFixed(4)}°, ${(target.lngE6 / 1e6).toFixed(4)}°` : "A whole world. One little pin."}</span></div>
        </WindowFrame>
      </div>

      {(error || notice || busy) && <div className={`system-message ${error ? "message-error" : ""}`} role={error ? "alert" : "status"}>{busy ? <LoaderCircle size={16} className="spin" /> : error ? <HelpCircle size={16} /> : <Check size={16} />}<span>{busy || error || notice}</span>{!busy && <button aria-label="Dismiss notification" onClick={() => { setError(""); setNotice(""); }}><X size={15} /></button>}</div>}

      <section className="desktop-footer"><div className="little-note"><span>✳</span>small rounds. big world. good company.</div><button onClick={() => setDialog("scores")}><Trophy size={13} />Your best: <strong>{best == null ? "the next guess" : distanceLabel(best)}</strong><ChevronRight size={13} /></button><span className="test-sol-note"><ShieldCheck size={12} />Test SOL only. Zero house fee.</span></section>
    </div>

    <footer className="taskbar"><div className="start-wrap"><button className="start-button" aria-expanded={startMenu} onClick={() => setStartMenu(!startMenu)}><span className="start-logo"><i /><i /><i /><i /></span>start</button>{startMenu && <div className="start-menu"><strong>geopump desktop</strong><button onClick={() => { resetLobby(); setStartMenu(false); }}><Globe2 size={17} />World explorer</button><button onClick={() => { setDialog("scores"); setStartMenu(false); }}><Trophy size={17} />My scores</button><button onClick={() => { setDialog("rules"); setStartMenu(false); }}><HelpCircle size={17} />How to play</button><button onClick={() => { setDialog("about"); setStartMenu(false); }}><Heart size={17} />About geopump</button></div>}</div><div className="taskbar-divider" /><span className="taskbar-quick" aria-hidden="true"><Globe2 size={18} /><Users size={18} /></span><button className="active-task" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><Globe2 size={15} />geopump — Geo Duels</button><span className="taskbar-spacer" /><button className="taskbar-sound" aria-label={sound ? "Mute sound" : "Enable sound"} onClick={() => { setSound(!sound); try { localStorage.setItem("geopump-sound", String(!sound)); } catch {} }}>{sound ? <Volume2 size={16} /> : <VolumeX size={16} />}</button><span className="taskbar-clock"><span className="green-status" />{now ? new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}</span></footer>

    {dialog && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><div className="retro-window modal-window" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={dialogRef} tabIndex={-1}><div className="window-title"><span id="dialog-title">{dialog === "wallet" ? "Connect to your world" : dialog === "rules" ? "A very quick how-to" : dialog === "scores" ? "Your explorer journal" : "About this little corner of the internet"}</span><button className="modal-close" onClick={() => setDialog(null)} aria-label="Close dialog"><X size={15} /></button></div><div className="modal-body">
      {dialog === "wallet" ? <><div className="modal-illustration"><Wallet size={35} /> <Sparkles size={20} /></div><h2>Your wallet. Your room.</h2><p>Connect a Solana wallet to stake <strong>devnet test SOL</strong>. Every stake needs your approval. Free practice works without a wallet.</p>{walletOptions.length ? walletOptions.map((option) => <button className="wallet-option" key={option.name} onClick={() => connectWallet(option)} disabled={!!busy}><Wallet size={18} />{option.name}<span>Connect <ArrowRight size={14} /></span></button>) : <><p className="service-notice">No Solana wallet was detected in this browser.</p><a className="wallet-option" href="https://phantom.com/download" target="_blank" rel="noreferrer">Get Phantom <ExternalLink size={15} /></a><a className="wallet-option" href="https://www.solflare.com/" target="_blank" rel="noreferrer">Get Solflare <ExternalLink size={15} /></a><button className="retro-button wide" onClick={() => setWalletOptions(installedWallets())}>Check for wallets again</button></>}<button className="text-button" onClick={() => { setDialog(null); void startPractice(); }} disabled={!canStartNew}>Just let me practice →</button>{error && <p className="error-text">{error}</p>}</> : dialog === "rules" ? <><p className="modal-kicker">TWO FRIENDS. ONE REAL PLACE. THIRTY SECONDS.</p><div className="rule-step"><b>01</b><div><h3>Make room for a little rivalry.</h3><p>Connect on Solana devnet, choose your test SOL stake, create a room and send its code to your friend. Your friend approves an equal deposit.</p></div></div><div className="rule-step"><b>02</b><div><h3>Get lost together.</h3><p>You see the same random 360° real location. Drag to look around. Drop your pin on the world map and lock it before the 30-second timer ends. A wallet message locks your duel guess.</p></div></div><div className="rule-step"><b>03</b><div><h3>Closest takes the pot.</h3><p>Great-circle distance decides the winner. Distances round to the nearest metre; an equal score returns each stake. One accepted guess wins if the other player misses. Neither guesses? Both stakes return.</p></div></div><div className="rules-details"><p><ShieldCheck size={15} /><strong>0% house fee.</strong> Two 0.001 SOL stakes make a 0.002 SOL pot. Network fees and refundable account storage are separate.</p><p><Clock3 size={15} />Cancel while waiting for a friend. Expired rooms have an on-chain refund route. A trusted game referee selects locations and calculates scores; the Solana program guards the escrow.</p><p><Globe2 size={15} />Curated real places, with Panoramax street imagery and a Natural Earth map. Practice has no money or opponent.</p></div><button className="primary-button wide" onClick={() => setDialog(null)}>Got it. Let’s get lost. <ArrowRight size={17} /></button></> : dialog === "scores" ? <><div className="journal-heading"><Trophy size={34} /><div><span>PERSONAL BEST</span><h2>{distanceLabel(best) === "No guess" ? "Your story starts here." : distanceLabel(best)}</h2></div></div><p>{history.length} rounds on this browser. Each new location is a new adventure.</p>{history.length ? <div className="history-list">{history.map((item) => <div key={item.id}><span>{item.kind === "practice" ? "Practice" : item.won ? "Duel won" : "Friend duel"}<small>{new Date(item.time).toLocaleDateString()}</small></span><strong>{distanceLabel(item.distance)}</strong></div>)}</div> : <div className="empty-journal"><MapPin size={28} /><p>No pins in your journal yet.<br />One quick practice will change that.</p></div>}<button className="primary-button wide" onClick={() => { setDialog(null); void startPractice(); }} disabled={!canStartNew}>Explore a new place <ArrowRight size={17} /></button></> : <><div className="modal-illustration"><Globe2 size={38} /><Heart size={22} /></div><h2>a little lost. a lot competitive.</h2><p>geopump is a little multiplayer geography game for friends. Our desktop takes inspiration from the internet we grew up with.</p><p>This build runs on <strong>Solana devnet</strong>. All stakes use test SOL. The referee is trusted for scene selection and scoring. Paid status appears only after an on-chain receipt.</p><div className="about-links"><a href="https://panoramax.fr/" target="_blank" rel="noreferrer">Street imagery: Panoramax <ExternalLink size={12} /></a><a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">World map: Natural Earth <ExternalLink size={12} /></a>{config.programId && <a href={`https://explorer.solana.com/address/${config.programId}?cluster=devnet`} target="_blank" rel="noreferrer">View Solana program <ExternalLink size={12} /></a>}</div><button className="retro-button wide" onClick={() => setDialog(null)}>Back to my world</button></>}
    </div></div></div>}
  </main>;
}
