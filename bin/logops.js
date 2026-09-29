#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {createGunzip} = require("node:zlib");
const {StringDecoder} = require("node:string_decoder");
const core = require("../lib/logops.js");

const help = `LogOps - offline syslog workbench console (Node.js 18+)
Linux: Bash + Node. Windows: WSL/Git Bash + Node, or node bin/logops.js.

  bash bin/logops inspect CONFIG
  bash bin/logops edit CONFIG --set setting-ID=VALUE --output FILE
  bash bin/logops generate --engine syslog-ng --role server --out-dir DIR
  bash bin/logops search 'QUERY' FILE... [--format json|csv|table]
  bash bin/logops swatch --pattern 'Failed password' [--pattern denied] --output FILE
  bash bin/logops maintenance --log-path /var/log/remote/network.log --out-dir DIR

Generate options (kebab-case): --engine, --role, --environment, --transport,
--bind, --port, --target, --target-port, --wire-format rfc3164|rfc5424,
--log-path, --queue-dir, --ca-file, --cert-file, --key-file, --peer-name,
--allowed-peer. Optional --profile JSON_FILE.
Maintenance: --log-path, --archive-dir, --rotate, --frequency, --max-size,
--compression gzip|compress|none, --engine.
Swatch: --pattern (repeatable literal phrase), --throttle SECONDS, --case-sensitive.
Outputs are exclusive-create by default. --force permits overwriting output files.
Search reads plain UTF-8 or .gz files; '-' means stdin. Default output: JSON.
Search limit: 50 MiB decoded UTF-8, 100,000 events, 1 MiB per line; narrow inputs
with native tools for larger datasets. No command deploys or executes artifacts.
`;
const fail = message => { throw new Error(message); };
function args(argv) {
  const options = Object.create(null), positional = [];
  const repeatable = ["set", "pattern"], flags = ["force", "case-sensitive"];
  let literal = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!literal && arg === "--") { literal = true; continue; }
    if (literal || !arg.startsWith("--")) { positional.push(arg); continue; }
    const equal = arg.indexOf("="), key = arg.slice(2, equal < 0 ? undefined : equal);
    let value;
    if (flags.includes(key)) {
      if (equal >= 0) fail(`--${key} is a flag and takes no value`);
      value = true;
    } else if (equal >= 0) value = arg.slice(equal + 1);
    else {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) fail(`Missing value for --${key}`);
      value = argv[++i];
    }
    if (repeatable.includes(key)) (options[key] ||= []).push(value);
    else {
      if (Object.hasOwn(options, key)) fail(`Duplicate --${key}`);
      options[key] = value;
    }
  }
  return {options, positional};
}
function allow(options, names) {
  for (const key of Object.keys(options)) if (!names.includes(key)) fail(`Unknown option --${key}`);
}
function readConfig(file) {
  if (fs.statSync(file).size > 5 * 1024 * 1024) fail("Config/profile exceeds 5 MiB limit");
  return fs.readFileSync(file, "utf8");
}
function profile(options, names) {
  let result = {};
  if (options.profile) {
    result = JSON.parse(readConfig(options.profile).replace(/^\uFEFF/, ""));
    if (!result || Array.isArray(result) || typeof result !== "object") fail("Profile must be a JSON object");
    const valid = names.map(n => n.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
    for (const key of Object.keys(result)) if (!valid.includes(key)) fail(`Unknown profile setting: ${key}`);
  }
  for (const key of names) if (Object.hasOwn(options, key))
    result[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = options[key];
  return result;
}
function output(file, text, force) {
  if (!file) { process.stdout.write(text); return; }
  fs.writeFileSync(file, text, {flag: force ? "w" : "wx", mode: 0o600});
  process.stderr.write(`Wrote ${file}\n`);
}
function bundle(directory, files, force) {
  if (!directory) fail("--out-dir is required");
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  if (!force) for (const name of Object.keys(files))
    if (fs.existsSync(path.join(directory, name))) fail(`Output exists: ${path.join(directory, name)} (use a new directory or --force)`);
  for (const [name, text] of Object.entries(files)) output(path.join(directory, name), text, force);
}
async function loadEvents(files) {
  const events = [];
  let bytes = 0, usedStdin = false;
  for (const file of files) {
    if (file === "-" && usedStdin) fail("stdin may only be specified once");
    if (file === "-") usedStdin = true;
    const input = file === "-" ? process.stdin : fs.createReadStream(file);
    const stream = /\.gz$/i.test(file) ? input.pipe(createGunzip()) : input;
    const propagate = error => stream.destroy(error);
    if (stream !== input) input.on("error", propagate);
    const decoder = new StringDecoder("utf8");
    let buffer = "", line = 0;
    const add = text => {
      line++;
      if (Buffer.byteLength(text, "utf8") > 1024 * 1024) fail(`${file}:${line}: line exceeds 1 MiB`);
      if (!text.length) return;
      if (events.length >= 100000) fail("Event limit exceeded (100,000); narrow input files");
      const normalized = text.replace(/\r$/, "");
      events.push(core.parseLog(line === 1 ? normalized.replace(/^\uFEFF/, "") : normalized, file, line));
    };
    try {
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > 50 * 1024 * 1024) fail("Decoded input limit exceeded (50 MiB); narrow input files");
        buffer += decoder.write(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const text of lines) add(text);
        if (Buffer.byteLength(buffer, "utf8") > 1024 * 1024) fail(`${file}:${line + 1}: line exceeds 1 MiB`);
      }
      buffer += decoder.end();
      if (buffer) add(buffer);
    } finally {
      if (stream !== input) { input.off("error", propagate); input.destroy(); }
      if (file !== "-") stream.destroy();
    }
  }
  return events;
}
const {csvCell} = core;
async function main(argv) {
  if (!argv.length || ["help", "--help", "-h"].includes(argv[0])) { process.stdout.write(help); return; }
  const command = argv.shift(), {options: o, positional: p} = args(argv);
  const deployNames = Object.keys(core.defaultProfile).map(key => key.replace(/[A-Z]/g, c => "-" + c.toLowerCase()));
  const maintenanceNames = ["log-path", "archive-dir", "rotate", "frequency", "max-size", "compression", "engine"];
  if (command === "inspect") {
    allow(o, []); if (p.length !== 1) fail("Use inspect CONFIG");
    output(null, JSON.stringify(core.inspectConfig(readConfig(p[0])), null, 2) + "\n");
  } else if (command === "edit") {
    allow(o, ["set", "output", "force"]);
    if (p.length !== 1 || !o.set || !o.output) fail("Use edit CONFIG --set setting-ID=VALUE --output FILE");
    const changes = Object.create(null);
    for (const entry of o.set) {
      const index = entry.indexOf("=");
      if (index < 1) fail("--set needs setting-ID=VALUE");
      changes[entry.slice(0, index)] = entry.slice(index + 1);
    }
    output(o.output, core.editConfig(readConfig(p[0]), changes), o.force);
  } else if (command === "generate") {
    allow(o, [...deployNames, "out-dir", "profile", "force"]);
    if (p.length) fail("Unexpected generate arguments");
    const result = core.generateDeployment(profile(o, deployNames));
    bundle(o["out-dir"], {"candidate.conf": result.config, "deployment.txt": result.notes.join("\n\n") + "\n\n" + result.commands}, o.force);
  } else if (command === "maintenance") {
    allow(o, [...maintenanceNames, "out-dir", "force"]);
    if (p.length) fail("Unexpected maintenance arguments");
    const result = core.generateMaintenance(profile(o, maintenanceNames));
    bundle(o["out-dir"], {"logops.logrotate": result.logrotate, "backup.sh": result.backup, "maintenance.txt": result.notes.join("\n\n") + "\n"}, o.force);
  } else if (command === "swatch") {
    allow(o, ["pattern", "throttle", "case-sensitive", "output", "force"]);
    if (p.length) fail("Unexpected swatch arguments");
    output(o.output, core.generateSwatch({patterns: o.pattern, throttle: o.throttle ?? 60, ignoreCase: !o["case-sensitive"]}), o.force);
  } else if (command === "search") {
    allow(o, ["format", "output", "force"]);
    if (p.length < 2) fail("Use search 'QUERY' FILE... (use '-' for stdin)");
    const format = o.format || "json";
    if (!["json", "csv", "table"].includes(format)) fail("Format must be json, csv or table");
    const result = core.searchLogs(await loadEvents(p.slice(1)), p[0]);
    let text;
    if (format === "json") text = JSON.stringify(result, null, 2) + "\n";
    else if (format === "csv") text = [result.columns.map(csvCell).join(","), ...result.rows.map(row => result.columns.map(key => csvCell(row[key])).join(","))].join("\n") + "\n";
    else {
      const clean = value => String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
      text = [result.columns.join("\t"), ...result.rows.map(row => result.columns.map(key => clean(row[key])).join("\t"))].join("\n") + "\n";
    }
    output(o.output, text, o.force);
    process.stderr.write(`${result.scanned} events scanned; ${result.matched} matched; ${result.total} output rows\n`);
  } else fail(`Unknown command: ${command}. Use --help.`);
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(`logops: ${error.message}`); process.exitCode = 1; });
module.exports = {main, loadEvents, csvCell};
