#!/usr/bin/env node
/**
 * Expands the hardened fleet API source if the working copy is missing/corrupt.
 * Safe to run repeatedly (idempotent).
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.join(__dirname, "..");
const target = path.join(root, "src/lib/fleet/api.ts");
const blobPath = path.join(root, "src/lib/fleet/api.ts.zlib.b64");

function needsRestore() {
  if (!fs.existsSync(target)) return true;
  const text = fs.readFileSync(target, "utf8");
  if (text.length < 1000) return true;
  if (text.includes("RESTORE_MARKER") || text.includes("PLACEHOLDER") || text.includes("RECOVER_FROM")) return true;
  if (!text.includes("export const setViewAs")) return true;
  if (!text.includes("fieldTargets")) return true;
  return false;
}

function restore() {
  if (!fs.existsSync(blobPath)) {
    console.error("[restore-api] missing", blobPath);
    process.exit(1);
  }
  const b64 = fs.readFileSync(blobPath, "utf8").trim();
  const buf = zlib.inflateSync(Buffer.from(b64, "base64"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  console.log("[restore-api] wrote", target, "(" + buf.length + " bytes)");
}

if (needsRestore()) restore();
else console.log("[restore-api] api.ts looks good, skip");
