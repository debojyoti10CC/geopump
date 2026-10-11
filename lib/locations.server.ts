// Server-only location catalog. The public source contains ciphertext only;
// GEO_SCENE_SECRET lives in the hosting provider's secret store.
import { env } from "cloudflare:workers";
import encrypted from "./scene-data.server.enc.json";

export interface Location {
  id: string;
  latE6: number;
  lngE6: number;
  label: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  assetDigest: string;
}
type Scene = Location & { data: string };
type EncryptedCatalog = { version: number; compression: string; iv: string; tag: string; ciphertext: string };
const envelope = encrypted as EncryptedCatalog;
let catalog: Promise<Scene[]> | undefined;

function decodeBase64(value: string): Uint8Array {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function scenes(): Promise<Scene[]> {
  if (!catalog) {
    catalog = (async () => {
      if (envelope.version !== 1 || envelope.compression !== "gzip") throw new Error("Unsupported location catalog.");
      const secret = (env as unknown as { GEO_SCENE_SECRET?: string }).GEO_SCENE_SECRET;
      if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) throw new Error("Location catalog secret is not configured.");
      const keyBytes = Uint8Array.from(secret.match(/.{2}/g)!, (byte) => parseInt(byte, 16));
      const key = await crypto.subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, { name: "AES-GCM" }, false, ["decrypt"]);
      const ciphertext = decodeBase64(envelope.ciphertext);
      const tag = decodeBase64(envelope.tag);
      const sealed = new Uint8Array(ciphertext.length + tag.length);
      sealed.set(ciphertext);
      sealed.set(tag, ciphertext.length);
      const iv = decodeBase64(envelope.iv);
      const compressed = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, key, sealed.buffer as ArrayBuffer);
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
      const rows = JSON.parse(await new Response(stream).text()) as Scene[];
      if (!Array.isArray(rows) || rows.length < 2 || rows.some((row) => !Number.isInteger(row.latE6) || !Number.isInteger(row.lngE6) || !row.id || !row.data)) {
        throw new Error("Location catalog integrity check failed.");
      }
      return rows;
    })();
  }
  return catalog;
}

function metadata(scene: Scene): Location {
  const { data: _bytes, ...record } = scene;
  return record;
}

export async function getLocation(id: string): Promise<Location> {
  const scene = (await scenes()).find((item) => item.id === id);
  if (!scene) throw new Error("Scene not found");
  return metadata(scene);
}

export async function getPreviewLocation(): Promise<Location> {
  return metadata((await scenes())[0]);
}

export async function pickLocation(excludeId?: string): Promise<Location> {
  const all = await scenes();
  // Keep the publicly visible welcome scene out of competitive rounds.
  let pool = all.slice(1).filter((item) => item.id !== excludeId);
  if (!pool.length) pool = all.slice(1);
  const bound = Math.floor(0x100000000 / pool.length) * pool.length;
  const random = new Uint32Array(1);
  do { crypto.getRandomValues(random); } while (random[0] >= bound);
  return metadata(pool[random[0] % pool.length]);
}

export async function getSceneAsset(id: string): Promise<Response> {
  const scene = (await scenes()).find((item) => item.id === id);
  if (!scene) return new Response("Scene not found", { status: 404 });
  const bytes = decodeBase64(scene.data);
  return new Response(bytes.buffer as ArrayBuffer, { headers: {
    "Content-Type": "image/jpeg", "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline",
  } });
}

export async function sceneCount(): Promise<number> { return (await scenes()).length - 1; }
