"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, RotateCcw, MapPin, Move } from "lucide-react";

export type Coordinates = { latE6: number; lngE6: number };
type Geometry = { type: string; coordinates: number[][][] | number[][][][] };
type GeoJSON = { features: { geometry: Geometry }[] };
type MapPin = Coordinates & { color: string; label: string };

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
    const latitude = Number(lat), longitude = Number(lng);
    if (!lat.trim() || !lng.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      setCoordinateError("Latitude −90 to 90; longitude −180 to 180.");
      return;
    }
    setCoordinateError("");
    onChange({ latE6: Math.round(latitude * 1e6), lngE6: longitude === 180 ? -180000000 : Math.round(longitude * 1e6) });
    setCenter({ x: longitude + 180, y: 90 - latitude });
  }

  const allPins = value && !pins.length ? [{ ...value, color: "#f560a2", label: "Your guess" }] : pins;

  return <div className="map-content">
    <div className="world-map">
      <svg viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="World map. Click to place your guess, or enter coordinates below."
        onClick={(event) => {
          if (disabled) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const pointX = x + ((event.clientX - rect.left) / rect.width) * width;
          const pointY = y + ((event.clientY - rect.top) / rect.height) * height;
          if (pan) { setCenter({ x: pointX, y: pointY }); return; }
          onChange({ latE6: Math.round((90 - pointY) * 1e6), lngE6: Math.round((pointX - 180) * 1e6) });
        }} style={{ cursor: disabled ? "default" : pan ? "move" : "crosshair" }}>
        <rect width="360" height="180" fill="#bde2ef" />
        <g className="map-grid" stroke="#96cbdc" strokeWidth=".28">
          {Array.from({ length: 11 }, (_, i) => <line key={`x${i}`} x1={30 * (i + 1)} x2={30 * (i + 1)} y1="0" y2="180" />)}
          {Array.from({ length: 5 }, (_, i) => <line key={`y${i}`} x1="0" x2="360" y1={30 * (i + 1)} y2={30 * (i + 1)} />)}
        </g>
        <g fill="#ecedce" stroke="#78977c" strokeWidth=".35">{paths.map((path, i) => <path key={i} d={path} />)}</g>
        {allPins.map((pin) => <g key={pin.label} transform={`translate(${pin.lngE6 / 1e6 + 180},${90 - pin.latE6 / 1e6})`}>
          <circle r={4 / zoom} fill={pin.color} opacity=".22" />
          <circle r={1.9 / zoom} fill={pin.color} stroke="#263458" strokeWidth={.55 / zoom} />
          <circle r={.55 / zoom} fill="white" />
          <title>{pin.label}: {(pin.latE6 / 1e6).toFixed(4)}, {(pin.lngE6 / 1e6).toFixed(4)}</title>
        </g>)}
      </svg>
      <div className="map-tools">
        <button aria-label="Zoom in" title="Zoom in" onClick={() => { if (value) setCenter({ x: value.lngE6 / 1e6 + 180, y: 90 - value.latE6 / 1e6 }); setZoom(Math.min(8, zoom * 2)); }} disabled={zoom === 8}><Plus size={16} /></button>
        <button aria-label="Zoom out" title="Zoom out" onClick={() => setZoom(Math.max(1, zoom / 2))} disabled={zoom === 1}><Minus size={16} /></button>
        <button aria-label="Reset map" title="Reset map" onClick={() => { setZoom(1); setCenter({ x: 180, y: 90 }); setPan(false); }}><RotateCcw size={14} /></button>
        <button aria-label="Toggle map recenter mode" title={pan ? "Place a guess" : "Click to recenter map"} aria-pressed={pan} className={pan ? "selected" : ""} onClick={() => setPan(!pan)} disabled={disabled}><Move size={14} /></button>
      </div>
      {!value && !pins.length && <span className="map-instruction"><MapPin size={13} /> click anywhere to drop a pin</span>}
      <span className="map-scale">{zoom}× WORLD VIEW</span>
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
