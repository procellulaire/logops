# LogOps workbench

## Start

Open `index.html` directly in a current Chrome, Edge, Firefox or Safari browser.
Copying that one file is sufficient to run the browser application offline.
No logs or configuration files are uploaded. Imported data stays in page memory
until you close/reload the page; download anything you want to keep.

The browser is an **authoring and investigation workbench**, not a syslog daemon,
remote management agent, Splunk replacement or cloud resource provisioner. It
cannot listen for syslog, tail remote hosts, install services, execute commands,
rotate server files or persist changes without an explicit download.

## Deployment profiles

| Role | Input | Output |
| --- | --- | --- |
| Server | Network devices/firewalls | Local log file |
| Forwarder | Network devices/firewalls | Upstream syslog receiver |
| Agent | Local operating-system logs | Upstream syslog receiver |

Choose syslog-ng or rsyslog, deployment environment, UDP/TCP/mutual TLS, listening
address/port, upstream address/port, certificates and storage paths. A forwarder
uses the same transport on both legs; edit the candidate manually for a mixed
UDP-input/TLS-output relay.

The default listener binds **loopback**, not a public interface. Replace it with a
private interface for actual network devices. Azure profiles explain NSG/private
VNet considerations; AWS profiles explain security groups/private connectivity.
These are Linux VM deployment notes, not Azure Monitor/DCR, CloudWatch or
infrastructure-as-code integrations.

The RFC3164 profile uses syslog-ng `network()` drivers and traditional rsyslog
forwarding. RFC5424 uses syslog-ng `syslog()` drivers and rsyslog's protocol-23
template with octet-counted TCP framing. Rsyslog network inputs auto-detect
standard syslog formats. Verify your devices' framing; templates do not implement
proprietary Cisco, CEF, LEEF or firewall-specific schemas.

TLS requires your own trusted CA and certificates/keys. The syslog-ng destination
verifies the forwarding target's certificate name; its listener accepts
CA-trusted client certificates. Rsyslog separately configures an allowed sender
certificate identity and the upstream receiver identity. For many senders, edit
`PermittedPeer` into an array of permitted identities. TLS key paths are references,
not key-generation or certificate-upload functionality.

Generated candidates are standalone starting points. Do not blindly add them to
an existing include directory: loading modules or local sources twice can fail
or duplicate events. Provision daemon-owned queue/log directories, persistent
disks, service permissions, CA files, restricted firewalls and monitoring.
Never run both daemons on the same sockets/ports. Avoid forwarding loops.

## Existing configurations

Paste raw configuration text or import a UTF-8 file, then inspect it. The workbench
detects syslog-ng blocks, rsyslog RainerScript, and common legacy selectors and
directives. Structured fields cover common literal ports, hosts, file paths,
transports, queue sizes and certificate paths. Applying fields changes only their
source spans; comments, ordering, line endings and unknown directives remain intact
in the shared core and console. Browser textarea editing normalizes line endings
to LF; use the CLI for byte-preserving edits of untouched UTF-8/CRLF text.

The raw editor always remains available. Ambiguous/mixed daemon syntax disables
structured fields rather than guessing. Editing raw text invalidates the previous
field form; inspect again before applying field changes. Includes are not loaded,
macros/expressions and escaped strings are not evaluated, and legacy forwarding
selectors remain raw-edit only.

This is **not a universal parser, config migration engine or daemon validator**.
Generated baselines target **syslog-ng OSE 3.38+** and **rsyslog 8.x** with the
needed modules installed. Older releases, premium/vendor builds, non-Linux
sources, unusual modules, TLS package differences, distro layouts and appliance
restrictions may require changes. Raw editing is possible for other versions,
but a successful syntax detection does not certify compatibility.
For syslog-ng, IPv6 literals select `ip-protocol(6)` independently on each leg.
DNS names default to IPv4; edit the raw driver's address family for IPv6-only DNS.
In rsyslog, TLS still uses `protocol="tcp"` plus TLS stream-driver settings, not
`protocol="tls"`.

Run the appropriate native validator on the intended host:

```bash
sudo syslog-ng --syntax-only --cfgfile ./candidate.conf
sudo rsyslogd -N1 -f ./candidate.conf
```

Keep a working-config backup, review the candidate/diff, resolve validation
errors, manually install/merge it, and follow your distribution's reload/restart
procedure. Confirm received messages, TLS identities, permissions, queue behavior
and disk usage before enabling production devices.

## Log explorer and search

Import multiple plain UTF-8 files (extensionless files also work) or use demo
events. RFC3164, RFC5424 and scalar JSON fields are extracted; unrecognized lines
remain searchable as raw text. Simple `key=value` message fields are extracted
without running a vendor plugin. One physical line is one event; multiline stack
traces are not merged. RFC3164 timestamps retain their original yearless text.

The browser has a combined **50 MiB input / 100,000-event / 1 MiB per-line** cap and paginates
results. Import progress/partial-load notices are explicit. Uncompress files
before browser import. The CLI also accepts `.gz` files and stdin, enforces
50 MiB **decompressed** input, 100,000 events and 1 MiB per line. These limits are
for a local in-memory workbench, not a distributed search index. Use native
date/file selection or prefiltering for larger collections.

| Expression | Meaning |
| --- | --- |
| `Failed password` | Implicit AND between free-text terms |
| `"Failed password"` | Phrase in the raw event |
| `host=fw-* action!=allow` | Case-insensitive field comparisons and globs |
| `(deny OR drop) NOT host=test-*` | Boolean grouping; NOT, AND, OR precedence |
| `port>=443 severity<=warning` | Numeric or syslog severity-code comparison |
| `timestamp=2026-09-28*` | Raw timestamp prefix filter |
| `deny \| stats count by host,src` | Count grouped by fields |
| `\| top 10 src` | Top values, counts and percentage |
| `\| sort -count \| head 20` | Descending sort and limit |
| `\| fields timestamp,host,message` | Column projection |

Supported pipes: `stats count [by fields]`, `top [N] field`, `sort [-]field`,
`head N`, `fields field,...`. This is a documented **Splunk-inspired subset**,
not SPL compatibility: no `eval`, joins, time bucketing, arbitrary regex, saved
indexes or executable expressions. Unknown commands and malformed queries fail.
Use quotes for values containing spaces or query punctuation. `*` and `?`
remain glob operators inside quotes. Equality is case-insensitive; relational
operators apply to numbers and severity names, not dates. Sort is numeric for
numeric JSON/count fields and lexical for string fields (including raw timestamps
and extracted key/value strings). Missing fields project as empty strings.

CSV exports neutralize leading spreadsheet formula characters; JSON preserves
event values. Table output in the CLI strips terminal control characters.

## Swatchdog detections

Enter one **literal phrase per line**, select case sensitivity and a rate-limit
interval, then download the Swatchdog configuration. The browser can preview
literal matches against imported events. It does not emulate Swatchdog's runtime
thresholds or execute Perl/actions.

Generated phrases are escaped for Perl and echo matching messages to stdout.
One shared `threshold` limits alerts across the rule's phrases; set the throttle
to zero to disable rate limiting. Edit the exported
file manually for advanced regex, independent per-rule thresholds or reviewed
notification actions. Swatchdog configuration can execute arbitrary Perl/shell
commands: treat imported or manually modified configurations as code.

```bash
swatchdog --config-file=./swatchrc --examine=./sample.log
swatchdog --config-file=./swatchrc --tail-file=/var/log/remote/network.log
```

Install your distribution's `swatch`/`swatchdog` package first. Configure service
supervision and verify tailing across log rotation separately.

## Rotation, backup and archive

The retention page exports a Linux `logrotate` stanza and a separate Bash archive
script. Choose daily/weekly/monthly rotation, retained count, maximum size and
gzip, traditional Unix compress or no compression. Traditional compress requires
`ncompress` and correct `compresscmd`/`uncompresscmd` paths.

`logrotate` uses rename plus a systemd HUP reopen hook, not `copytruncate`. It uses
`nocreate`, relying on the configured daemon to recreate its own log file with
appropriate permissions. Review that assumption and the service name on your
distro, add a suitable `su` directive for non-root log directories if needed,
and inspect the candidate with `logrotate --debug ./logops.logrotate`.
The retention count is a number of rotations, **not guaranteed days**. `maxsize`
only takes effect when logrotate runs; choose an appropriate scheduler frequency.

The archive script uses GNU `find` and `tar`, optional `gzip`/`compress`, unique
filenames and a private umask. It archives numeric rotated siblings such as
`network.log.1`, `.2.gz` and `.3.Z`, **never the active log**, and never deletes
the originals. Avoid overlap with rotation/compression. Date-suffixed rotations
are not selected. Repeated runs produce independent snapshots; off-site copying,
encryption, archive retention and restore drills are separate operational tasks.
These scripts target Linux, not native Windows services.

## Console

Requirements: Node.js 18+; no npm dependencies. The Bash wrapper works on Linux
and in Windows WSL/Git Bash. WSL needs Node installed inside WSL. PowerShell can
run `node .\bin\logops.js` directly instead of `bash bin/logops`.

```bash
bash bin/logops inspect ./existing.conf
# Use setting IDs from the inspect output; IDs are offsets in that exact file.
bash bin/logops edit ./existing.conf --set setting-123=6514 --output ./edited.conf

bash bin/logops generate --engine syslog-ng --role server \
  --transport tcp --bind 10.0.0.4 --port 514 --out-dir ./receiver
bash bin/logops generate --profile examples/azure-forwarder.json --out-dir ./azure

bash bin/logops search 'action=deny | stats count by src' examples/device.log
bash bin/logops search 'app=sshd | fields host,message' ./syslog ./old.log.gz --format csv
gzip -cd ./old.log.gz | bash bin/logops search 'severity<=warning' -

bash bin/logops swatch --pattern 'Failed password' --pattern 'privilege escalation' \
  --throttle 60 --output ./swatchrc
bash bin/logops maintenance --log-path /var/log/remote/network.log \
  --compression gzip --rotate 14 --out-dir ./retention
```

Options are kebab-case; profile JSON uses camelCase. Use `--help` for the complete
list. Exports refuse to overwrite existing files unless `--force` is explicit.
The CLI performs no deployment, privileged operations, deletion or remote calls.

## Development

The committed `index.html` is generated from `web/template.html`, `web/styles.css`,
`web/app.js` and the shared `lib/logops.js`. Do not edit the bundle manually.

```bash
node tools/build.js
node --test
node tools/build.js --check
```

Equivalently use `npm run build`, `npm test`, `npm run check`. No dependency
installation is required. The native Bash smoke test runs when Bash is available;
set `LOGOPS_BASH` to an explicit Bash executable if it is not on PATH.
Native service/module compatibility still requires validation on target hosts.
