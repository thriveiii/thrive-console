#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ORBIT = __dirname;
const PUBLISH = path.join(ROOT, "publish", "cap-orbit");
const manifest = JSON.parse(fs.readFileSync(path.join(ORBIT, "manifest.json"), "utf8"));

for (const route of manifest.routes) {
  const source = path.join(ORBIT, route.source);
  const target = path.join(PUBLISH, route.target);

  if (!fs.existsSync(source)) {
    throw new Error(`Capability Orbit source missing: ${route.source}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);

  const a = fs.readFileSync(source);
  const b = fs.readFileSync(target);
  if (!a.equals(b)) {
    throw new Error(`Capability Orbit byte-preservation check failed: ${route.id}`);
  }

  process.stdout.write(`Capability Orbit emitted ${route.id} -> ${route.target}\n`);
}
