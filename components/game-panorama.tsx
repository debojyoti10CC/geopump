"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus, RotateCcw, Move, ImageOff } from "lucide-react";

type Viewer = { destroy(): void; getHfov(): number; setHfov(value: number): void; setYaw(value: number): void; setPitch(value: number): void; on(name: string, callback: () => void): void };
type PanoramaWindow = Window & { pannellum?: { viewer(element: HTMLElement, config: object): Viewer } };
let loading: Promise<void> | null = null;

function loadViewer() {
  if ((window as PanoramaWindow).pannellum) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!document.querySelector("link[data-panorama-css]")) {
      const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "/vendor/pannellum.css"; style.dataset.panoramaCss = "true"; document.head.appendChild(style);
    }
    const script = document.createElement("script"); script.src = "/vendor/pannellum.js";
    script.onload = () => resolve(); script.onerror = () => { loading = null; reject(new Error("Panorama viewer unavailable.")); };
    document.head.appendChild(script);
  });
  return loading;
}

export default function GamePanorama({ src, active, caption, label }: { src: string | null; active: boolean; caption?: string; label?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    setReady(false); setFailed(false);
    if (!src) return;
    loadViewer().then(() => {
      if (cancelled || !container.current) return;
      viewer.current = (window as PanoramaWindow).pannellum!.viewer(container.current, {
        type: "equirectangular", panorama: src, autoLoad: true, showControls: false, showFullscreenCtrl: false,
        showZoomCtrl: false, compass: false, hfov: 100, minHfov: 40, maxHfov: 110,
        mouseZoom: false, keyboardZoom: false, autoRotate: active ? 0 : -1,
        strings: { loadingLabel: "Connecting to somewhere…" },
      });
      viewer.current.on("load", () => { if (!cancelled) setReady(true); });
      viewer.current.on("error", () => { if (!cancelled) setFailed(true); });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; viewer.current?.destroy(); viewer.current = null; };
  }, [src, active]);

  return <div className="panorama" ref={frame}>
    <div className="panorama-renderer" ref={container} />
    {!ready && !failed && <div className="scene-loading"><span className="loading-globe">◎</span><span>{src ? "Connecting to somewhere…" : "Your next adventure is loading…"}</span></div>}
    {failed && <div className="scene-loading"><ImageOff size={30} /><span>The 360° viewer couldn’t load.</span><button onClick={() => { setFailed(false); setNotice("Please refresh the page or try another browser with WebGL support."); }}>Troubleshoot</button>{notice && <small>{notice}</small>}</div>}
    <span className="scene-label"><span className="live-dot" />{label || (active ? "LIVE LOCATION · ANSWER HIDDEN" : "SCENE PREVIEW · START A FRIEND DUEL")}</span>
    <span className="drag-hint"><Move size={13} />{caption || "drag to look around"}</span>
    <div className="scene-tools">
      <button aria-label="Zoom into scene" title="Zoom in" disabled={!ready} onClick={() => viewer.current?.setHfov(Math.max(40, viewer.current.getHfov() - 15))}><Plus size={16} /></button>
      <button aria-label="Zoom out of scene" title="Zoom out" disabled={!ready} onClick={() => viewer.current?.setHfov(Math.min(110, viewer.current.getHfov() + 15))}><Minus size={16} /></button>
      <button aria-label="Reset scene direction" title="Reset direction" disabled={!ready} onClick={() => { viewer.current?.setYaw(0); viewer.current?.setPitch(0); viewer.current?.setHfov(100); }}><RotateCcw size={14} /></button>
      <button aria-label="View scene fullscreen" title="Fullscreen" onClick={async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await frame.current?.requestFullscreen(); } catch { setNotice("Fullscreen is unavailable in this browser. The scene still works here."); } }}><Maximize size={15} /></button>
    </div>
    {notice && !failed && <div className="scene-notice" role="status">{notice}<button aria-label="Dismiss scene notice" onClick={() => setNotice("")}>×</button></div>}
  </div>;
}
