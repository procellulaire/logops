/* Shared by the standalone HTML workbench and the Node/Bash console. */
"use strict";
const LogOps = (() => {
  const severities = ["emerg", "alert", "crit", "err", "warning", "notice", "info", "debug"];
  const facilities = ["kern", "user", "mail", "daemon", "auth", "syslog", "lpr", "news", "uucp", "cron", "authpriv", "ftp", "ntp", "audit", "alert", "clock", "local0", "local1", "local2", "local3", "local4", "local5", "local6", "local7"];
  const defaultProfile = Object.freeze({
    engine: "syslog-ng", role: "server", environment: "on-prem", transport: "tls", wireFormat: "rfc3164",
    bind: "127.0.0.1", port: 6514, target: "logs.example.net", targetPort: 6514,
    logPath: "/var/log/remote/network.log", queueDir: "/var/lib/logops",
    caFile: "/etc/ssl/certs/logops-ca.pem", certFile: "/etc/ssl/certs/logops.pem",
    keyFile: "/etc/ssl/private/logops.key", peerName: "logs.example.net", allowedPeer: "device.example.net"
  });
  function fail(message) { throw new Error(message); }
  function choice(value, values, label) {
    if (!values.includes(value)) fail(`${label} must be one of: ${values.join(", ")}`);
    return value;
  }
  function integer(value, min, max, label) {
    if (!/^\d+$/.test(String(value)) || Number(value) < min || Number(value) > max)
      fail(`${label} must be an integer from ${min} to ${max}`);
    return Number(value);
  }
  function host(value, label) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_.:%-]+$/.test(value) || value.length > 253)
      fail(`${label} must be a host name or IP address (without brackets)`);
    return value;
  }
  function path(value, label) {
    if (typeof value !== "string" || !/^\/[a-zA-Z0-9_./-]+$/.test(value) || value.includes("..") || value.endsWith("/"))
      fail(`${label} must be an absolute Linux file/directory path using letters, digits, _, -, . and /; no ..`);
    return value;
  }
  const quote = value => JSON.stringify(String(value));
  const shellQuote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";

  // Token positions allow edits without reserializing or discarding unknown directives.
  function configTokens(text) {
    const tokens = [];
    for (let i = 0; i < text.length;) {
      if (/\s/.test(text[i])) { i++; continue; }
      if (text[i] === "#" || text.slice(i, i + 2) === "//") {
        while (i < text.length && text[i] !== "\n") i++;
        continue;
      }
      if (text.slice(i, i + 2) === "/*") {
        const end = text.indexOf("*/", i + 2);
        if (end < 0) fail("Unterminated configuration comment");
        i = end + 2; continue;
      }
      const start = i;
      if (text[i] === '"' || text[i] === "'") {
        const delimiter = text[i++];
        let value = "";
        while (i < text.length && text[i] !== delimiter) {
          if (text[i] === "\\") {
            if (i + 1 >= text.length) fail("Unterminated configuration escape");
            value += text.slice(i, i + 2); i += 2;
          } else value += text[i++];
        }
        if (i >= text.length) fail("Unterminated configuration string");
        i++;
        tokens.push({type: "string", value, start: start + 1, end: i - 1});
      } else if (/[a-zA-Z0-9_$@.-]/.test(text[i])) {
        while (i < text.length && /[a-zA-Z0-9_$@.:%-]/.test(text[i])) i++;
        tokens.push({type: "word", value: text.slice(start, i), start, end: i});
      } else {
        i++;
        tokens.push({type: "symbol", value: text[start], start, end: i});
      }
    }
    return tokens;
  }
  function inspectConfig(text) {
    if (typeof text !== "string") fail("Configuration must be text");
    const tokens = configTokens(text);
    const words = tokens.filter(t => t.type === "word").map(t => t.value.toLowerCase());
    const ng = words.some(w => ["@version:", "@include", "source", "destination", "log", "options"].includes(w))
      && tokens.some(t => t.value === "{" || t.value === "@version:");
    const rs = words.some(w => ["module", "input", "action", "ruleset", "global", "$modload", "$inputtcpserverrun", "$udpserverrun", "$workdirectory"].includes(w))
      || /^\s*(?:[a-z*][\w*,.!;-]*\.[\w*,.!;-]+\s+|\$[a-z])/im.test(text);
    const engine = ng && rs ? "mixed" : ng ? "syslog-ng" : rs ? "rsyslog" : "unknown";
    const settings = [];
    const add = (token, label, kind) => {
      // Escaped strings require daemon-specific decoding; leave them in the raw editor.
      if (token.value.includes("\\")) return;
      settings.push({id: `setting-${token.start}`, label, kind, value: token.value, start: token.start, end: token.end});
    };
    if (engine === "syslog-ng") {
      const args = {port: "port", ip: "host", transport: "protocol", file: "path",
        network: "host", syslog: "host", "ca-file": "path", "ca-dir": "path",
        "cert-file": "path", "key-file": "path", "log-fifo-size": "number",
        "flush-lines": "number", "time-reopen": "number"};
      for (let i = 0; i + 2 < tokens.length; i++) {
        const [name, open, value] = tokens.slice(i, i + 3);
        if (name.type === "word" && Object.hasOwn(args, name.value) && open.value === "(" &&
            ["word", "string"].includes(value.type) &&
            (["port", "number"].includes(args[name.value]) ? /^\d+$/.test(value.value) : value.type === "string") &&
            (args[name.value] !== "path" || value.value.startsWith("/"))) {
          add(value, name.value, args[name.value]);
        }
      }
    }
    if (engine === "rsyslog") {
      const attrs = {port: "port", address: "host", target: "host", file: "path",
        protocol: "protocol", workdirectory: "path", "queue.size": "number",
        "queue.filename": "text", "streamdriver.cafile": "path",
        "streamdriver.certfile": "path", "streamdriver.keyfile": "path",
        defaultnetstreamdrivercafile: "path", defaultnetstreamdrivercertfile: "path",
        defaultnetstreamdriverkeyfile: "path"};
      for (let i = 0; i + 2 < tokens.length; i++) {
        const [name, equals, value] = tokens.slice(i, i + 3);
        const key = name.value.toLowerCase();
        if (name.type === "word" && Object.hasOwn(attrs, key) && equals.value === "=" && ["string", "word"].includes(value.type))
          add(value, name.value, attrs[key]);
      }
      const legacy = /^\s*(\$(?:InputTCPServerRun|UDPServerRun|WorkDirectory|DefaultNetstreamDriverCAFile|DefaultNetstreamDriverCertFile|DefaultNetstreamDriverKeyFile))\s+([^\s#]+)(?=\s|$)/gim;
      let match;
      while ((match = legacy.exec(text))) {
        const start = match.index + match[0].lastIndexOf(match[2]);
        if (!tokens.some(t => t.start === start)) continue;
        add({value: match[2], start, end: start + match[2].length}, match[1], /Run$/i.test(match[1]) ? "port" : "path");
      }
    }
    const syntax = engine === "syslog-ng" ? "syslog-ng blocks" : engine === "rsyslog"
      ? (words.some(w => ["input", "action", "module", "ruleset"].includes(w)) ? "RainerScript / possibly mixed legacy" : "Legacy rsyslog / syslog.conf") : engine;
    const warnings = [
      "Best-effort syntax detection, not a daemon validator. Unknown directives and includes are preserved, not interpreted.",
      "Only recognized scalar settings are editable as fields. Use the raw editor for templates, filters, legacy selectors and vendor extensions.",
      "Validate the complete configuration on the target daemon/version before deployment; modules and include files are not bundled."
    ];
    if (engine === "unknown" || engine === "mixed") warnings.unshift("Ambiguous syntax: structured editing is disabled; raw editing remains available.");
    return {engine, syntax, settings: settings.sort((a, b) => a.start - b.start), warnings};
  }
  function editConfig(text, changes) {
    const report = inspectConfig(text);
    if (report.engine === "unknown" || report.engine === "mixed") fail("Cannot structurally edit unknown or mixed syntax");
    const edits = [];
    for (const [id, raw] of Object.entries(changes)) {
      const setting = report.settings.find(s => s.id === id);
      if (!setting) fail(`Unknown or stale setting: ${id}`);
      const value = String(raw);
      if (value === setting.value) continue;
      if (setting.kind === "port") integer(value, 1, 65535, setting.label);
      else if (setting.kind === "number") integer(value, 0, 2147483647, setting.label);
      else if (setting.kind === "path") path(value, setting.label);
      else if (setting.kind === "host") host(value, setting.label);
      else if (setting.kind === "protocol") choice(value, report.engine === "rsyslog" ? ["tcp", "udp"] : ["tcp", "udp", "tls"], setting.label);
      else if (!/^[a-zA-Z0-9_.-]+$/.test(value)) fail(`${setting.label} must be a simple identifier`);
      edits.push({...setting, value});
    }
    return edits.sort((a, b) => b.start - a.start).reduce((out, e) => out.slice(0, e.start) + e.value + out.slice(e.end), text);
  }
  function generateDeployment(input = {}) {
    const p = {...defaultProfile, ...input};
    choice(p.engine, ["syslog-ng", "rsyslog"], "Engine");
    choice(p.role, ["agent", "forwarder", "server"], "Role");
    choice(p.environment, ["on-prem", "azure", "aws", "other"], "Environment");
    choice(p.transport, ["tls", "tcp", "udp"], "Transport");
    choice(p.wireFormat, ["rfc3164", "rfc5424"], "Wire format");
    host(p.bind, "Listen address"); host(p.target, "Forwarding target");
    integer(p.port, 1, 65535, "Listen port"); integer(p.targetPort, 1, 65535, "Forwarding port");
    path(p.logPath, "Log path"); path(p.queueDir, "Queue directory");
    if (p.transport === "tls") {
      for (const key of ["caFile", "certFile", "keyFile"]) path(p[key], key);
      host(p.peerName, "TLS peer name");
      host(p.allowedPeer, "Allowed sender certificate");
    }
    const network = p.role !== "agent";
    const forwarding = p.role !== "server";
    const tls = p.transport === "tls";
    const lines = [`# LogOps candidate: ${p.role} / ${p.environment}. Review before deployment.`];
    const notes = [
      "Generated Linux baseline: syslog-ng OSE 3.38+ or rsyslog 8.x. Older/vendor builds may need manual changes.",
      "Treat this as a standalone candidate, not an extra include: merging into a distro config can duplicate sources/modules.",
      `Selected wire format: ${p.wireFormat.toUpperCase()}. syslog-ng uses a matching network()/syslog() driver; rsyslog listeners auto-detect standard formats. Verify framing with your devices.`,
      "Loopback binding is the safe default. For remote devices, select a private interface and restrict host/cloud firewalls to device subnets.",
      "No changes are applied by this workbench. Keep a copy of the working config and validate with the target daemon before reload."
    ];
    if (p.engine === "syslog-ng") {
      lines.push('@version: 3.38', '@include "scl.conf"', "", "options { keep-hostname(yes); chain-hostnames(no); };");
      const tlsSource = tls ? ` tls(ca-file(${quote(p.caFile)}) cert-file(${quote(p.certFile)}) key-file(${quote(p.keyFile)}) peer-verify(required-trusted))` : "";
      const driver = p.wireFormat === "rfc5424" ? "syslog" : "network";
      lines.push(network
        ? `source s_logops { ${driver}(ip(${quote(p.bind)}) ip-protocol(${p.bind.includes(":") ? 6 : 4}) port(${p.port}) transport(${quote(p.transport)})${tlsSource}); };`
        : "source s_logops { system(); internal(); };");
      const tlsDest = tls ? ` tls(ca-file(${quote(p.caFile)}) cert-file(${quote(p.certFile)}) key-file(${quote(p.keyFile)}) peer-verify(required-trusted))` : "";
      const destination = forwarding
        ? `${driver}(${quote(p.target)} ip-protocol(${p.target.includes(":") ? 6 : 4}) port(${p.targetPort}) transport(${quote(p.transport)})${tlsDest} disk-buffer(dir(${quote(p.queueDir)}) mem-buf-size(10485760) disk-buf-size(1073741824) reliable(yes)))`
        : `file(${quote(p.logPath)} create-dirs(yes) perm(0640))`;
      lines.push(`destination d_logops { ${destination}; };`, "log { source(s_logops); destination(d_logops); flags(flow-control); };");
      if (tls && forwarding) notes.push("syslog-ng verifies the destination certificate against the forwarding target name. Set target to the certificate DNS name; the separate peer-name field is rsyslog-only.");
      notes.push("syslog-ng address families are chosen independently: IPv6 literals use ip-protocol(6), other addresses use IPv4. For IPv6-only DNS names, edit ip-protocol(6) in the raw candidate.");
    } else {
      lines.push(`global(workDirectory=${quote(p.queueDir)}${tls ? ` DefaultNetstreamDriver="gtls" DefaultNetstreamDriverCAFile=${quote(p.caFile)} DefaultNetstreamDriverCertFile=${quote(p.certFile)} DefaultNetstreamDriverKeyFile=${quote(p.keyFile)}` : ""})`);
      if (network) {
        lines.push(p.transport === "udp" ? 'module(load="imudp")'
          : `module(load="imtcp"${tls ? ' StreamDriver.Name="gtls" StreamDriver.Mode="1" StreamDriver.AuthMode="x509/name" PermittedPeer="' + p.allowedPeer + '"' : ""})`);
      } else {
        lines.push('module(load="imuxsock")', "# Do not also load imjournal for the same messages without deduplication.");
      }
      const action = forwarding
        ? `action(type="omfwd" target=${quote(p.target)} port=${quote(p.targetPort)} protocol=${quote(p.transport === "udp" ? "udp" : "tcp")}${tls ? ` StreamDriver="gtls" StreamDriverMode="1" StreamDriverAuthMode="x509/name" StreamDriverPermittedPeers=${quote(p.peerName)}` : ""} template=${quote(p.wireFormat === "rfc5424" ? "RSYSLOG_SyslogProtocol23Format" : "RSYSLOG_TraditionalForwardFormat")}${p.wireFormat === "rfc5424" && p.transport !== "udp" ? ' TCP_Framing="octet-counted"' : ""} action.resumeRetryCount="-1" queue.type="LinkedList" queue.filename="logops-forward" queue.maxDiskSpace="1g" queue.saveOnShutdown="on")`
        : `action(type="omfile" file=${quote(p.logPath)} createDirs="on" fileCreateMode="0640")`;
      if (network) {
        lines.push(`ruleset(name="logops_ingest") {\n  ${action}\n}`,
          `input(type=${quote(p.transport === "udp" ? "imudp" : "imtcp")} address=${quote(p.bind)} port=${quote(p.port)} ruleset="logops_ingest")`);
      } else lines.push(action);
      if (tls) notes.push("Install the rsyslog GnuTLS module (commonly rsyslog-gnutls). Allowed sender identifies incoming certificate names; peer name identifies the destination certificate. For multiple permitted senders, edit PermittedPeer as an array.");
    }
    if (tls) notes.push("Mutual TLS is enabled: distribute a CA and signed certificates/private keys with correct SANs, permissions and expiry monitoring. Devices without TLS need an isolated relay.");
    else notes.push(`${p.transport.toUpperCase()} is unencrypted. Use only on trusted segmented networks or inside a VPN; UDP has no delivery acknowledgement or backpressure.`);
    if (p.environment === "azure") notes.push("Azure: run on a Linux VM, use a private NIC/VNet, and allow the selected port only from known device/VPN/ExpressRoute subnets in the NSG. This does not provision Azure resources or configure Azure Monitor/DCR ingestion.");
    if (p.environment === "aws") notes.push("AWS: run on a Linux EC2 instance and restrict security groups/NACLs to device subnets through private connectivity. This does not provision AWS resources or send to CloudWatch.");
    if (p.environment === "other") notes.push("Cloud: use a Linux VM/private network, source-restricted firewall rules and persistent storage. The generated daemon config is provider-neutral.");
    if (forwarding) notes.push("Provision persistent writable queue storage and monitor disk usage. Buffers are bounded and do not guarantee loss-free delivery under every failure.");
    const config = lines.join("\n") + "\n";
    const validator = p.engine === "syslog-ng" ? "syslog-ng --syntax-only --cfgfile" : "rsyslogd -N1 -f";
    const commands = `# Save the candidate as candidate.conf. Run on the intended Linux host.\n# Install the daemon and required modules through your distribution first.\n# Check includes, service user permissions, certificates and firewall rules.\nsudo ${validator} ./candidate.conf\n\n# Only after validation: manually merge/install into the distro's service config.\n# Do NOT run both syslog daemons against the same sockets/ports.\n# Use your distribution's documented reload/restart procedure.\n# Check service status and send test messages from every device class.\n`;
    return {config, notes, commands};
  }

  function parseLog(raw, file = "", line = 1) {
    const event = {timestamp: "", host: "", app: "", facility: "", facility_code: null,
      severity: "", severity_code: null, message: raw, raw, file, line, format: "text"};
    const priority = raw.match(/^<(\d{1,3})>/);
    if (priority && Number(priority[1]) <= 191) {
      event.facility_code = Math.floor(Number(priority[1]) / 8);
      event.severity_code = Number(priority[1]) % 8;
      event.facility = facilities[event.facility_code]; event.severity = severities[event.severity_code];
    }
    const modern = raw.match(/^(?:<\d{1,3}>)?1 (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/);
    const legacy = raw.match(/^(?:<\d{1,3}>)?([A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2}) ([^\s]+) (.*)$/);
    if (modern) {
      [, event.timestamp, event.host, event.app, event.pid, event.msgid] = modern;
      let rest = modern[6], i = 0;
      if (rest[0] === "-") i = 1;
      else while (rest[i] === "[") {
        let inString = false;
        i++;
        for (; i < rest.length; i++) {
          if (rest[i] === "\\" && inString) { i++; continue; }
          if (rest[i] === '"') inString = !inString;
          if (rest[i] === "]" && !inString) { i++; break; }
        }
      }
      event.structured_data = rest.slice(0, i);
      event.message = rest.slice(i).replace(/^ /, "");
      event.format = "RFC5424";
    } else if (legacy) {
      event.timestamp = legacy[1]; event.host = legacy[2]; event.message = legacy[3]; event.format = "RFC3164";
      const tag = event.message.match(/^([^:\s[]+)(?:\[(\d+)\])?:\s?(.*)$/);
      if (tag) { event.app = tag[1]; event.pid = tag[2] || ""; event.message = tag[3]; }
    } else if (/^\s*\{/.test(raw)) {
      let data;
      try { data = JSON.parse(raw); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      if (data && !Array.isArray(data) && typeof data === "object") {
        for (const [key, value] of Object.entries(data)) {
          if (!["raw", "file", "line", "format", "__proto__", "constructor", "prototype"].includes(key) &&
              (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
            Object.defineProperty(event, key, {value, writable: true, enumerable: true, configurable: true});
        }
        event.format = "JSON";
      }
    }
    const pairs = /(?:^|\s)([a-zA-Z_][\w.-]*)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
    let pair;
    while ((pair = pairs.exec(String(event.message)))) {
      if (!Object.hasOwn(event, pair[1]) && !["__proto__", "constructor", "prototype"].includes(pair[1]))
        Object.defineProperty(event, pair[1], {value: pair[2] ?? pair[3] ?? pair[4], enumerable: true});
    }
    return event;
  }
  function queryTokens(query) {
    const tokens = [];
    for (let i = 0; i < query.length;) {
      if (/\s/.test(query[i])) { i++; continue; }
      if ('()|,=<>!'.includes(query[i])) {
        let value = query[i++];
        if ("<>!=".includes(value) && query[i] === "=") value += query[i++];
        if (value === "!") fail("Use != or NOT");
        tokens.push({value, quoted: false}); continue;
      }
      if (query[i] === '"' || query[i] === "'") {
        const delimiter = query[i++]; let value = "";
        while (i < query.length && query[i] !== delimiter) {
          if (query[i] === "\\" && [delimiter, "\\"].includes(query[i + 1])) i++;
          value += query[i++];
        }
        if (i >= query.length) fail("Unterminated search phrase");
        i++; tokens.push({value, quoted: true}); continue;
      }
      const start = i;
      while (i < query.length && !/[\s()|,=<>!]/.test(query[i])) i++;
      tokens.push({value: query.slice(start, i), quoted: false});
    }
    return tokens;
  }
  const fieldName = value => {
    if (!/^[a-zA-Z_][\w.-]*$/.test(value) || ["__proto__", "prototype", "constructor"].includes(value)) fail(`Invalid field name: ${value}`);
    return value;
  };
  const scalar = (row, key) => Object.hasOwn(row, key) ? row[key] : "";
  function wildcard(value, pattern) {
    // Iterative glob matching avoids user-supplied regular expressions and regex backtracking.
    value = String(value).toLowerCase(); pattern = String(pattern).toLowerCase();
    let i = 0, j = 0, star = -1, saved = 0;
    while (i < value.length) {
      if (pattern[j] === "?" || pattern[j] === value[i]) { i++; j++; }
      else if (pattern[j] === "*") { star = j++; saved = i; }
      else if (star !== -1) { j = star + 1; i = ++saved; }
      else return false;
    }
    while (pattern[j] === "*") j++;
    return j === pattern.length;
  }
  function searchLogs(events, query = "") {
    if (query.length > 8192) fail("Query limit is 8192 characters");
    const tokens = queryTokens(query);
    let pos = 0, depth = 0;
    const is = value => tokens[pos] && !tokens[pos].quoted && tokens[pos].value.toUpperCase() === value;
    const take = () => tokens[pos++];
    function atom() {
      if (++depth > 64) fail("Search nesting limit is 64");
      let result;
      if (is("NOT")) { take(); const inner = atom(); result = row => !inner(row); }
      else if (is("(")) { take(); result = expression(); if (!is(")")) fail("Missing closing parenthesis"); take(); }
      else {
        const token = take();
        if (!token || (!token.quoted && ["AND", "OR", ")", "|", "=", "!=", ">", "<", ">=", "<=", ","].includes(token.value.toUpperCase()))) fail("Expected a search term");
        if (tokens[pos] && !tokens[pos].quoted && ["=", "!=", ">", "<", ">=", "<="].includes(tokens[pos].value)) {
          const field = fieldName(token.value), op = take().value, value = take();
          if (!value || (!value.quoted && ["|", "(", ")", ",", "AND", "OR", "NOT", "=", "!=", "<", ">", "<=", ">="].includes(value.value.toUpperCase()))) fail("Expected a field value");
          result = row => {
            if (op === "=" || op === "!=") {
              if (!Object.hasOwn(row, field)) return op === "!=";
              const matches = wildcard(scalar(row, field), value.value);
              return op === "=" ? matches : !matches;
            }
            let a = scalar(row, field), b = value.value;
            if (field === "severity") { a = severities.indexOf(String(a)); b = severities.indexOf(b); if (a < 0 || b < 0) return false; }
            else { if (a === "" || a === null || !Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return false; a = Number(a); b = Number(b); }
            return op === ">" ? a > b : op === "<" ? a < b : op === ">=" ? a >= b : a <= b;
          };
        } else result = row => wildcard(row.raw, `*${token.value}*`);
      }
      depth--; return result;
    }
    function conjunction() {
      const nodes = [atom()];
      while (pos < tokens.length && !is("OR") && !is(")") && !is("|")) {
        if (is("AND")) take();
        nodes.push(atom());
      }
      return row => nodes.every(node => node(row));
    }
    function expression() {
      const nodes = [conjunction()];
      while (is("OR")) { take(); nodes.push(conjunction()); }
      return row => nodes.some(node => node(row));
    }
    const predicate = !tokens.length || is("|") ? () => true : expression();
    if (pos < tokens.length && !is("|")) fail(`Unexpected search token: ${tokens[pos].value}`);
    let rows = events.filter(predicate);
    const matched = rows.length;
    let columns = ["timestamp", "host", "app", "severity", "message", "file", "line"];
    while (pos < tokens.length) {
      if (!is("|")) fail("Expected a pipeline separator");
      take();
      const stage = [];
      while (pos < tokens.length && !is("|")) stage.push(take().value);
      const command = (stage.shift() || "").toLowerCase();
      const fields = values => {
        const value = values.join(" ");
        if (!value || /(?:^|,)\s*(?:,|$)/.test(value)) fail("Expected field names");
        return value.split(/[\s,]+/).filter(Boolean).map(fieldName);
      };
      if (command === "stats") {
        if ((stage.shift() || "").toLowerCase() !== "count") fail("Supported aggregation: stats count [by field,...]");
        let keys = [];
        if (stage.length) {
          if (stage.shift().toLowerCase() !== "by") fail("Expected 'by' after stats count");
          keys = fields(stage);
        }
        if (keys.includes("count")) fail("Cannot group by reserved output field count");
        const groups = new Map();
        for (const row of rows) {
          const values = keys.map(key => scalar(row, key)), id = JSON.stringify(values);
          if (!groups.has(id)) groups.set(id, {...Object.fromEntries(keys.map((key, i) => [key, values[i]])), count: 0});
          groups.get(id).count++;
        }
        rows = keys.length === 0 ? [{count: rows.length}] : [...groups.values()];
        columns = [...keys, "count"];
      } else if (command === "top") {
        const limit = /^\d+$/.test(stage[0] || "") ? integer(stage.shift(), 1, 100000, "Top limit") : 10;
        if (stage.length !== 1) fail("Use top [N] field");
        const key = fieldName(stage[0]);
        if (["count", "percent"].includes(key)) fail("Cannot top reserved output field count or percent");
        const counts = new Map();
        rows.forEach(row => { const value = scalar(row, key); counts.set(value, (counts.get(value) || 0) + 1); });
        const total = rows.length;
        rows = [...counts].map(([value, count]) => ({[key]: value, count, percent: Number((count * 100 / total).toFixed(2))}))
          .sort((a, b) => b.count - a.count).slice(0, limit);
        columns = [key, "count", "percent"];
      } else if (command === "sort") {
        if (stage.length !== 1) fail("Use sort [-]field");
        const descending = stage[0].startsWith("-"), key = fieldName(stage[0].replace(/^[-+]/, ""));
        rows.sort((a, b) => {
          const av = scalar(a, key), bv = scalar(b, key);
          const compared = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
          return descending ? -compared : compared;
        });
      } else if (command === "head") {
        if (stage.length !== 1) fail("Use head N");
        rows = rows.slice(0, integer(stage[0], 0, 1000000, "Head limit"));
      } else if (command === "fields") {
        columns = fields(stage);
        rows = rows.map(row => Object.fromEntries(columns.map(key => [key, scalar(row, key)])));
      } else fail(`Unsupported pipeline command: ${command || "(empty)"}`);
    }
    return {rows, columns, total: rows.length, matched, scanned: events.length};
  }
  function generateSwatch({patterns = [], ignoreCase = true, throttle = 60} = {}) {
    integer(throttle, 0, 86400, "Throttle seconds");
    if (!Array.isArray(patterns) || !patterns.length) fail("Add at least one literal detection phrase");
    const escaped = patterns.map(p => {
      if (typeof p !== "string" || !p.trim() || /[\r\n\0]/.test(p) || p.length > 512) fail("Detection phrases must be nonempty single lines, up to 512 characters");
      return p.replace(/[\\^$@.*+?()[\]{}|/]/g, "\\$&");
    });
    return `# Literal phrases escaped for Perl; review before running swatchdog.\n# Alerts go to stdout.${Number(throttle) ? " One shared rate limit covers all phrases in this block." : " Rate limiting is disabled."}\nwatchfor /(?:${escaped.join("|")})/${ignoreCase ? "i" : ""}\n${Number(throttle) ? `    threshold track_by=logops,type=limit,count=1,seconds=${throttle}\n` : ""}    echo\n`;
  }
  function csvCell(value) {
    let text = String(value ?? "");
    // Prevent log text from becoming a spreadsheet formula when an export is opened.
    if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function generateMaintenance(input = {}) {
    const p = {logPath: defaultProfile.logPath, archiveDir: "/var/backups/logops", rotate: 14,
      frequency: "daily", maxSize: "100M", compression: "gzip", engine: "syslog-ng", ...input};
    path(p.logPath, "Log path"); path(p.archiveDir, "Archive directory");
    integer(p.rotate, 1, 3650, "Retention count");
    choice(p.frequency, ["daily", "weekly", "monthly"], "Rotation frequency");
    choice(p.compression, ["gzip", "compress", "none"], "Compression");
    choice(p.engine, ["syslog-ng", "rsyslog"], "Engine");
    if (!/^[1-9]\d{0,8}[kMG]?$/.test(p.maxSize)) fail("Maximum size must be a positive logrotate size such as 100M");
    const compress = p.compression === "none" ? "    nocompress" : p.compression === "gzip"
      ? "    compress\n    delaycompress\n    compresscmd /usr/bin/gzip\n    uncompresscmd /usr/bin/gunzip\n    compressext .gz\n    compressoptions -6" : "    compress\n    delaycompress\n    compresscmd /usr/bin/compress\n    uncompresscmd /usr/bin/uncompress\n    compressext .Z\n    compressoptions -c";
    const logrotate = `${p.logPath} {\n    ${p.frequency}\n    maxsize ${p.maxSize}\n    rotate ${p.rotate}\n    missingok\n    notifempty\n    nodateext\n    noolddir\n    nocopytruncate\n    nocreate\n${compress}\n    sharedscripts\n    postrotate\n        /bin/systemctl kill --kill-who=main --signal=HUP ${p.engine}.service\n    endscript\n}\n`;
    const basePattern = p.logPath.slice(p.logPath.lastIndexOf("/") + 1).replace(/\./g, "\\.");
    const backup = `#!/usr/bin/env bash\nset -euo pipefail\numask 077\n# GNU/Linux: archive rotated siblings only, never the active log. No deletion.\nsource_log=${shellQuote(p.logPath)}\narchive_dir=${shellQuote(p.archiveDir)}\nfor tool in find tar mktemp date${p.compression === "gzip" ? " gzip" : p.compression === "compress" ? " compress" : ""}; do\n    command -v "$tool" >/dev/null || { printf 'Missing tool: %s\\n' "$tool" >&2; exit 1; }\ndone\nmkdir -p -- "$archive_dir"\nsource_dir=$(dirname -- "$source_log")\nlist=$(mktemp)\narchive=''\ncleanup() {\n    rm -f -- "$list"\n    if [[ -n "$archive" ]]; then rm -f -- "$archive"; fi\n}\ntrap cleanup EXIT\ncd -- "$source_dir"\n# Numeric rotation suffixes only; exclude active or unrelated files.\nfind . -maxdepth 1 -type f -regextype posix-extended -regex ${shellQuote(`./${basePattern}\\.[0-9]+(\\.gz|\\.Z)?`)} -print0 > "$list"\nif [[ ! -s "$list" ]]; then printf 'No rotated logs to archive.\\n'; exit 0; fi\nstamp=$(date -u +%Y%m%dT%H%M%SZ)\narchive=$(mktemp "$archive_dir/logops-$stamp-XXXXXX${p.compression === "gzip" ? ".tar.gz" : p.compression === "compress" ? ".tar.Z" : ".tar"}")\n${p.compression === "gzip" ? 'tar --null --verbatim-files-from --files-from="$list" -czf "$archive"' : p.compression === "compress" ? 'tar --null --verbatim-files-from --files-from="$list" -cf - | compress -c > "$archive"' : 'tar --null --verbatim-files-from --files-from="$list" -cf "$archive"'}\nprintf 'Created %s\\n' "$archive"\narchive=''\n`;
    return {logrotate, backup, notes: [
      "Review service names and the HUP reopen hook for your distro. This template requires systemd and a daemon that recreates its own log file (nocreate). No copytruncate race is introduced.",
      "Run logrotate --debug on the candidate first. maxsize is checked only when logrotate runs; schedule it frequently enough.",
      "The backup uses GNU find/tar, creates a unique private archive, and does not delete originals. Schedule outside rotation to avoid concurrent renames/compression.",
      "Backups include only numeric rotated siblings of the chosen file, not the active log. Repeated runs intentionally create independent snapshots; retention/off-site transfer must be managed separately.",
      "Traditional compress requires the distribution's ncompress package. Confirm binary paths for logrotate. Do not use this Linux template for native Windows services."
    ]};
  }
  return {defaultProfile, inspectConfig, editConfig, generateDeployment, parseLog, searchLogs, generateSwatch, generateMaintenance, csvCell};
})();
if (typeof module !== "undefined" && module.exports) module.exports = LogOps;
