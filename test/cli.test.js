"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {gzipSync} = require("node:zlib");
const {loadEvents, csvCell} = require("../bin/logops.js");
const core = require("../lib/logops.js");
const script = path.resolve(__dirname, "..", "bin", "logops.js");
const cli = (...args) => spawnSync(process.execPath, [script, ...args], {encoding: "utf8"});
function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "logops-test-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}
test("CLI help and unknown options/commands", () => {
  assert.equal(cli("--help").status, 0);
  assert.match(cli("--help").stdout, /Windows/);
  assert.notEqual(cli("anything").status, 0);
  assert.match(cli("generate", "--shell-command", "anything").stderr, /Unknown option/);
  assert.match(cli("generate", "--port").stderr, /Missing value/);
});
test("CLI generation, exclusive file output, inspect and surgical edit", t => {
  const directory = temp(t);
  const generate = cli("generate", "--engine", "rsyslog", "--role", "server", "--out-dir", directory);
  assert.equal(generate.status, 0, generate.stderr);
  const configPath = path.join(directory, "candidate.conf");
  const original = fs.readFileSync(configPath, "utf8");
  const inspect = cli("inspect", configPath);
  assert.equal(inspect.status, 0, inspect.stderr);
  const report = JSON.parse(inspect.stdout);
  assert.equal(report.engine, "rsyslog");
  const port = report.settings.find(s => s.label === "port");
  const changed = path.join(directory, "changed.conf");
  const edit = cli("edit", configPath, "--set", `${port.id}=7514`, "--output", changed);
  assert.equal(edit.status, 0, edit.stderr);
  assert.equal(fs.readFileSync(changed, "utf8"), original.replace('port="6514"', 'port="7514"'));
  assert.equal(fs.readFileSync(configPath, "utf8"), original);
  assert.match(cli("generate", "--out-dir", directory).stderr, /exists/);
  assert.equal(fs.readFileSync(configPath, "utf8"), original);
});
test("CLI search handles gzip, JSON/CSV output, and malformed gzip/missing files", async t => {
  const directory = temp(t), plain = path.join(directory, "syslog"), zipped = path.join(directory, "second.log.gz");
  fs.writeFileSync(plain, '<34>Sep 28 12:00:00 h sshd[3]: Failed password\r\n{"host":"fw","message":"deny"}\n');
  fs.writeFileSync(zipped, gzipSync('<35>Sep 28 12:00:00 h sshd[3]: Failed password\n'));
  const result = cli("search", "app=sshd | stats count", plain, zipped);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).rows, [{count: 2}]);
  const csv = cli("search", "deny | fields host,message", plain, "--format", "csv");
  assert.equal(csv.stdout, '"host","message"\n"fw","deny"\n');
  await assert.rejects(loadEvents([path.join(directory, "missing.gz")]), /ENOENT/);
  fs.writeFileSync(zipped, "not a gzip");
  await assert.rejects(loadEvents([zipped]), /header|gzip/i);
  assert.notEqual(cli("search", "| invalid", plain).status, 0);
});
test("UTF-8 chunk handling, long-line limits and safe CSV cells", async t => {
  const directory = temp(t), file = path.join(directory, "utf8.log");
  fs.writeFileSync(file, "\uFEFF" + "x".repeat(65530) + "\u00e9\u00e9\u00e9\u00e9\nnext");
  const rows = await loadEvents([file]);
  assert.equal(rows.length, 2); assert.ok(rows[0].raw.endsWith("\u00e9\u00e9\u00e9\u00e9")); assert.equal(rows[0].raw[0], "x");
  assert.equal(csvCell("=SUM(A1)"), "\"'=SUM(A1)\"");
  assert.equal(csvCell("  =SUM(A1)"), "\"'  =SUM(A1)\"");
  fs.writeFileSync(file, "x".repeat(1024 * 1024 + 1));
  await assert.rejects(loadEvents([file]), /line exceeds/);
});
test("CLI maintenance and swatch export real artifacts, not applied operations", t => {
  const directory = temp(t);
  const result = cli("maintenance", "--compression", "none", "--out-dir", directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(directory, "backup.sh"), "utf8"), /set -euo pipefail/);
  const swatch = cli("swatch", "--pattern", "denied", "--throttle", "30");
  assert.equal(swatch.status, 0, swatch.stderr); assert.match(swatch.stdout, /seconds=30/);
  const bashPath = process.env.LOGOPS_BASH || "bash";
  const bash = spawnSync(bashPath, ["--version"], {encoding: "utf8"});
  if (!bash.error && bash.status === 0) {
    const syntax = spawnSync(bashPath, ["-n"], {input: core.generateMaintenance().backup, encoding: "utf8"});
    assert.equal(syntax.status, 0, syntax.stderr);
    const wrapper = spawnSync(bashPath, [path.resolve(__dirname, "..", "bin", "logops"), "--help"], {encoding: "utf8"});
    assert.equal(wrapper.status, 0, wrapper.stderr);
  } else t.diagnostic("Bash unavailable: native script execution must be confirmed on Linux/WSL.");
});
