"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../lib/logops.js");

test("configuration detection ignores comments and strings; unknown syntax is never rewritten", () => {
  assert.equal(core.inspectConfig("# source fake { }; \nmodule(load=\"imtcp\")").engine, "rsyslog");
  assert.equal(core.inspectConfig('@version: 3.38\n# action(type="omfwd")\nsource s { internal(); };').engine, "syslog-ng");
  assert.equal(core.inspectConfig("unrecognized syntax").engine, "unknown");
  assert.equal(core.inspectConfig("source s { internal(); }; action(type=\"omfile\")").engine, "mixed");
  assert.throws(() => core.editConfig("something unknown", {}), /unknown/);
  assert.throws(() => core.inspectConfig('file("unclosed'), /Unterminated/);
});
test("lossless editing preserves comments, CRLF, include statements and unsupported vendor directives", () => {
  const text = '\uFEFF@version: 3.38\r\n@include "vendor.conf"\r\nsource s { network(ip("10.0.0.1") port(514)); };\r\n# port(999)\r\nvendor_custom(xyz);\r\n';
  const report = core.inspectConfig(text);
  assert.equal(report.settings.length, 2);
  const port = report.settings.find(s => s.label === "port");
  assert.equal(core.editConfig(text, {[port.id]: "6514"}), text.replace("port(514)", "port(6514)"));
  assert.equal(core.editConfig(text, {}), text);
  assert.throws(() => core.editConfig(text, {[port.id]: "70000"}), /integer/);
  assert.throws(() => core.editConfig(text, {[port.id]: '514); evil()'}), /integer/);
  assert.throws(() => core.editConfig(text, {stale: "514"}), /stale/);
});
test("rsyslog RainerScript and legacy scalar detection", () => {
  const text = '$ModLoad imtcp\n$InputTCPServerRun 514\n$WorkDirectory /var/spool/rsyslog\ninput(type="imudp" port="1514")\naction(type="omfwd" target="log.local" port="6514" protocol="tcp")\n*.* @@legacy:514\n';
  const info = core.inspectConfig(text);
  assert.equal(info.engine, "rsyslog");
  assert.equal(info.settings.length, 6);
  assert.equal(core.inspectConfig("*.* @@legacy:514").syntax, "Legacy rsyslog / syslog.conf");
  const port = info.settings.find(s => s.label === "$InputTCPServerRun");
  assert.equal(core.editConfig(text, {[port.id]: "8514"}), text.replace("Run 514", "Run 8514"));
  assert.equal(core.inspectConfig('module(load="imfile")\ninput(type="imfile" file="/var/log/a\\\\b")').settings.length, 0);
});
test("all engine/role/transport/environment deployment combinations produce recognized candidates", () => {
  for (const engine of ["syslog-ng", "rsyslog"])
    for (const role of ["server", "forwarder", "agent"])
      for (const transport of ["tls", "tcp", "udp"])
        for (const environment of ["on-prem", "azure", "aws", "other"]) {
          const result = core.generateDeployment({engine, role, transport, environment});
          assert.equal(core.inspectConfig(result.config).engine, engine, result.config);
          assert.match(result.commands, /candidate.conf/);
          assert.ok(result.notes.length >= 5);
          if (transport === "tls") {
            assert.doesNotMatch(result.config, /anonymous|optional-untrusted|peer-verify\(no\)/);
            assert.match(result.config, /ca.pem/);
          }
          if (role === "server") assert.match(result.config, /network.log/);
          else assert.match(result.config, /logs.example.net/);
          if (role === "agent") assert.doesNotMatch(result.config, /input\(type="imtcp"|source s_logops \{ network/);
        }
});
test("deployment rejects unsafe values before generating files", () => {
  for (const change of [{port: 0}, {targetPort: 99999}, {target: 'x";exec("oops")'}, {logPath: "/tmp/a\n/etc/passwd"},
    {queueDir: "/tmp/../etc"}, {engine: "syslogd"}, {role: "other"}, {transport: "quic"}, {caFile: "relative.pem"}])
    assert.throws(() => core.generateDeployment(change));
});
test("IPv6 listener and upstream address families are independent", () => {
  const incoming = core.generateDeployment({role: "forwarder", transport: "tcp", bind: "::1"}).config;
  assert.match(incoming, /ip\("::1"\) ip-protocol\(6\)/);
  assert.match(incoming, /"logs.example.net" ip-protocol\(4\)/);
  const outgoing = core.generateDeployment({role: "agent", transport: "tcp", target: "2001:db8::2", wireFormat: "rfc5424"}).config;
  assert.match(outgoing, /syslog\("2001:db8::2" ip-protocol\(6\)/);
});
test("rsyslog TLS uses stream drivers, not a protocol=tls scalar", () => {
  const config = core.generateDeployment({engine: "rsyslog", role: "agent", transport: "tcp"}).config;
  const setting = core.inspectConfig(config).settings.find(s => s.label === "protocol");
  assert.throws(() => core.editConfig(config, {[setting.id]: "tls"}), /tcp, udp/);
});
test("RFC5424 structured data, priority and vendor fields", () => {
  const raw = '<165>1 2026-09-28T12:01:01Z fw-01 firewall 42 ID47 [meta x="a\\] b"][second z="ok"] deny src=10.0.0.1 dst="10.0.0.2" port=443';
  const event = core.parseLog(raw, "fw.log", 12);
  assert.equal(event.format, "RFC5424"); assert.equal(event.severity, "notice");
  assert.equal(event.facility, "local4"); assert.equal(event.app, "firewall");
  assert.equal(event.message, 'deny src=10.0.0.1 dst="10.0.0.2" port=443');
  assert.equal(event.src, "10.0.0.1"); assert.equal(event.dst, "10.0.0.2");
  assert.equal(event.file, "fw.log"); assert.equal(event.line, 12); assert.equal(event.raw, raw);
});
test("traditional, JSON, malformed JSON and plain messages remain inspectable", () => {
  const legacy = core.parseLog("<34>Sep  8 10:00:01 host-a sshd[100]: Failed password for admin");
  assert.equal(legacy.host, "host-a"); assert.equal(legacy.app, "sshd"); assert.equal(legacy.pid, "100");
  assert.equal(legacy.severity, "crit"); assert.equal(legacy.timestamp, "Sep  8 10:00:01");
  const json = core.parseLog('{"host":"h","severity":"warning","message":"denied","file":"evil","__proto__":{"x":1},"raw":"fake","line":999}', "real", 1);
  assert.equal(json.host, "h"); assert.equal(json.file, "real"); assert.equal(json.line, 1); assert.equal(json.format, "JSON");
  assert.notEqual(json.raw, "fake"); assert.equal(Object.getPrototypeOf(json), Object.prototype);
  assert.equal(core.parseLog("{not-json").format, "text");
  assert.equal(core.parseLog("<999>something").severity_code, null);
  assert.equal(core.parseLog("plain <script> remains text").message, "plain <script> remains text");
});
test("RFC5424 deployment uses the correct driver, framing, queue directory and independent TLS peers", () => {
  const profile = {role: "forwarder", wireFormat: "rfc5424", queueDir: "/var/lib/queues", peerName: "receiver.example.net", allowedPeer: "device.example.net"};
  const ng = core.generateDeployment(profile).config;
  assert.match(ng, /source s_logops \{ syslog\(/);
  assert.match(ng, /destination d_logops \{ syslog\(/);
  assert.match(ng, /dir\("\/var\/lib\/queues"\)/);
  const rs = core.generateDeployment({...profile, engine: "rsyslog"}).config;
  assert.match(rs, /PermittedPeer="device.example.net"/);
  assert.match(rs, /StreamDriverPermittedPeers="receiver.example.net"/);
  assert.match(rs, /TCP_Framing="octet-counted"/);
  assert.match(rs, /template="RSYSLOG_SyslogProtocol23Format"/);
});
const events = [
  '<34>1 2026-09-28T12:01:00Z fw-01 firewall 42 - - deny src=10.1.0.1 port=443',
  '<38>1 2026-09-28T12:02:00Z host-a sshd 42 - - Accepted publickey user=alice',
  '<35>1 2026-09-28T12:03:00Z host-a sshd 42 - - Failed password user=root',
  '<36>1 2026-09-28T12:04:00Z fw-01 firewall 42 - - deny src=10.1.0.2 port=22'
].map((line, i) => core.parseLog(line, "sample", i + 1));
test("search Boolean precedence, phrases, numeric comparisons and wildcards", () => {
  assert.equal(core.searchLogs(events, 'host=fw-* severity<=warning').matched, 2);
  assert.equal(core.searchLogs(events, '"Failed password" OR (app=firewall AND port>=443)').matched, 2);
  assert.equal(core.searchLogs(events, "NOT (app=sshd OR port=22)").matched, 1);
  assert.equal(core.searchLogs(events, "app!=sshd port>20").matched, 2);
  assert.equal(core.searchLogs(events, 'host="HOST-?" Accepted').matched, 1);
  assert.equal(core.searchLogs(events, "*").matched, 4);
  assert.equal(core.searchLogs(events, "missing>0").matched, 0);
  assert.equal(core.searchLogs(events, "missing=*").matched, 0);
  assert.equal(core.searchLogs(events, "missing!=*").matched, 4);
});
test("search aggregation, top, sorting, projection and row caps", () => {
  assert.deepEqual(core.searchLogs(events, '| stats count by app | sort -count').rows, [{app: "firewall", count: 2}, {app: "sshd", count: 2}]);
  assert.deepEqual(core.searchLogs(events, 'app=absent | stats count').rows, [{count: 0}]);
  const top = core.searchLogs(events, "| top 1 host");
  assert.equal(top.rows[0].count, 2); assert.equal(top.rows[0].percent, 50); assert.equal(top.total, 1); assert.equal(top.scanned, 4);
  assert.deepEqual(core.searchLogs(events, "app=firewall | sort -port | head 1 | fields host,port").columns, ["host", "port"]);
  assert.equal(core.searchLogs(events, "| head 0").rows.length, 0);
  assert.deepEqual(core.searchLogs(events, "| stats count by app,severity | fields app").columns, ["app"]);
});
test("search rejects malformed and unsupported queries rather than returning success-shaped results", () => {
  for (const query of ['"unfinished', "host=", "(deny", "deny)", "deny AND", "OR deny", "port>=", "deny |",
    "| eval run()", "| stats sum", "| stats count by", "| stats count by host,", "| head no", "| sort", "| fields", "| top 2", "| fields __proto__", "| stats count by count"])
    assert.throws(() => core.searchLogs(events, query), undefined, query);
});
test("swatch phrases are literal Perl-safe expressions with an actual threshold directive", () => {
  const config = core.generateSwatch({patterns: ["Failed password", 'bad/@root.*${foo}\\end'], throttle: 45});
  assert.match(config, /threshold track_by=logops,type=limit,count=1,seconds=45/);
  assert.ok(config.includes('bad\\/\\@root\\.\\*\\$\\{foo\\}\\\\end'));
  assert.match(config, /\/i\n/);
  assert.doesNotMatch(core.generateSwatch({patterns: ["deny"], ignoreCase: false}), /\/i/);
  assert.throws(() => core.generateSwatch({patterns: ["a\nexec evil"]}), /single lines/);
  assert.throws(() => core.generateSwatch({patterns: []}), /at least/);
  assert.doesNotMatch(core.generateSwatch({patterns: ["deny"], throttle: 0}), /threshold /);
  assert.throws(() => core.generateSwatch({patterns: ["deny"], throttle: -1}), /integer/);
});
test("retention and archive defaults are nondestructive and validated", () => {
  for (const compression of ["gzip", "compress", "none"]) {
    const result = core.generateMaintenance({compression});
    assert.match(result.logrotate, /nocreate/); assert.doesNotMatch(result.logrotate, /^\s+copytruncate$/m);
    assert.match(result.logrotate, /nodateext/); assert.match(result.logrotate, /noolddir/);
    assert.match(result.logrotate, /systemctl kill --kill-who=main --signal=HUP syslog-ng.service/);
    assert.match(result.backup, /--null --verbatim-files-from/);
    assert.ok(result.backup.includes("network\\.log\\.[0-9]+"));
    assert.doesNotMatch(result.backup, /-delete|rm.*source_log/);
    assert.match(result.backup, /umask 077/);
    if (compression === "compress") assert.match(result.logrotate, /compressoptions -c/);
  }
  assert.throws(() => core.generateMaintenance({logPath: "/"}), /absolute/);
  assert.throws(() => core.generateMaintenance({maxSize: "1M\nprerotate"}), /Maximum/);
  assert.throws(() => core.generateMaintenance({rotate: 0}), /Retention/);
});
