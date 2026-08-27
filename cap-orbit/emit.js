#!/usr/bin/env node

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ORBIT = __dirname;
const PUBLISH = path.join(ROOT, "publish", "cap-orbit");
const manifest = JSON.parse(fs.readFileSync(path.join(ORBIT, "manifest.json"), "utf8"));
const integrity = JSON.parse(fs.readFileSync(path.join(ORBIT, "integrity.json"), "utf8"));

for (const route of manifest.routes) {
  const source = path.join(ORBIT, route.source);
  const target = path.join(PUBLISH, route.target);
  const expected = integrity.files[route.source];

  if (!expected) {
    throw new Error(`Capability Orbit integrity record missing: ${route.source}`);
  }
  if (!fs.existsSync(source)) {
    throw new Error(`Capability Orbit source missing: ${route.source}`);
  }

  const sourceBytes = fs.readFileSync(source);
  const actualHash = crypto.createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceBytes.length !== expected.bytes || actualHash !== expected.sha256) {
    throw new Error(`Capability Orbit source changed: ${route.id}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);

  const targetBytes = fs.readFileSync(target);
  if (!sourceBytes.equals(targetBytes)) {
    throw new Error(`Capability Orbit byte-preservation check failed: ${route.id}`);
  }

  process.stdout.write(`Capability Orbit verified and emitted ${route.id} -> ${route.target}\n`);
}
