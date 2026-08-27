#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const ORBIT = __dirname;
const PUBLISH_ROOT = path.join(ROOT, "publish");
const PUBLISH_ORBIT = path.join(PUBLISH_ROOT, "cap-orbit");
const manifest = JSON.parse(fs.readFileSync(path.join(ORBIT, "manifest.json"), "utf8"));
const integrity = JSON.parse(fs.readFileSync(path.join(ORBIT, "integrity.json"), "utf8"));

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

for (const route of manifest.routes) {
  const source = path.join(ORBIT, route.source);
  const target = path.join(PUBLISH_ORBIT, route.target);
  const expected = integrity.files[route.source];

  if (!expected) throw new Error(`Capability Orbit integrity entry missing: ${route.source}`);
  if (!fs.existsSync(source)) throw new Error(`Capability Orbit source missing: ${route.source}`);

  const sourceBytes = fs.readFileSync(source);
  if (sourceBytes.length !== expected.bytes) {
    throw new Error(`Capability Orbit byte count mismatch: ${route.id}`);
  }
  if (sha256(sourceBytes) !== expected.sha256) {
    throw new Error(`Capability Orbit SHA-256 mismatch: ${route.id}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, sourceBytes);

  const emittedBytes = fs.readFileSync(target);
  if (!sourceBytes.equals(emittedBytes)) {
    throw new Error(`Capability Orbit byte-preservation check failed: ${route.id}`);
  }

  process.stdout.write(`Capability Orbit verified and emitted ${route.id} -> ${route.target}\n`);
}

const redirectsPath = path.join(PUBLISH_ROOT, "_redirects");
const existingRedirects = fs.existsSync(redirectsPath) ? fs.readFileSync(redirectsPath, "utf8") : "";
const orbitRedirects = manifest.routes
  .map(route => `https://${route.host}/* /cap-orbit/${route.id}/index.html 200!`)
  .join("\n");
fs.writeFileSync(redirectsPath, `${orbitRedirects}\n${existingRedirects}`);

const headersPath = path.join(PUBLISH_ROOT, "_headers");
const existingHeaders = fs.existsSync(headersPath) ? fs.readFileSync(headersPath, "utf8") : "";
const orbitHeaders = [
  "/cap-orbit/*",
  "  Cache-Control: no-store, max-age=0",
  "  X-Robots-Tag: noindex, nofollow, noarchive",
  "  X-Content-Type-Options: nosniff"
].join("\n");
fs.writeFileSync(headersPath, `${existingHeaders.trimEnd()}\n\n${orbitHeaders}\n`);

process.stdout.write("Capability Orbit host rewrites and isolation headers installed\n");
