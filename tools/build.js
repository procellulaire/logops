"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8").replace(/\r\n/g, "\n");
let html = read("web/template.html");
for (const [marker, file] of [
  ["/* LOGOPS_STYLES */", "web/styles.css"],
  ["/* LOGOPS_CORE */", "lib/logops.js"],
  ["/* LOGOPS_APP */", "web/app.js"]
]) {
  if (html.split(marker).length !== 2) throw new Error(`Expected exactly one ${marker} placeholder`);
  const source = read(file);
  if (/<\/(?:script|style)/i.test(source)) throw new Error(`Unsafe closing HTML tag in ${file}`);
  html = html.replace(marker, () => source);
}
const target = path.join(root, "index.html");
if (process.argv.includes("--check")) {
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== html) {
    console.error("index.html is out of date. Run npm run build.");
    process.exitCode = 1;
  } else console.log("Standalone index.html is current.");
} else {
  fs.writeFileSync(target, html);
  console.log("Built self-contained index.html");
}
