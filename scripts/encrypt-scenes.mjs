import { createCipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const source = new URL("../lib/scene-data.server.json", import.meta.url);
const target = new URL("../lib/scene-data.server.enc.json", import.meta.url);
const keyPath = new URL("../.secrets/scene.key", import.meta.url);
const key = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const plain = await readFile(source);
const encrypted = Buffer.concat([cipher.update(gzipSync(plain, { level: 9 })), cipher.final()]);
await mkdir(new URL("../.secrets/", import.meta.url), { recursive: true });
await writeFile(keyPath, key.toString("hex"), { mode: 0o600 });
await writeFile(target, JSON.stringify({
  version: 1,
  compression: "gzip",
  iv: iv.toString("base64"),
  tag: cipher.getAuthTag().toString("base64"),
  ciphertext: encrypted.toString("base64"),
}));
console.log("Encrypted location catalog written. Keep .secrets/scene.key private and configure it as GEO_SCENE_SECRET.");
