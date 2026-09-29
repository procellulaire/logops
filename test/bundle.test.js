"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const root = path.resolve(__dirname, "..");

test("standalone HTML is current and has no external runtime dependencies", () => {
  const check = spawnSync(process.execPath, [path.join(root, "tools", "build.js"), "--check"], {encoding: "utf8"});
  assert.equal(check.status, 0, check.stderr + check.stdout);
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /<!doctype html>/i);
  assert.doesNotMatch(html, /<script[^>]+\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link[^>]+rel=["']stylesheet["']/i);
  assert.doesNotMatch(html, /@import|\/\* LOGOPS_(?:STYLES|CORE|APP) \*\//);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 2);
  for (const [, script] of scripts) assert.doesNotThrow(() => new vm.Script(script));
  const context = vm.createContext({});
  vm.runInContext(scripts[0][1], context);
  assert.equal(vm.runInContext("LogOps.inspectConfig(LogOps.generateDeployment().config).engine", context), "syslog-ng");
});
