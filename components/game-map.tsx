"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Minus, Plus, RotateCcw, MapPin, Move } from "lucide-react";

export type Coordinates = { latE6: number; lngE6: number };
type Geometry = { type: string; coordinates: number[][][] | number[][][][] };
type GeoJSON = { features: { geometry: Geometry }[] };
type MapPin = Coordinates & { color: string; label: string };
type MapPoint = { x: number; y: number };
type MapGesture = {
  pointerId: number;
  clientX: number;
  clientY: number;
  center: MapPoint;
  inverse: DOMMatrix;
  moved: boolean;
  canPan: boolean;
};

export function clampMapCenter(point: MapPoint, zoom: number): MapPoint {
  const halfWidth = 180 / zoom, halfHeight = 90 / zoom;
  return { x: Math.max(halfWidth, Math.min(360 - halfWidth, point.x)), y: Math.max(halfHeight, Math.min(180 - halfHeight, point.y)) };
}

export function resultConnectionPaths(guess: Coordinates, target: Coordinates): string[] {
  const from = { x: guess.lngE6 / 1e6 + 180, y: 90 - guess.latE6 / 1e6 };
  const to = { x: target.lngE6 / 1e6 + 180, y: 90 - target.latE6 / 1e6 };
  if (to.x - from.x > 180) to.x -= 360;
  else if (to.x - from.x < -180) to.x += 360;
  return [-360, 0, 360].map((shift) => `M${from.x + shift},${from.y} L${to.x + shift},${to.y}`);
}

function mapPoint(svg: SVGSVGElement, clientX: number, clientY: number): MapPoint | null {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = svg.createSVGPoint();
  point.x = clientX; point.y = clientY;
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

function polygonPath(points: number[][]): string {
  return points.map(([lng, lat], index) => `${index === 0 ? "M" : "L"}${(lng + 180).toFixed(2)},${(90 - lat).toFixed(2)}`).join(" ") + " Z";
}

export default function GameMap({ value, onChange, disabled, pins = [] }: {
  value: Coordinates | null;
  onChange: (point: Coordinates) => void;
  disabled?: boolean;
  pins?: MapPin[];
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 180, y: 90 });
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [coordinateError, setCoordinateError] = useState("");
  const [pan, setPan] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<MapGesture | null>(null);
  const width = 360 / zoom;
  const height = 180 / zoom;
  const x = Math.max(0, Math.min(360 - width, center.x - width / 2));
  const y = Math.max(0, Math.min(180 - height, center.y - height / 2));

  useEffect(() => {
    let active = true;
    fetch("/world.json").then((response) => response.json()).then((raw) => {
      const data = raw as GeoJSON;
      const result: string[] = [];
      for (const feature of data.features || []) {
        const geometry = feature.geometry;
        if (!geometry) continue;
        const polygons = geometry.type === "Polygon" ? [geometry.coordinates as number[][][]] : geometry.coordinates as number[][][][];
        for (const polygon of polygons) result.push(polygon.map(polygonPath).join(" "));
      }
      if (active) setPaths(result);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!value) return;
    setLat((value.latE6 / 1e6).toFixed(4));
    setLng((value.lngE6 / 1e6).toFixed(4));
  }, [value]);

  function enterCoordinates() {
    if (disabled) return;
    const latitude = Number(lat), longitude = Number(lng);
    if (!lat.trim() || !lng.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      setCoordinateError("Latitude −90 to 90; longitude −180 to 180.");
      return;
    }
    setCoordinateError("");
    onChange({ latE6: Math.round(latitude * 1e6), lngE6: longitude === 180 ? -180000000 : Math.round(longitude * 1e6) });
    setCenter(clampMapCenter({ x: longitude + 180, y: 90 - latitude }, zoom));
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    gesture.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, center: { x: x + width / 2, y: y + height / 2 }, inverse: matrix.inverse(), moved: false, canPan: zoom > 1 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.clientX, dy = event.clientY - current.clientY;
    if (!current.moved && Math.hypot(dx, dy) < 6) return;
    current.moved = true;
    if (!current.canPan) return;
    event.preventDefault();
    setDragging(true);
    const worldDx = current.inverse.a * dx + current.inverse.c * dy;
    const worldDy = current.inverse.b * dx + current.inverse.d * dy;
    setCenter(clampMapCenter({ x: current.center.x - worldDx, y: current.center.y - worldDy }, zoom));
  }

  function finishPointer(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const moved = current.moved || Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) >= 6;
    if (cancelled || moved) return;
    const point = mapPoint(event.currentTarget, event.clientX, event.clientY);
    if (!point || point.x < x || point.x > x + width || point.y < y || point.y > y + height) return;
    if (pan && zoom > 1) { setCenter(clampMapCenter(point, zoom)); return; }
    if (disabled) return;
    const latE6 = Math.round((90 - point.y) * 1e6);
    const lngE6 = Math.round((point.x - 180) * 1e6);
    onChange({ latE6, lngE6: lngE6 === 180000000 ? -180000000 : lngE6 });
  }

  function changeZoom(next: number) {
    const point = zoom === 1 && next > 1 && value ? { x: value.lngE6 / 1e6 + 180, y: 90 - value.latE6 / 1e6 } : { x: x + width / 2, y: y + height / 2 };
    setZoom(next);
    setCenter(clampMapCenter(point, next));
    if (next === 1) setPan(false);
  }

  const allPins = value && !pins.length ? [{ ...value, color: "#f560a2", label: "Your guess" }] : pins;
  // This pin is supplied by the game only after the signed round result is revealed.
  const revealedTarget = pins.find((pin) => pin.label === "Actual location");

  return <div className="map-content">
    <div className="world-map">
      <svg viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="World map. Click to place a guess. When zoomed, drag to move the map. Coordinates can also be entered below."
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, true)} onLostPointerCapture={(event) => finishPointer(event, true)}
        style={{ touchAction: zoom > 1 ? "none" : "pan-y", userSelect: "none", cursor: dragging ? "grabbing" : zoom > 1 && (pan || disabled) ? "grab" : disabled ? "default" : "crosshair" }}>
        <rect width="360" height="180" fill="#bde2ef" />
        <g className="map-grid" stroke="#96cbdc" strokeWidth=".28">
          {Array.from({ length: 11 }, (_, i) => <line key={`x${i}`} x1={30 * (i + 1)} x2={30 * (i + 1)} y1="0" y2="180" />)}
          {Array.from({ length: 5 }, (_, i) => <line key={`y${i}`} x1="0" x2="360" y1={30 * (i + 1)} y2={30 * (i + 1)} />)}
        </g>
        <g fill="#ecedce" stroke="#78977c" strokeWidth=".35">{paths.map((path, i) => <path key={i} d={path} />)}</g>
        {revealedTarget && <g fill="none" pointerEvents="none">{pins.filter((pin) => pin !== revealedTarget).map((pin) => <g key={`connection-${pin.label}`}>
          <title>{pin.label} to actual location</title>
          {resultConnectionPaths(pin, revealedTarget).map((path, index) => <path key={index} d={path} stroke={pin.color} strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />)}
        </g>)}</g>}
        {allPins.map((pin) => <g key={pin.label} transform={`translate(${pin.lngE6 / 1e6 + 180},${90 - pin.latE6 / 1e6})`}>
          <circle r={4 / zoom} fill={pin.color} opacity=".22" />
          <circle r={1.9 / zoom} fill={pin.color} stroke="#263458" strokeWidth={.55 / zoom} />
          <circle r={.55 / zoom} fill="white" />
          <title>{pin.label}: {(pin.latE6 / 1e6).toFixed(4)}, {(pin.lngE6 / 1e6).toFixed(4)}</title>
        </g>)}
      </svg>
      <div className="map-tools">
        <button aria-label="Zoom in" title="Zoom in" onClick={() => changeZoom(Math.min(8, zoom * 2))} disabled={zoom === 8}><Plus size={16} /></button>
        <button aria-label="Zoom out" title="Zoom out" onClick={() => changeZoom(Math.max(1, zoom / 2))} disabled={zoom === 1}><Minus size={16} /></button>
        <button aria-label="Reset map" title="Reset map" onClick={() => { setZoom(1); setCenter({ x: 180, y: 90 }); setPan(false); }}><RotateCcw size={14} /></button>
        <button aria-label="Toggle pan mode" title={pan ? "Return to guessing; dragging still pans" : "Pan mode: drag to move, click to recenter"} aria-pressed={pan} className={pan ? "selected" : ""} onClick={() => setPan(!pan)} disabled={zoom === 1}><Move size={14} /></button>
      </div>
      {!value && !pins.length && <span className="map-instruction"><MapPin size={13} /> click anywhere to drop a pin</span>}
      <span className="map-scale">{zoom}× WORLD VIEW{zoom > 1 ? " · DRAG TO MOVE" : ""}</span>
    </div>
    <div className="map-footer">
      <span className="map-point"><span className="pin-dot" />{value ? `${(value.latE6 / 1e6).toFixed(2)}°, ${(value.lngE6 / 1e6).toFixed(2)}°` : "No pin placed yet"}</span>
      <details className="coordinate-details"><summary>Enter coordinates</summary><form onSubmit={(event) => { event.preventDefault(); enterCoordinates(); }}>
        <label>Latitude<input aria-label="Latitude" type="number" min="-90" max="90" step="any" value={lat} onChange={(e) => setLat(e.target.value)} disabled={disabled} /></label>
        <label>Longitude<input aria-label="Longitude" type="number" min="-180" max="180" step="any" value={lng} onChange={(e) => setLng(e.target.value)} disabled={disabled} /></label>
        <button type="submit" disabled={disabled}>Set pin</button>{coordinateError && <p className="error-text">{coordinateError}</p>}
      </form></details>
    </div>
  </div>;
}
