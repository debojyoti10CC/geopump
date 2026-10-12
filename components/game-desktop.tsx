"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { ArrowRight, Check, ChevronRight, Copy, Globe2, HelpCircle, MapPin, Monitor, Radio, RotateCcw, ShieldCheck, Sparkles, Trophy, Users, Volume2, VolumeX, Wallet, X, ExternalLink, LoaderCircle, LockKeyhole, Clock3, Heart } from "lucide-react";
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
type Deposit = { room: Room; transaction?: string; auth?: { message: string } };
type HistoryItem = { id: string; kind: "duel"; distance: number | null; won: boolean; time: number };
type Dialog = "rules" | "wallet" | "scores" | "about" | null;

const defaults: Config = { network: "devnet", programId: null, rpcUrl: "https://api.devnet.solana.com", stakeMin: "1000000", stakeMax: "1000000000", roundSeconds: 30, escrowReady: false };
const distanceLabel = (meters: number | null | undefined) => meters == null ? "No guess" : meters < 1000 ? `${meters} m` : `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";

async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  let data: { message?: string; error?: string | { message?: string } };
  try { data = await response.json(); }
  catch { throw new Error("Temporary connection issue. Please try again shortly."); }
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

function DesktopIcon({ kind }: { kind: "computer" | "folder" | "scores" | "music" }) {
  return <svg viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
    {kind === "computer" ? <><path d="M5 2h22v21H5z" fill="#000" /><path d="M6 3h20v19H6z" fill="#c0c0c0" /><path d="M7 4h18v2H7zM7 4h2v16H7z" fill="#fff" /><path d="M9 6h14v12H9z" fill="#000080" /><path d="M10 7h12v2H10z" fill="#0000c0" /><path d="M13 22h6v4h-6zM3 26h26v4H3z" fill="#000" /><path d="M14 22h4v4h-4zM4 26h24v3H4z" fill="#c0c0c0" /><path d="M4 26h24v1H4z" fill="#fff" /><path d="M6 28h3v1H6zM11 28h3v1h-3zM16 28h3v1h-3zM21 28h3v1h-3z" fill="#808080" /></> : kind === "folder" ? <><path d="M2 8h11l3 3h14v17H2z" fill="#000" /><path d="M3 9h9l3 3h14v14H3z" fill="#ffff80" /><path d="M3 13h26v2H3z" fill="#fff" /><path d="M4 15h25l-3 12H1z" fill="#000" /><path d="M5 16h22l-2 10H3z" fill="#ffff00" /><path d="M5 16h21v1H5z" fill="#fff" /><path d="M3 25h22v1H3z" fill="#808000" /></> : kind === "scores" ? <><path d="M6 2h17l4 4v25H6z" fill="#000" /><path d="M7 3h15l4 4v23H7z" fill="#fff" /><path d="M22 3v5h4" fill="#c0c0c0" /><path d="M10 10h12v2H10zM10 15h12v1H10zM10 19h12v1H10zM10 23h9v1h-9z" fill="#000080" /><path d="M3 7h5v16H3z" fill="#808080" /><path d="M4 8h3v14H4z" fill="#ffff00" /><path d="M4 8h3v2H4z" fill="#fff" /></> : <><path d="M9 9h15v2h4v4h2v9h-2v4h-4v2H9v-2H5v-4H3v-9h2v-4h4z" fill="#000" /><path d="M10 10h13v2h4v4h2v7h-2v4h-4v2H10v-2H6v-4H4v-7h2v-4h4z" fill="#c0c0c0" /><path d="M10 11h6v7h-4z" fill="#fff" /><path d="M21 23h6v4h-4v2h-7v-5z" fill="#ffff00" /><path d="M5 16h8v3H5z" fill="#00ffff" /><path d="M15 16h6v6h-6z" fill="#fff" /><path d="M17 18h2v2h-2z" fill="#808080" /><path d="M15 1h2v12h-2v2h-5v-4h4V1zM17 1h6v4h-6z" fill="#008000" /><path d="M16 1h1v10h-1" fill="#00ff00" /></>}
  </svg>;
}

const digitSegments = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"];
const segmentShapes = ["3,0 17,0 15,3 5,3", "18,1 20,3 20,14 18,16 17,14 17,4", "18,17 20,19 20,30 18,32 17,30 17,20", "3,33 17,33 15,30 5,30", "0,19 2,17 3,20 3,30 2,32 0,30", "0,3 2,1 3,4 3,14 2,16 0,14", "3,16 5,14 15,14 17,16 15,18 5,18"];

function DigitalCounter({ seconds, complete }: { seconds: number; complete: boolean }) {
  const value = complete ? 0 : seconds;
  const digits = `${String(Math.floor(value / 60)).padStart(2, "0")}${String(value % 60).padStart(2, "0")}`;
  return <span className="digital-display" role="img" aria-label={`Round timer: ${Math.floor(value / 60)} minutes ${value % 60} seconds`}>
    {digits.split("").map((digit, index) => <span key={index} style={{ display: "contents" }}>{index === 2 && <svg className="digital-colon" viewBox="0 0 7 34" aria-hidden="true"><rect x="2" y="10" width="3" height="3" className="digit-on" /><rect x="2" y="22" width="3" height="3" className="digit-on" /></svg>}<svg className="digital-digit" viewBox="0 0 20 34" aria-hidden="true">{segmentShapes.map((points, segment) => <polygon key={segment} points={points} className={digitSegments[Number(digit)].includes("abcdefg"[segment]) ? "digit-on" : "digit-off"} />)}</svg></span>)}
  </span>;
}

export default function GameDesktop() {
  const [config, setConfig] = useState(defaults);
  const [configured, setConfigured] = useState(false);
  const [wallet, setWallet] = useState("");
  const provider = useRef<WalletProvider | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [stake, setStake] = useState("0.001");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
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

  const active = room?.status === "active";
  const result = room?.result;
  const hasResult = !!result;
  const deadline = room?.deadline || null;
  const seconds = (active || room?.status === "settling") && deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : config.roundSeconds;
  const locked = !!room?.ownLocked;
  const ownGuess = result?.guesses.find((guess) => guess.wallet === wallet);
  const ownDistance = ownGuess?.distanceMeters ?? null;
  const won = !!result?.winnerWallet && result.winnerWallet === wallet;
  const target = result?.target;
  const best = history.filter((item) => item.distance != null).reduce<number | null>((value, item) => value == null ? item.distance : Math.min(value, item.distance!), null);
  const unavailable = configured && !config.escrowReady;

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now() + clockOffset.current), 200);
    request<Config>("/api/config").then((value) => { if (value.serverTime) clockOffset.current = value.serverTime - Date.now(); setConfig({ ...defaults, ...value }); setConfigured(true); }).catch((cause) => { setError(errorMessage(cause)); setConfigured(true); });
    request<{ sceneUrl: string; attribution: Attribution }>("/api/preview-scene").then((value) => { setPreview(value.sceneUrl); setPreviewAttribution(value.attribution); }).catch(() => {});
    try {
      const stored = JSON.parse(localStorage.getItem("geopump-history") || "[]");
      if (Array.isArray(stored)) setHistory(stored.filter((item: HistoryItem) => item?.kind === "duel").slice(0, 20));
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
        if (!stopped) { const current = "room" in data ? data.room : data; if (current.serverTime) clockOffset.current = current.serverTime - Date.now(); setRoom(current); setNotice(currentNotice => currentNotice.startsWith("Room connection:") ? "" : currentNotice); }
      } catch (cause) { if (!stopped) setNotice(`Room connection: ${errorMessage(cause)}`); }
    };
    const timer = setInterval(poll, 1300);
    return () => { stopped = true; clearInterval(timer); };
  }, [room?.code, wallet]);

  useEffect(() => {
    if (!hasResult || (room && wallet !== room.creatorWallet && wallet !== room.opponentWallet)) return;
    const id = room?.code || "";
    if (!id || savedResult.current === id) return;
    savedResult.current = id;
    const item: HistoryItem = { id, kind: "duel", distance: ownDistance, won, time: Date.now() };
    setHistory((previous) => {
      const updated = [item, ...previous.filter((entry) => entry.id !== id)].slice(0, 20);
      try { localStorage.setItem("geopump-history", JSON.stringify(updated)); } catch {}
      return updated;
    });
    if (wallet) void refreshBalance(wallet);
  }, [hasResult, room, ownDistance, won, wallet, refreshBalance]);

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
    setRoom(data.room); setPin(null); setCopied(false);
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
        setBusy("Restore your existing room access…"); await authenticate(code); setPin(null);
      } else await processDeposit(await request<Deposit>(`/api/rooms/${code}/join`, { wallet }));
    }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  async function lockGuess() {
    if (!pin || busy || seconds <= 0) return;
    setError(""); setBusy("Sign your final guess…");
    try {
      if (room && provider.current && wallet) {
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
    if (!room || room.status === "funding") return;
    try {
      const url = new URL(window.location.href); url.searchParams.set("room", room.code);
      await navigator.clipboard.writeText(url.toString()); setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch { setNotice(`Copy this room code: ${room.code}`); }
  }

  function resetLobby() {
    if (busy) { setNotice("Finish or cancel the current wallet request before returning to the lobby."); return; }
    if (room && !["finished", "cancelled", "refunded", "funding"].includes(room.status)) { setNotice("Your funded room is still open. Cancel before a friend joins, or finish this round first."); return; }
    setRoom(null); setPin(null); setJoinCode(""); setCopied(false); setError(""); setNotice("");
    const url = new URL(window.location.href); url.searchParams.delete("room"); window.history.replaceState({}, "", url);
  }

  const terminal = room && ["finished", "cancelled", "refunded"].includes(room.status);
  const waiting = room && ["funding", "waiting", "starting"].includes(room.status);
  const roomHelp = room?.status === "funding" ? "Your stake is not confirmed yet. Finish the wallet approvals before inviting your friend."
    : room?.status === "waiting" ? room.opponentWallet === wallet ? "Finish your matching stake and room access approvals. The timer starts after both deposits confirm."
      : room.opponentWallet ? "Your friend is confirming their stake. The timer starts after both deposits confirm."
        : "Your stake is confirmed. Send the invite to a friend; they approve the same stake."
    : room?.status === "starting" ? "Both stakes are confirmed. Your 30-second round is starting."
    : active ? "Find the location. Drop a pin. Sign your final guess before zero."
    : room?.status === "settling" ? "Time is up. Comparing guesses and confirming the Solana payout."
    : room?.status === "refundable" ? "This room expired. Recover your stakes below before starting a new duel."
    : "Your round receipt is below. A new room needs a new approval.";
  const waitingHelp = room?.status === "funding" ? "Confirm your stake before inviting your friend."
    : room?.status === "starting" ? "Both stakes confirmed. Starting your round…"
    : room?.opponentWallet ? "Waiting for the second stake to confirm…" : "Waiting for your friend to join…";
  const timerPercentage = active ? (seconds / config.roundSeconds) * 100 : 100;
  const mapPins = target ? [{ ...target, color: "#68aa3d", label: "Actual location" }, ...(result?.guesses || []).map((guess) => ({ ...guess, color: guess.wallet === wallet ? "#ed79a6" : "#537add", label: guess.wallet === wallet ? "Your guess" : "Friend’s guess" }))] : [];
  const sceneSrc = room?.sceneUrl || preview;
  const sceneAttribution = room?.sceneUrl ? room.attribution : previewAttribution;
  const locationResult = result?.location;
  const sceneLabel = !room?.sceneUrl ? "SCENE PREVIEW · START A FRIEND DUEL" : hasResult ? "ROUND LOCATION · ANSWER REVEALED" : active ? "LIVE LOCATION · ANSWER HIDDEN" : "ROUND LOCATION · REVEALING RESULT";

  return <main className="desktop">
    <div className="desktop-texture" aria-hidden="true" />
    <aside className="desktop-shortcuts" aria-label="Desktop shortcuts">
      <button onClick={resetLobby} title="Go to lobby"><span className="shortcut-art computer-art"><DesktopIcon kind="computer" /></span><span>My World</span></button>
      <button onClick={() => setDialog("rules")}><span className="shortcut-art folder-art"><DesktopIcon kind="folder" /></span><span>How to play</span></button>
      <button onClick={() => setDialog("scores")}><span className="shortcut-art trophy-art"><DesktopIcon kind="scores" /></span><span>My scores</span></button>
      <button onClick={() => { setSound(!sound); try { localStorage.setItem("geopump-sound", String(!sound)); } catch {} }}><span className="shortcut-art music-art"><DesktopIcon kind="music" /></span><span>Sound {sound ? "on" : "off"}</span></button>
    </aside>

    <div className="desktop-workspace">
      <header className="desktop-header">
        <button className="brand" onClick={resetLobby} aria-label="geopump home"><span className="brand-globe"><Globe2 size={31} /><span>✦</span></span><span>geo<span className="brand-pump">pump</span><small>geo duels · est. 2026</small></span></button>
        <div className="header-actions"><span className="network-badge"><i />SOLANA DEVNET</span><button className="help-button" onClick={() => setDialog("rules")}><HelpCircle size={17} />How it works</button><button className={`wallet-button ${wallet ? "connected" : ""}`} onClick={wallet ? disconnect : openWallet}><Wallet size={16} />{wallet ? shortWallet(wallet) : "Connect wallet"}{wallet && <span className="disconnect-hint">×</span>}</button></div>
      </header>

      <div className="game-grid">
        <div className="control-column">
          <WindowFrame title="Geo Duels — friend room" icon={<Users size={16} />} className="play-window">
            <div className="window-menu"><span>File</span><span>Friends</span><button onClick={() => setDialog("rules")}>Help</button><span className="menu-stamp">{config.escrowReady ? "READY" : "DEVNET"} <i /></span></div>
            <div className="play-body">
              {room ? <div className="room-controls">
                <div className="room-code-label">YOUR FRIEND ROOM <span>{room.status === "active" ? "● LIVE" : room.status.toUpperCase()}</span></div>
                <div className="room-code"><strong>{room.code}</strong><button title={room.status === "funding" ? "Confirm your stake before sharing the invite" : "Copy room invite"} aria-label="Copy room invite" disabled={room.status === "funding"} onClick={copyInvite}>{copied ? <Check size={18} /> : <Copy size={17} />}</button></div>
                <p className="room-help">{roomHelp}</p>
                <div className="pot-display"><span>IN THE POT</span><strong><span className="sol-icon" />{lamportsToSol(room.potLamports)} <small>SOL</small></strong><span>Test SOL · 0% house fee</span></div>
                {((room.status === "funding" || (room.status === "active" && !room.challenge) || (room.status === "waiting" && !room.sceneUrl))) && <button className="retro-button wide" onClick={async () => { setBusy("Restoring room access…"); try { await authenticate(room.code); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(""); } }} disabled={!!busy}>Restore room access</button>}
                {room.status === "funding" && <button className="retro-button wide quiet" onClick={resetLobby} disabled={!!busy}>Back to lobby</button>}{waiting && room.status !== "funding" && room.creatorWallet === wallet && !room.opponentWallet && <button className="retro-button wide quiet" disabled={!!busy} onClick={() => cancelRoom()}>Cancel & refund stake</button>}
                {(room.status === "refundable" || (!!room.refundAt && now >= room.refundAt && !terminal)) && <button className="retro-button wide" disabled={!!busy} onClick={() => cancelRoom(true)}>Recover expired stakes</button>}
                {terminal && <button className="primary-button wide" disabled={!!busy} onClick={resetLobby}>New friend duel <ArrowRight size={17} /></button>}
              </div> : <>
                <label className="stake-label" htmlFor="stake-amount">Your stake <span>TEST SOL</span></label>
                <div className="stake-counter"><span className="sol-icon" /><input id="stake-amount" aria-label="Your stake in SOL" value={stake} onChange={(event) => setStake(event.target.value)} inputMode="decimal" autoComplete="off" /><span className="sol-unit">SOL</span><div className="stake-adjust"><button aria-label="Halve stake" onClick={() => adjustStake("half")}>½</button><button aria-label="Double stake" onClick={() => adjustStake("double")}>2×</button><button aria-label="Maximum stake leaving fee reserve" onClick={() => adjustStake("max")}>MAX</button></div></div>
                <div className="stake-summary"><span>Winner’s pot</span><strong>{(() => { try { return lamportsToSol((BigInt(solToLamports(stake)) * BigInt(2)).toString()); } catch { return "—"; } })()} SOL <span>↗</span></strong></div>
                <button className="primary-button wide" onClick={createRoom} disabled={!!busy || unavailable}><Users size={17} />{wallet ? "Create a room" : "Connect & create room"}<ArrowRight size={17} /></button>
                {unavailable && <p className="service-notice">Room staking is temporarily unavailable. Please try again shortly.</p>}
                <div className="or-divider"><span />or join your friend<span /></div>
                <form className="join-form" onSubmit={(event) => { event.preventDefault(); void joinRoom(); }}><input aria-label="Friend room code" placeholder="ENTER ROOM CODE" value={joinCode} maxLength={12} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /><button aria-label="Join friend room" type="submit" disabled={!!busy || unavailable}><ArrowRight size={18} /></button></form>
                <p className="funds-note"><ShieldCheck size={13} /><span>Equal stakes. Program escrow. No house fee.<br />Wallet approval required for every deposit.</span></p>
              </>}
              <div className="wallet-balance"><Wallet size={12} /><span>{wallet ? `Balance: ${balance == null ? "unavailable" : `${lamportsToSol(balance)} test SOL`}` : "Connect your wallet to create or join a room."}</span>{wallet && <a href="https://faucet.solana.com/" target="_blank" rel="noreferrer" title="Get devnet test SOL">Faucet <ExternalLink size={11} /></a>}</div>
            </div>
            <div className="window-status"><span className="green-status" />{busy || (wallet ? "Connected on devnet" : "Ready to explore")}<span>v.1.0</span></div>
          </WindowFrame>

          {room && <WindowFrame title={`Room players (${room.players.length}/2)`} icon={<Users size={13} />} className="friends-window">
            <div className="friend-row"><PlayerAvatar /><div><strong>You <span>(the explorer)</span></strong><p><span className="green-status" />{room?.ownLocked ? "Guess locked. Nice." : wallet ? shortWallet(wallet) : "Feeling geographically lucky"}</p></div></div>
            <div className="friend-row"><PlayerAvatar other /><div><strong>Your friend<span> (the rival)</span></strong><p><span className={`green-status ${!room.players.some(player => player.wallet !== wallet) ? "offline-status" : ""}`} />{room.players.find(player => player.wallet !== wallet)?.locked ? "Guess locked" : room.players.find(player => player.wallet !== wallet) ? shortWallet(room.players.find(player => player.wallet !== wallet)!.wallet) : "Waiting for an invite"}</p></div></div>
          </WindowFrame>}
        </div>

        <WindowFrame title={room ? `Geo Duels — room ${room.code}` : "Geo Duels — location & guess"} icon={<Globe2 size={16} />} className="explorer-window">
          <div className="explorer-toolbar"><div><span className="address-icon"><Globe2 size={13} /></span><span>{hasResult ? "earth://location-found" : active ? "earth://where-are-we?" : "earth://your-next-adventure"}</span><LockKeyhole size={11} /></div><span className="explorer-round"><Radio size={12} />{"FRIEND DUEL"}</span></div>
          <div className="scene-wrapper"><GamePanorama src={sceneSrc} active={active} label={sceneLabel} /><div className={`round-counter ${active && seconds <= 5 ? "urgent" : ""}`}><span>{hasResult ? "ROUND COMPLETE" : room?.status === "settling" ? "REVEALING…" : active ? "TIME TO GUESS" : "ROUND TIME"}</span><strong><DigitalCounter seconds={seconds} complete={hasResult} /></strong><div className="counter-progress"><i style={{ width: `${hasResult ? 100 : timerPercentage}%` }} /></div></div></div>
          {sceneAttribution && <div className="image-credit">Street imagery by {sceneAttribution.author} · <a href={sceneAttribution.licenseUrl} target="_blank" rel="noreferrer">{sceneAttribution.license}</a></div>}<div className="map-header"><div><MapPin size={15} /><strong>{hasResult ? "The big reveal" : "So… where are we?"}</strong><span>{hasResult ? locationResult?.label || "The truth, and how close you got." : "Trust your gut. Drop your pin."}</span></div>{target ? <span className="map-legend"><i className="actual-dot" />Actual <i className="guess-dot" />You {result?.guesses.some((guess) => guess.wallet !== wallet) && <><i className="friend-dot" />Friend</>}</span> : <span className="map-stamp">WORLD MAP</span>}</div>
          <GameMap value={pin} onChange={(point) => { setPin(point); playTone(); }} disabled={!active || locked || seconds <= 0} pins={mapPins} />
          {hasResult ? <div className="result-panel"><div className="result-medal"><Trophy size={28} /></div><div className="result-copy"><span>{result?.tie ? "A FRIENDLY DRAW" : won ? "ROUND WON" : "ROUND COMPLETE"}</span><h3>{result?.tie ? result.reason === "both_missed" ? "Nobody locked a guess." : "Great minds guess alike." : won ? "You take the pot!" : result?.reason === "timeout" ? "Your friend takes the pot." : "Your friend was closer."}</h3><p>{result?.signature ? `${lamportsToSol(result.winnerPayoutLamports)} test SOL ${result.tie ? "returned per player" : "paid to the winner"}.` : result?.receiptStatus === "unavailable" ? "Settled — receipt unavailable." : "Result recorded. Solana settlement is pending."}</p>{result?.signature && <a className="receipt-link" href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`} target="_blank" rel="noreferrer">View payout receipt <ExternalLink size={12} /></a>}</div><button className="retro-button rematch-button" disabled={!!busy || (!!room && !terminal)} onClick={resetLobby}><RotateCcw size={15} />New duel</button></div> : <div className="guess-action"><div><span className={`guess-status-dot ${locked ? "locked-dot" : ""}`} /><span>{locked ? "Your guess is locked. Waiting for time’s up." : (seconds <= 0 && active) || room?.status === "settling" ? "Time’s up. Revealing the location…" : active ? pin ? "Pin placed. Make it your final answer." : "Look around, then click the map to guess." : waiting ? waitingHelp : terminal ? "Stakes refunded. Create a fresh room when ready." : "Create a room or join your friend to start."}</span></div><button className="lock-button" disabled={!active || !pin || locked || !!busy || seconds <= 0} onClick={lockGuess}>{locked ? <Check size={16} /> : <LockKeyhole size={15} />}{locked ? "GUESS LOCKED" : "LOCK MY GUESS"}{!locked && <ArrowRight size={15} />}</button></div>}
          {result && <div className="duel-distances"><div><span className="guess-dot" />You<strong>{distanceLabel(ownGuess?.distanceMeters)}</strong></div><div><span className="friend-dot" />Your friend<strong>{distanceLabel(result.guesses.find((guess) => guess.wallet !== wallet)?.distanceMeters)}</strong></div></div>}<div className="window-status"><span><span className="green-status" />{hasResult ? "Location revealed" : "Real street imagery · Panoramax"}</span><span>{hasResult && target ? `${(target.latE6 / 1e6).toFixed(4)}°, ${(target.lngE6 / 1e6).toFixed(4)}°` : "A whole world. One little pin."}</span></div>
        </WindowFrame>
      </div>

      {(error || notice || busy) && <div className={`system-message ${error ? "message-error" : ""}`} role={error ? "alert" : "status"}>{busy ? <LoaderCircle size={16} className="spin" /> : error ? <HelpCircle size={16} /> : <Check size={16} />}<span>{busy || error || notice}</span>{!busy && <button aria-label="Dismiss notification" onClick={() => { setError(""); setNotice(""); }}><X size={15} /></button>}</div>}

      <section className="desktop-footer"><button onClick={() => setDialog("scores")}><Trophy size={13} />Your best: <strong>{best == null ? "the next guess" : distanceLabel(best)}</strong><ChevronRight size={13} /></button><span className="test-sol-note"><ShieldCheck size={12} />Test SOL only. Zero house fee.</span></section>
    </div>

    <footer className="taskbar"><div className="start-wrap"><button className="start-button" aria-expanded={startMenu} onClick={() => setStartMenu(!startMenu)}><span className="start-logo"><i /><i /><i /><i /></span>Start</button>{startMenu && <div className="start-menu"><strong>geopump desktop</strong><button onClick={() => { resetLobby(); setStartMenu(false); }}><Globe2 size={17} />Friend duel</button><button onClick={() => { setDialog("scores"); setStartMenu(false); }}><Trophy size={17} />My scores</button><button onClick={() => { setDialog("rules"); setStartMenu(false); }}><HelpCircle size={17} />How to play</button><button onClick={() => { setDialog("about"); setStartMenu(false); }}><Heart size={17} />About geopump</button></div>}</div><div className="taskbar-divider" /><span className="taskbar-quick" aria-hidden="true"><Globe2 size={18} /><Users size={18} /></span><button className="active-task" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><Globe2 size={15} />geopump — Geo Duels</button><span className="taskbar-spacer" /><button className="taskbar-sound" aria-label={sound ? "Mute sound" : "Enable sound"} onClick={() => { setSound(!sound); try { localStorage.setItem("geopump-sound", String(!sound)); } catch {} }}>{sound ? <Volume2 size={16} /> : <VolumeX size={16} />}</button><span className="taskbar-clock"><span className="green-status" />{now ? new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}</span></footer>

    {dialog && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><div className="retro-window modal-window" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={dialogRef} tabIndex={-1}><div className="window-title"><span id="dialog-title">{dialog === "wallet" ? "Connect to your world" : dialog === "rules" ? "A very quick how-to" : dialog === "scores" ? "Your explorer journal" : "About this little corner of the internet"}</span><button className="modal-close" onClick={() => setDialog(null)} aria-label="Close dialog"><X size={15} /></button></div><div className="modal-body">
      {dialog === "wallet" ? <><div className="modal-illustration"><Wallet size={35} /> <Sparkles size={20} /></div><h2>Your wallet. Your room.</h2><p>Connect a Solana wallet to stake <strong>devnet test SOL</strong>. Every stake needs your approval. Invite a friend after your deposit confirms.</p>{walletOptions.length ? walletOptions.map((option) => <button className="wallet-option" key={option.name} onClick={() => connectWallet(option)} disabled={!!busy}><Wallet size={18} />{option.name}<span>Connect <ArrowRight size={14} /></span></button>) : <><p className="service-notice">No Solana wallet was detected in this browser.</p><a className="wallet-option" href="https://phantom.com/download" target="_blank" rel="noreferrer">Get Phantom <ExternalLink size={15} /></a><a className="wallet-option" href="https://www.solflare.com/" target="_blank" rel="noreferrer">Get Solflare <ExternalLink size={15} /></a><button className="retro-button wide" onClick={() => setWalletOptions(installedWallets())}>Check for wallets again</button></>}{error && <p className="error-text">{error}</p>}</> : dialog === "rules" ? <><p className="modal-kicker">TWO FRIENDS. ONE REAL PLACE. THIRTY SECONDS.</p><div className="rule-step"><b>01</b><div><h3>Make room for a little rivalry.</h3><p>Connect on Solana devnet, choose your test SOL stake, create a room and send its code to your friend. Your friend approves an equal deposit.</p></div></div><div className="rule-step"><b>02</b><div><h3>Get lost together.</h3><p>You see the same random 360° real location. Drag to look around. Drop your pin on the world map and lock it before the 30-second timer ends. A wallet message locks your duel guess.</p></div></div><div className="rule-step"><b>03</b><div><h3>Closest takes the pot.</h3><p>Great-circle distance decides the winner. Distances round to the nearest metre; an equal score returns each stake. One accepted guess wins if the other player misses. Neither guesses? Both stakes return.</p></div></div><div className="rules-details"><p><ShieldCheck size={15} /><strong>0% house fee.</strong> Two 0.001 SOL stakes make a 0.002 SOL pot. Network fees and refundable account storage are separate.</p><p><Clock3 size={15} />Cancel while waiting for a friend. Expired rooms have an on-chain refund route. A trusted game referee selects locations and calculates scores; the Solana program guards the escrow.</p><p><Globe2 size={15} />Curated real places, with Panoramax street imagery and a Natural Earth map.</p></div><button className="primary-button wide" onClick={() => setDialog(null)}>Got it. Let’s get lost. <ArrowRight size={17} /></button></> : dialog === "scores" ? <><div className="journal-heading"><Trophy size={34} /><div><span>PERSONAL BEST</span><h2>{distanceLabel(best) === "No guess" ? "Your story starts here." : distanceLabel(best)}</h2></div></div><p>{history.length} rounds on this browser. Each new location is a new adventure.</p>{history.length ? <div className="history-list">{history.map((item) => <div key={item.id}><span>{item.won ? "Duel won" : "Friend duel"}<small>{new Date(item.time).toLocaleDateString()}</small></span><strong>{distanceLabel(item.distance)}</strong></div>)}</div> : <div className="empty-journal"><MapPin size={28} /><p>No pins in your journal yet.<br />Complete a friend duel to add your first score.</p></div>}<button className="primary-button wide" onClick={() => setDialog(null)}>Back to friend duel <ArrowRight size={17} /></button></> : <><div className="modal-illustration"><Globe2 size={38} /><Heart size={22} /></div><h2>geopump — Geo Duels</h2><p>geopump is a little multiplayer geography game for friends. Our desktop takes inspiration from the internet we grew up with.</p><p>This build runs on <strong>Solana devnet</strong>. All stakes use test SOL. The referee is trusted for scene selection and scoring. Paid status appears only after an on-chain receipt.</p><div className="about-links"><a href="https://panoramax.fr/" target="_blank" rel="noreferrer">Street imagery: Panoramax <ExternalLink size={12} /></a><a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">World map: Natural Earth <ExternalLink size={12} /></a>{config.programId && <a href={`https://explorer.solana.com/address/${config.programId}?cluster=devnet`} target="_blank" rel="noreferrer">View Solana program <ExternalLink size={12} /></a>}</div><button className="retro-button wide" onClick={() => setDialog(null)}>Back to my world</button></>}
    </div></div></div>}
  </main>;
}
