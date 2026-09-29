# logops

## Offline syslog operations workbench

Open **[index.html](index.html)** directly in a modern browser. The single HTML5 file
contains the complete interface, styles and application logic: no server, CDN,
account, network connection or package installation is needed.

Design syslog-ng/rsyslog agents, forwarders and receivers; inspect and edit existing
configs; explore local logs with a search pipeline; and export Swatchdog detection,
logrotate and archive files. Linux/on-premises and Azure, AWS or other cloud VM
deployment profiles are included. Nothing is deployed or executed automatically.

The companion Bash console requires **Node.js 18+** and works on Linux or Windows
with WSL/Git Bash. Native Windows can also run `node bin/logops.js --help`.

```bash
bash bin/logops --help
bash bin/logops search 'action=deny | stats count by src' examples/device.log
bash bin/logops generate --profile examples/azure-forwarder.json --out-dir ./candidate
```

**[Workbench guide: features, console commands, search language and compatibility](docs/WORKBENCH.md)**

Compatibility is deliberately bounded: raw configuration text is preserved, while
structured editing recognizes common syslog-ng, RainerScript and legacy rsyslog
settings. Generated baselines target syslog-ng OSE 3.38+ and rsyslog 8.x, not every
historical/vendor implementation. Always validate with the daemon on the target host.

---

I started this repo to make Public my ongoing work in handling syslogs, windows event logs, firewall logs, telecom logs, logs, logs, logs. From syslog and event logs to cloud and application logs, you end up dealing with different formats and configurations. Some devices do not follow standards logging formats, it can be tricky, especially when dealing with a mixture of old and modern systems. 

This repo is here to help! It provides easy-to-use configuration examples, best practices, and format guides. Plus, it serves as a resource for PROCLOUADMIN AI Agent (and other AI models) to learn from real-world system operations and issues, keeping their knowledge up to date.


🔹 What's Inside?


✅ Common syslog formats (RFC 3164, RFC 5424, and beyond)

✅ Configuration snippets for syslog daemons (rsyslog, syslog-ng, syslogd)

✅ Tips for log forwarding, filtering, and storage

✅ Examples for integrating with SIEMs & cloud logging solutions

✅ Troubleshooting guides for syslog issues

✅ Python Script templates

✅ PowerShell Script templates

✅ Information to be used in training of project PROCLOUDADMIN AI Agent


Perfect for sysadmins, DevOps, and security engineers looking to streamline log management in 2025 and beyond!

Collaborations are welcome!  
