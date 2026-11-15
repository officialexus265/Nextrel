#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..");
const target = path.join(root, "src/lib/fleet/api.ts");
const blobPath = path.join(root, "src/lib/fleet/api.ts.zlib.b64");
const partsDir = path.join(root, "src/lib/fleet");
function loadBlob() {
  if (fs.existsSync(blobPath) && fs.statSync(blobPath).size > 100) {
    return fs.readFileSync(blobPath, "utf8").trim();
  }
  const parts = [];
  for (let i = 0; i < 20; i++) {
    const p = path.join(partsDir, `api.ts.zlib.b64.part${i}`);
    if (!fs.existsSync(p)) break;
    parts.push(fs.readFileSync(p, "utf8").trim());
  }
  if (!parts.length) { console.error("[restore-api] missing blob or parts"); process.exit(1); }
  const joined = parts.join("");
  fs.writeFileSync(blobPath, joined);
  return joined;
}
function needsRestore() {
  if (!fs.existsSync(target)) return true;
  const text = fs.readFileSync(target, "utf8");
  if (text.length < 1000) return true;
  if (/PLACEHOLDER|RESTORE_MARKER|RECOVER_FROM/.test(text)) return true;
  if (!text.includes("export const setViewAs")) return true;
  if (!text.includes("fieldTargets")) return true;
  return false;
}
function restore() {
  const b64 = loadBlob();
  const buf = zlib.inflateSync(Buffer.from(b64, "base64"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  console.log("[restore-api] wrote", target, "(" + buf.length + " bytes)");
}
if (needsRestore()) restore();
else console.log("[restore-api] api.ts looks good, skip");
