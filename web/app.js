(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const core = typeof LogOps === "undefined" ? null : LogOps;
  const MAX_BYTES = 50 * 1024 * 1024;
  const MAX_EVENTS = 100000;
  const MAX_CONFIG_BYTES = 5 * 1024 * 1024;
  const MAX_LINE_BYTES = 1024 * 1024;
  const encoder = new TextEncoder();
  const PAGE_SIZE = 100;
  const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
  const number = (value) => Number(value).toLocaleString();
  const messageOf = (error) => error instanceof Error ? error.message : String(error);
  const profileKeys = [
    "engine", "role", "environment", "transport", "wireFormat", "bind", "port", "target",
    "targetPort", "logPath", "queueDir", "caFile", "certFile", "keyFile", "peerName", "allowedPeer"
  ];
  const viewNames = {
    deployment: "Deployment",
    configuration: "Configuration",
    explorer: "Log explorer",
    detections: "Detections",
    maintenance: "Retention & archive"
  };
  const state = {
    events: [],
    sources: [],
    bytes: 0,
    load: null,
    result: null,
    page: 0,
    inspection: null,
    settingInputs: [],
    inspectionStale: true,
    deploymentEngine: null,
    previewVersion: 0,
    previewBusy: false
  };
  let toastTimer;
  document.querySelectorAll("svg.icon").forEach((icon) => icon.setAttribute("aria-hidden", "true"));

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function notify(message, isError = false) {
    clearTimeout(toastTimer);
    const region = $("toast-region");
    region.setAttribute("aria-live", isError ? "assertive" : "polite");
    const toast = element("div", isError ? "toast toast-error" : "toast");
    const dismiss = element("button", "", "Dismiss");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss notification");
    dismiss.addEventListener("click", () => region.replaceChildren());
    toast.append(element("span", "", message), dismiss);
    region.replaceChildren(toast);
    if (!isError) toastTimer = setTimeout(() => region.replaceChildren(), 7000);
  }

  function on(id, eventName, action) {
    $(id).addEventListener(eventName, (event) => {
      try {
        const pending = action(event);
        if (pending && typeof pending.catch === "function") {
          pending.catch((error) => notify(messageOf(error), true));
        }
      } catch (error) {
        notify(messageOf(error), true);
      }
    });
  }

  function setNotes(id, notes) {
    $(id).replaceChildren(...notes.map((note) => element("li", "", note)));
  }

  function bytesLabel(value) {
    if (value < 1024) return number(value) + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KiB";
    return (value / (1024 * 1024)).toFixed(1) + " MiB";
  }

  function textValue(value) {
    if (value === null || value === undefined) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }

  function download(content, filename, type = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = element("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    notify("Download prepared: " + filename + ". Your browser controls where it is saved.");
  }

  function downloadEditor(id, filename) {
    const content = $(id).value;
    if (!content.trim()) throw new Error("There is no content to download. Generate or enter a candidate first.");
    download(content, filename);
  }

  function bindOutput(editorId, buttonIds, badgeId) {
    on(editorId, "input", () => {
      buttonIds.forEach((id) => { $(id).disabled = !$(editorId).value.trim(); });
      if (badgeId) $(badgeId).textContent = "Manually edited";
    });
  }

  function showView(name, focus = false) {
    if (!Object.prototype.hasOwnProperty.call(viewNames, name)) name = "deployment";
    document.querySelectorAll(".view").forEach((view) => { view.hidden = view.id !== name; });
    document.querySelectorAll("[data-view]").forEach((link) => {
      if (link.dataset.view === name) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    $("current-view-name").textContent = viewNames[name];
    document.title = "LogOps | " + viewNames[name];
    if (focus) $("main-content").focus({ preventScroll: true });
  }

  document.querySelectorAll("[data-view]").forEach((link) => {
    link.addEventListener("click", () => showView(link.dataset.view, true));
  });
  window.addEventListener("hashchange", () => {
    if (location.hash !== "#main-content") showView(location.hash.slice(1));
  });
  showView(location.hash.slice(1));

  const requiredMethods = ["generateDeployment", "inspectConfig", "editConfig", "parseLog",
    "searchLogs", "generateSwatch", "generateMaintenance", "csvCell"];
  if (!core || !core.defaultProfile || requiredMethods.some((key) => typeof core[key] !== "function")) {
    $("runtime-error").hidden = false;
    $("runtime-error").textContent = "The LogOps shared core is missing or incomplete. Open the bundled index.html, not the source template. Rebuild the page if this problem persists.";
    document.querySelectorAll("main button, main input, main select, main textarea").forEach((control) => {
      control.disabled = true;
    });
    return;
  }

  // Deployment artifacts are snapshots; changing a profile never rewrites manual edits.
  function updateProfile() {
    const engine = $("profile-engine").value;
    const role = $("profile-role").value;
    const tls = $("profile-transport").value === "tls";
    $("profile-listener").disabled = role === "agent";
    $("profile-remote").disabled = role === "server";
    $("profile-logPath").disabled = role !== "server";
    $("profile-tls").disabled = !tls;
    $("profile-wire-format-note").textContent = engine === "syslog-ng"
      ? "syslog-ng uses network() for RFC3164 and syslog() for RFC5424. A listener expects the selected format; it does not auto-detect both."
      : "rsyslog inputs auto-detect standard syslog formats. Forwarding uses the selected wire format, template, and framing.";
    $("profile-peerName").disabled = !tls || engine !== "rsyslog" || role === "server";
    $("profile-allowedPeer").disabled = !tls || engine !== "rsyslog" || role === "agent";
    $("profile-peerName-help").textContent = engine !== "rsyslog"
      ? "Not used by syslog-ng. Outgoing TLS verifies the receiver certificate against the target host."
      : role === "server"
        ? "Not used by a server. Applies to outgoing agent and forwarder connections."
        : "Match the outgoing receiver's certificate name. This is independent of the allowed sender certificate.";
    $("profile-allowedPeer-help").textContent = engine !== "rsyslog"
      ? "Used only by rsyslog TLS listeners; not used by syslog-ng."
      : role === "agent"
        ? "Not used by an agent, which has no network listener."
        : "Allow this certificate name for incoming senders, independently of the outgoing receiver. Use the raw editor for more specific sender policies.";
    $("profile-flow").textContent = {
      server: "Network sources  ->  Collector  ->  Local log file",
      forwarder: "Network sources  ->  Relay  ->  Remote collector",
      agent: "Local system logs  ->  Agent  ->  Remote collector"
    }[role];
    $("profile-transport-note").textContent = tls
      ? "TLS protects transport, not the syslog message format. Plan for RFC3164/RFC5424 compatibility and framing at both ends. Provision the required CA, certificate, and private key files; verify trust and peer names on your hosts."
      : "TCP and UDP are unencrypted. Confirm RFC3164/RFC5424 compatibility and framing at both ends. UDP can lose or reorder messages; use only where appropriate for your network.";
    if (tls && engine === "syslog-ng" && role !== "server") {
      $("profile-transport-note").textContent += " For syslog-ng, the target host must match the outgoing collector's certificate identity.";
    }
  }

  function resetProfile() {
    profileKeys.forEach((key) => { $("profile-" + key).value = textValue(core.defaultProfile[key]); });
    updateProfile();
    if (state.deploymentEngine) $("deployment-state").textContent = "Profile reset - regenerate";
  }

  on("deployment-form", "input", () => {
    updateProfile();
    if (state.deploymentEngine) $("deployment-state").textContent = "Profile changed - regenerate";
  });
  on("deployment-form", "change", updateProfile);
  on("profile-reset", "click", () => { resetProfile(); notify("Deployment profile reset to the shared defaults."); });
  on("deployment-form", "submit", (event) => {
    event.preventDefault();
    if (!$("deployment-form").reportValidity()) return;
    const profile = { ...core.defaultProfile };
    profileKeys.forEach((key) => {
      profile[key] = key === "port" || key === "targetPort"
        ? Number($("profile-" + key).value)
        : $("profile-" + key).value;
    });
    const output = core.generateDeployment(profile);
    $("deployment-config").value = output.config;
    $("deployment-commands").value = output.notes.map((note) => "# " + note).join("\n\n") + "\n\n" + output.commands;
    setNotes("deployment-notes", output.notes);
    state.deploymentEngine = profile.engine;
    $("deployment-state").textContent = "Generated / " + profile.engine;
    $("deployment-download").disabled = !output.config.trim();
    $("deployment-to-editor").disabled = !output.config.trim();
    $("deployment-commands-download").disabled = !output.commands.trim();
    notify("Deployment artifacts generated. Review them and validate on your host before deployment.");
  });
  bindOutput("deployment-config", ["deployment-download", "deployment-to-editor"], "deployment-state");
  bindOutput("deployment-commands", ["deployment-commands-download"]);
  on("deployment-download", "click", () => downloadEditor("deployment-config", (state.deploymentEngine || "syslog") + "-candidate.conf"));
  on("deployment-commands-download", "click", () => downloadEditor("deployment-commands", "deployment-instructions.txt"));

  function invalidateInspection(message) {
    state.inspectionStale = true;
    $("config-settings").disabled = true;
    $("config-apply").disabled = true;
    $("config-download").disabled = !$("config-raw").value.trim();
    $("config-inspection-status").textContent = message;
    if (state.inspection) $("config-engine").textContent = "Stale / inspect again";
  }

  function inspectCandidate(announce = true) {
    const source = $("config-raw").value;
    invalidateInspection("Inspection is required before applying supported changes.");
    state.inspection = null;
    state.settingInputs = [];
    $("config-engine").textContent = "Not inspected";
    $("config-syntax").textContent = "";
    $("config-settings-fields").replaceChildren();
    $("config-warnings").replaceChildren();
    if (!source.trim()) throw new Error("Paste or import a configuration before detecting settings.");
    const result = core.inspectConfig(source);
    const fragment = document.createDocumentFragment();
    result.settings.forEach((setting, index) => {
      const field = element("div", "field");
      const id = "recognized-setting-" + index;
      const label = element("label", "", setting.label);
      label.htmlFor = id;
      const input = element("input");
      input.id = id;
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = textValue(setting.value);
      field.append(label, input);
      if (setting.kind) {
        const hint = element("small", "", "Supported setting type: " + setting.kind);
        hint.id = id + "-hint";
        input.setAttribute("aria-describedby", hint.id);
        field.append(hint);
      }
      state.settingInputs.push({ id: setting.id, input });
      fragment.append(field);
    });
    $("config-settings-fields").append(fragment);
    if (!result.settings.length) {
      $("config-settings-fields").append(element("p", "helper",
        "No safely editable settings were recognized. Use the full raw editor and native validation."));
    }
    state.inspection = { source, result };
    state.inspectionStale = false;
    $("config-engine").textContent = result.engine;
    $("config-syntax").textContent = result.syntax;
    $("config-settings").disabled = false;
    $("config-apply").disabled = result.settings.length === 0;
    $("config-inspection-status").textContent = number(result.settings.length) +
      " supported settings recognized. Guided changes preserve untouched source text.";
    setNotes("config-warnings", result.warnings);
    if (announce) notify("Configuration inspected. Review parser warnings and validate the candidate natively.");
  }

  on("config-raw", "input", () => invalidateInspection("Raw text changed. Detect settings again before applying any guided changes."));
  on("config-inspect", "click", () => inspectCandidate());
  on("config-settings-form", "submit", (event) => {
    event.preventDefault();
    if (!state.inspection || state.inspectionStale || $("config-raw").value !== state.inspection.source) {
      invalidateInspection("The supported-setting form is stale. Detect settings again.");
      throw new Error("Raw text changed or has not been inspected. Detect settings before applying changes.");
    }
    const changes = Object.create(null);
    state.settingInputs.forEach(({ id, input }) => { changes[id] = input.value; });
    const edited = core.editConfig(state.inspection.source, changes);
    $("config-raw").value = edited;
    inspectCandidate(false);
    notify("Supported changes applied and the candidate re-inspected. Review the full file before downloading.");
  });
  on("config-file", "change", async () => {
    const file = $("config-file").files[0];
    if (!file) return;
    $("config-file").disabled = true;
    const before = $("config-raw").value;
    try {
      if (file.size > MAX_CONFIG_BYTES) throw new Error("Configuration import is limited to 5 MiB. Choose a smaller text file.");
      const data = new Uint8Array(await file.arrayBuffer());
      if (data[0] === 0x1f && data[1] === 0x8b) throw new Error("Compressed configurations are not supported. Decompress the file first.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      if (text.includes("\0")) throw new Error("This looks like a binary configuration. Import a UTF-8 text file.");
      if ($("config-raw").value !== before) throw new Error("The candidate changed during import. Your edits were kept; choose the file again to replace them.");
      $("config-raw").value = text;
      $("config-filename").textContent = file.name;
      invalidateInspection("File imported. Detect settings to inspect this new candidate.");
      notify("Imported " + file.name + " locally. Detect settings when you are ready.");
    } catch (error) {
      if (error instanceof TypeError) throw new Error("Could not decode the configuration as UTF-8 text. Convert its encoding and import it again. " + messageOf(error));
      throw error;
    } finally {
      $("config-file").value = "";
      $("config-file").disabled = false;
    }
  });
  on("config-download", "click", () => downloadEditor("config-raw", "candidate.conf"));
  on("deployment-to-editor", "click", () => {
    if (!$("deployment-config").value.trim()) throw new Error("Generate or enter deployment configuration first.");
    $("config-raw").value = $("deployment-config").value;
    $("config-filename").textContent = "Deployment candidate / " + (state.deploymentEngine || "manual");
    invalidateInspection("Deployment candidate copied. Detect settings to inspect it.");
    location.hash = "configuration";
    showView("configuration", true);
    notify("Deployment candidate copied to the raw editor. Detect settings to begin guided editing.");
  });

  function invalidatePreview(message = "Preview is out of date. Preview again against the current phrases and loaded events.") {
    state.previewVersion += 1;
    state.previewBusy = false;
    $("detection-preview").disabled = Boolean(state.load);
    $("detection-preview-results").replaceChildren();
    $("detection-preview-summary").textContent = message;
  }

  function refreshMetrics() {
    $("event-count").textContent = number(state.events.length);
    $("file-count").textContent = number(state.sources.length);
    $("byte-count").textContent = bytesLabel(state.bytes);
    $("detection-event-count").textContent = number(state.events.length) + " loaded events";
  }

  function refreshSources() {
    const selected = $("log-file-filter").value;
    const all = element("option", "", "All sources");
    all.value = "";
    $("log-file-filter").replaceChildren(all);
    state.sources.forEach((source) => {
      const option = element("option", "", source.label + " (" + number(source.events) + " events" +
        (source.complete ? "" : ", partial") + ")");
      option.value = source.label;
      $("log-file-filter").append(option);
    });
    $("log-file-filter").value = state.sources.some((source) => source.label === selected) ? selected : "";
  }

  function invalidateResults(message) {
    state.result = null;
    state.page = 0;
    renderResults();
    $("result-summary").textContent = message;
  }

  function setLoading(loading) {
    ["log-files", "load-demo", "log-file-filter", "log-query", "query-run"].forEach((id) => { $(id).disabled = loading; });
    document.querySelectorAll(".query-chip").forEach((button) => { button.disabled = loading; });
    $("logs-clear").disabled = loading || state.sources.length === 0;
    $("detection-preview").disabled = loading || state.previewBusy;
    $("log-drop-zone").setAttribute("aria-disabled", String(loading));
    $("load-progress-panel").hidden = !loading;
    $("load-cancel").disabled = false;
    $("load-cancel").textContent = "Cancel import";
  }

  class ImportStop extends Error {
    constructor(message, cancelled = false) {
      super(message);
      this.name = "ImportStop";
      this.cancelled = cancelled;
    }
  }

  function ensureNotCancelled(load) {
    if (load.cancelled) throw new ImportStop("Import cancelled. Completed events were kept; the unfinished line was discarded.", true);
  }

  function importProgress(load, source) {
    refreshMetrics();
    const loaded = state.bytes - load.startBytes;
    $("load-progress").value = load.totalBytes ? Math.min(100, loaded / load.totalBytes * 100) : 0;
    $("load-progress-text").textContent = "Reading " + source.label + " / " +
      bytesLabel(loaded) + " of " + bytesLabel(load.totalBytes) + " / " +
      number(state.events.length - load.startEvents) + " events added";
  }

  async function readLogFile(file, load) {
    ensureNotCancelled(load);
    if (state.bytes >= MAX_BYTES) throw new ImportStop("The combined 50 MiB source-data limit was reached. Clear the workspace or use smaller files before importing again.");
    if (state.events.length >= MAX_EVENTS) throw new ImportStop("The 100,000 event limit was reached. Clear the workspace or split your input into smaller batches.");
    if (typeof file.stream !== "function") throw new Error("Incremental file reading is unavailable. Open this workbench in a current browser with File.stream support.");
    const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    ensureNotCancelled(load);
    if (header[0] === 0x1f && header[1] === 0x8b) throw new Error(file.name + " is gzip-compressed. Decompress it locally, then import the resulting text file.");
    const used = new Set(state.sources.map((source) => source.label));
    let label = file.name;
    let suffix = 2;
    while (used.has(label)) label = file.name + " (" + suffix++ + ")";
    const source = { label, bytes: 0, events: 0, complete: false };
    state.sources.push(source);
    importProgress(load, source);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const reader = file.stream().getReader();
    let ended = false;
    let lineNumber = 0;
    let fragments = [];
    let fragmentBytes = 0;
    let linesInBatch = 0;
    let lastYield = performance.now();

    function addLine(line) {
      lineNumber += 1;
      if (line.length > MAX_LINE_BYTES / 3 && encoder.encode(line).byteLength > MAX_LINE_BYTES) {
        throw new ImportStop(label + ", line " + number(lineNumber) + " exceeds the 1 MiB line limit. Split or filter oversized events before importing.");
      }
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) return;
      if (state.events.length >= MAX_EVENTS) throw new ImportStop("The 100,000 event limit was reached while reading " + label +
        ". The remaining events were not loaded. Clear the workspace or split the file into smaller batches.");
      let parsed;
      try {
        parsed = core.parseLog(line, label, lineNumber);
      } catch (error) {
        throw new Error("Could not parse " + label + ", line " + number(lineNumber) + ": " + messageOf(error));
      }
      state.events.push(parsed);
      source.events += 1;
    }

    function appendFragment(part) {
      fragmentBytes += encoder.encode(part).byteLength;
      if (fragmentBytes > MAX_LINE_BYTES) throw new ImportStop(label + ", line " + number(lineNumber + 1) +
        " exceeds the 1 MiB line limit. Completed events were kept; split or filter oversized events before importing.");
      fragments.push(part);
    }

    // Keep incomplete lines across decoder chunks, including split UTF-8 characters and CRLF.
    async function consume(text) {
      if (text.includes("\0")) throw new Error(label + " contains binary data. Import UTF-8 plain-text logs, not compressed or binary files.");
      let start = 0;
      let end = text.indexOf("\n");
      while (end !== -1) {
        const part = text.slice(start, end);
        if (fragments.length) {
          appendFragment(part);
          addLine(fragments.join(""));
          fragments = [];
          fragmentBytes = 0;
        } else {
          addLine(part);
        }
        start = end + 1;
        linesInBatch += 1;
        if (linesInBatch >= 250 || performance.now() - lastYield > 12) {
          importProgress(load, source);
          await nextTask();
          ensureNotCancelled(load);
          linesInBatch = 0;
          lastYield = performance.now();
        }
        end = text.indexOf("\n", start);
      }
      if (start < text.length) appendFragment(text.slice(start));
    }

    try {
      while (true) {
        ensureNotCancelled(load);
        const chunk = await reader.read();
        ensureNotCancelled(load);
        if (chunk.done) {
          ended = true;
          await consume(decoder.decode());
          ensureNotCancelled(load);
          if (fragments.length) addLine(fragments.join(""));
          source.complete = true;
          return;
        }
        const remaining = MAX_BYTES - state.bytes;
        const accepted = chunk.value.subarray(0, remaining);
        state.bytes += accepted.byteLength;
        source.bytes += accepted.byteLength;
        await consume(decoder.decode(accepted, { stream: true }));
        if (accepted.byteLength < chunk.value.byteLength) {
          throw new ImportStop("The combined 50 MiB source-data limit was reached in " + label +
            ". Completed lines were kept; the unfinished line and remaining files were not loaded. Clear the workspace or import smaller batches.");
        }
        importProgress(load, source);
        await nextTask();
      }
    } catch (error) {
      if (error instanceof TypeError) throw new Error("Could not read " + label +
        " as UTF-8 text. Convert its encoding before importing again. " + messageOf(error));
      throw error;
    } finally {
      try {
        if (!ended) await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  }

  async function loadFiles(files) {
    if (!files.length) return;
    if (state.load) throw new Error("An import is already running. Wait for it or cancel it before adding more files.");
    const load = {
      cancelled: false,
      startBytes: state.bytes,
      startEvents: state.events.length,
      totalBytes: files.reduce((total, file) => total + file.size, 0)
    };
    state.load = load;
    invalidatePreview("Logs are being imported. Preview after loading finishes.");
    invalidateResults("Import in progress. Completed events will be searchable when loading stops.");
    $("query-error").hidden = true;
    $("load-notice").hidden = true;
    $("load-progress").value = 0;
    $("load-progress-text").textContent = "Preparing local file import...";
    setLoading(true);
    try {
      await nextTask();
      for (const file of files) await readLogFile(file, load);
      const added = state.events.length - load.startEvents;
      $("load-notice").className = "notice";
      $("load-notice").textContent = "Import complete. Added " + number(added) + " events from " +
        number(files.length) + " files. Files remain in memory only; export any results you want to keep.";
      notify("Loaded " + number(added) + " local events.");
    } catch (error) {
      const partial = state.events.length - load.startEvents;
      $("load-notice").className = error instanceof ImportStop ? "notice notice-warning" : "notice notice-error";
      $("load-notice").textContent = messageOf(error) + " Added " + number(partial) +
        " events in this import; " + number(state.events.length) + " total events remain available. No later files in the selection were read. Partial sources are marked in the source filter.";
      notify(messageOf(error), !(error instanceof ImportStop && error.cancelled));
    } finally {
      state.load = null;
      $("load-notice").hidden = false;
      setLoading(false);
      refreshMetrics();
      refreshSources();
      invalidatePreview("Loaded events changed. Preview again to inspect the current data.");
      runQuery();
    }
  }

  on("log-files", "change", () => {
    const files = Array.from($("log-files").files);
    $("log-files").value = "";
    return loadFiles(files);
  });
  on("load-cancel", "click", () => {
    if (!state.load) return;
    state.load.cancelled = true;
    $("load-cancel").disabled = true;
    $("load-cancel").textContent = "Cancelling...";
    $("load-progress-text").textContent = "Cancelling import after the current batch...";
  });
  let dragDepth = 0;
  const dropZone = $("log-drop-zone");
  window.addEventListener("dragover", (event) => {
    if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    if (Array.from(event.dataTransfer.types).includes("Files")) {
      event.preventDefault();
      if (!dropZone.contains(event.target)) notify("Drop files inside the log import area, or use Choose files.", true);
    }
  });
  on("log-drop-zone", "dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    if (!state.load) dropZone.classList.add("drag-active");
  });
  on("log-drop-zone", "dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = state.load ? "none" : "copy";
  });
  on("log-drop-zone", "dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropZone.classList.remove("drag-active");
  });
  on("log-drop-zone", "drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove("drag-active");
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) throw new Error("No readable files were dropped. Choose individual plain-text files, not folders.");
    return loadFiles(files);
  });

  const demos = [
    {
      name: "sample-network.log",
      lines: [
        '<166>Sep 28 09:00:01 edge-router-01 %SYS-6-LOGGINGHOST_STARTSTOP: Logging to host 192.0.2.20 port 6514 started',
        '<164>Sep 28 09:00:04 firewall-01 %ASA-4-106023: Deny tcp src outside:198.51.100.24/54218 dst inside:192.0.2.10/22 by access-group "outside_access_in"',
        '<166>Sep 28 09:00:05 firewall-01 %ASA-6-302013: Built inbound TCP connection 8091 for outside:203.0.113.8/443 to inside:192.0.2.30/53110',
        '<165>Sep 28 09:00:07 switch-02 %LINK-5-CHANGED: Interface GigabitEthernet1/0/24, changed state to administratively down',
        '<134>1 2026-09-28T09:00:09Z juniper-srx RT_FLOW 120 - - RT_FLOW_SESSION_DENY: firewall deny 198.51.100.24/54218 to 192.0.2.10/22',
        '<131>1 2026-09-28T09:01:00Z edge-router-01 rpd 312 ROUTE_LOST [routing@32473 peer="192.0.2.1"] BGP peer down: hold timer expired',
        '<165>Sep 28 09:01:05 switch-02 %LINK-5-CHANGED: Interface GigabitEthernet1/0/24, changed state to up',
        '<134>1 2026-09-28T09:01:11Z juniper-srx RT_FLOW 120 - - Session permitted 192.0.2.30/52000 to 203.0.113.8/443',
        '<164>Sep 28 09:01:18 firewall-01 %ASA-4-106023: Deny udp src outside:198.51.100.24/51000 dst inside:192.0.2.53/53',
        '<166>1 2026-09-28T09:01:23Z edge-router-01 rpd 312 ROUTE_UP - BGP session restored with peer 192.0.2.1'
      ]
    },
    {
      name: "sample-auth.log",
      lines: [
        '<86>Sep 28 09:00:03 linux-app-01 sshd[2104]: Accepted publickey for operator from 192.0.2.15 port 49001 ssh2',
        '<84>Sep 28 09:00:12 linux-app-01 sshd[2117]: Failed password for invalid user admin from 198.51.100.24 port 54218 ssh2',
        '<84>Sep 28 09:00:16 linux-app-01 sshd[2118]: Failed password for root from 198.51.100.24 port 54220 ssh2',
        '<83>Sep 28 09:00:20 linux-app-02 login[713]: failed login for service-user on pts/1',
        '<85>Sep 28 09:00:24 linux-app-01 sudo[2140]: operator : TTY=pts/0 ; PWD=/home/operator ; USER=root ; COMMAND=/usr/bin/systemctl status syslog-ng',
        '<82>1 2026-09-28T09:00:31Z linux-app-02 auditd 702 AUTH_FAILURE [audit@32473 uid="1002"] authentication failure; privilege escalation attempt denied',
        '<86>1 2026-09-28T09:00:42Z linux-app-01 systemd 1 - - Started syslog-ng.service - System Logger Daemon',
        '<84>Sep 28 09:01:10 linux-app-02 sshd[2301]: Failed password for invalid user test from 203.0.113.99 port 41022 ssh2',
        '<85>Sep 28 09:01:20 linux-app-02 sudo[2320]: pam_unix(sudo:session): session opened for user root by operator(uid=1000)',
        '<86>1 2026-09-28T09:01:30Z linux-app-01 sshd 2390 - - Accepted publickey for deploy from 192.0.2.15 port 49030 ssh2'
      ]
    },
    {
      name: "sample-cloud.jsonl",
      lines: [
        '{"timestamp":"2026-09-28T09:00:08Z","host":"azure-gateway-01","app":"azure-firewall","severity":"warning","severity_code":4,"facility":"local0","facility_code":16,"message":"firewall deny: inbound SSH outside approved network","src_ip":"198.51.100.24","action":"deny","environment":"azure"}',
        '{"timestamp":"2026-09-28T09:00:18Z","host":"aws-edge-01","app":"vpc-flow","severity":"notice","severity_code":5,"facility":"local0","facility_code":16,"message":"Rejected inbound connection to management subnet","src_ip":"203.0.113.99","action":"reject","environment":"aws"}',
        '{"timestamp":"2026-09-28T09:00:35Z","host":"azure-gateway-01","app":"entra-audit","severity":"err","severity_code":3,"facility":"auth","facility_code":4,"message":"failed login: conditional access policy blocked sign-in","user":"sample-operator","environment":"azure"}',
        '{"timestamp":"2026-09-28T09:00:50Z","host":"aws-edge-01","app":"cloudtrail","severity":"warning","severity_code":4,"facility":"authpriv","facility_code":10,"message":"privilege escalation: unauthorized role assumption denied","action":"deny","environment":"aws"}',
        '{"timestamp":"2026-09-28T09:01:15Z","host":"azure-gateway-01","app":"azure-firewall","severity":"info","severity_code":6,"facility":"local0","facility_code":16,"message":"Allowed outbound HTTPS to approved service","action":"allow","environment":"azure"}',
        '{"timestamp":"2026-09-28T09:01:40Z","host":"aws-edge-01","app":"vpc-flow","severity":"info","severity_code":6,"facility":"local0","facility_code":16,"message":"Flow accepted from application subnet","action":"allow","environment":"aws"}'
      ]
    }
  ];
  on("load-demo", "click", () => loadFiles(demos.map((demo) =>
    new File([demo.lines.join("\n") + "\n"], demo.name, { type: "text/plain" }))));
  on("logs-clear", "click", () => {
    if (state.load) throw new Error("Cancel the active import before clearing the workspace.");
    state.events = [];
    state.sources = [];
    state.bytes = 0;
    $("load-notice").hidden = true;
    $("query-error").hidden = true;
    $("logs-clear").disabled = true;
    refreshMetrics();
    refreshSources();
    invalidateResults("Workspace cleared. Import new logs or load the sample.");
    invalidatePreview("No events loaded. Add logs in the explorer to preview detections.");
    $("row-dialog").close();
    $("row-fields").replaceChildren();
    $("row-raw").value = "";
    $("row-dialog-title").textContent = "Event details";
    notify("Loaded logs and results cleared from this workspace. Explicitly downloaded files are not affected.");
  });

  function renderResults() {
    const result = state.result;
    const rows = result ? result.rows : [];
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.max(0, Math.min(state.page, pages - 1));
    $("result-count").textContent = number(rows.length);
    $("results-csv").disabled = !result || !rows.length;
    $("results-json").disabled = !result || !rows.length;
    $("page-prev").disabled = !rows.length || state.page === 0;
    $("page-next").disabled = !rows.length || state.page >= pages - 1;
    $("results-empty").hidden = rows.length > 0;
    $("results-table-wrap").hidden = rows.length === 0;
    $("results-head").replaceChildren();
    $("results-body").replaceChildren();
    if (!rows.length) {
      $("page-summary").textContent = "100 rows per page";
      $("results-empty").querySelector("h3").textContent = state.events.length
        ? "No results to show." : "Your next insight starts here.";
      $("results-empty").querySelector("p").textContent = state.events.length
        ? "Run a query, broaden your filter, or choose another source."
        : "Add local logs or explore the curated sample. Events never leave your browser.";
      return;
    }
    const header = element("tr");
    const detailsHeader = element("th", "", "Inspect");
    detailsHeader.scope = "col";
    header.append(detailsHeader);
    result.columns.forEach((column) => {
      const th = element("th", "", column);
      th.scope = "col";
      header.append(th);
    });
    $("results-head").append(header);
    const start = state.page * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, rows.length);
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      const row = rows[index];
      const tr = element("tr");
      const detailCell = element("td");
      const button = element("button", "button button-ghost row-view", "View");
      button.type = "button";
      button.setAttribute("aria-label", "Inspect result row " + number(index + 1));
      button.addEventListener("click", () => showRow(row));
      detailCell.append(button);
      tr.append(detailCell);
      result.columns.forEach((column) => {
        const td = element("td");
        const text = textValue(row[column]);
        const span = element("span", "cell-text", text.length > 500 ? text.slice(0, 500) + "..." : text);
        if (column === "severity") {
          const severity = row.severity_code === null || row.severity_code === undefined || row.severity_code === ""
            ? NaN : Number(row.severity_code);
          span.className = "severity " + (severity <= 3 ? "severity-high" : severity === 4 ? "severity-warning" : severity <= 7 ? "severity-info" : "");
        }
        td.append(span);
        tr.append(td);
      });
      fragment.append(tr);
    }
    $("results-body").append(fragment);
    $("results-table-wrap").scrollTop = 0;
    $("page-summary").textContent = number(start + 1) + "-" + number(end) + " of " +
      number(rows.length) + " rows / Page " + number(state.page + 1) + " of " + number(pages);
  }

  function runQuery() {
    if (state.load) throw new Error("Wait for the import to finish or cancel it before querying.");
    $("query-error").hidden = true;
    $("log-query").removeAttribute("aria-invalid");
    try {
      const source = $("log-file-filter").value;
      const events = source ? state.events.filter((event) => event.file === source) : state.events;
      const result = core.searchLogs(events, $("log-query").value);
      state.result = result;
      state.page = 0;
      renderResults();
      $("result-summary").textContent = number(result.scanned) + " total events before search / " +
        number(result.matched) + " matched before pipes / " + number(result.total) + " result rows" +
        (source ? " / Selected source" : " / All sources");
    } catch (error) {
      invalidateResults("Query failed. Correct the query before exporting or inspecting results.");
      $("query-error").textContent = messageOf(error);
      $("query-error").hidden = false;
      $("log-query").setAttribute("aria-invalid", "true");
    }
  }

  on("query-form", "submit", (event) => { event.preventDefault(); runQuery(); });
  on("log-file-filter", "change", runQuery);
  on("log-query", "input", () => {
    $("query-error").hidden = true;
    $("log-query").removeAttribute("aria-invalid");
    invalidateResults("Query changed. Run it to refresh the results and exports.");
  });
  document.querySelectorAll("[data-query]").forEach((button) => {
    button.addEventListener("click", () => {
      $("log-query").value = button.dataset.query;
      runQuery();
    });
  });
  on("page-prev", "click", () => { state.page -= 1; renderResults(); });
  on("page-next", "click", () => { state.page += 1; renderResults(); });

  function showRow(row) {
    $("row-dialog-title").textContent = row.file
      ? textValue(row.file) + (row.line ? " / Line " + row.line : "")
      : "Query result details";
    const fields = document.createDocumentFragment();
    Object.entries(row).forEach(([key, value]) => {
      if (key === "raw") return;
      fields.append(element("dt", "", key), element("dd", "", textValue(value)));
    });
    $("row-fields").replaceChildren(fields);
    $("row-raw").value = Object.prototype.hasOwnProperty.call(row, "raw")
      ? textValue(row.raw)
      : "This transformed result has no raw event. Run a query without aggregation or field projection to inspect source events.";
    $("row-dialog").showModal();
  }
  on("row-dialog-close", "click", () => $("row-dialog").close());
  on("row-dialog", "close", () => {
    $("row-fields").replaceChildren();
    $("row-raw").value = "";
  });

  const csvCell = core.csvCell;

  async function exportResults(format) {
    const result = state.result;
    if (!result || !result.rows.length) throw new Error("Run a query with results before exporting.");
    $("results-csv").disabled = true;
    $("results-json").disabled = true;
    try {
      await nextTask();
      if (format === "json") {
        download(JSON.stringify(result.rows, null, 2), "logops-results.json", "application/json;charset=utf-8");
      } else {
        const lines = [result.columns.map(csvCell).join(",")];
        for (let index = 0; index < result.rows.length; index += 1) {
          const row = result.rows[index];
          lines.push(result.columns.map((column) => csvCell(row[column])).join(","));
          if (index % 2000 === 1999) await nextTask();
        }
        download("\uFEFF" + lines.join("\r\n") + "\r\n", "logops-results.csv", "text/csv;charset=utf-8");
      }
    } finally {
      $("results-csv").disabled = !state.result || !state.result.rows.length;
      $("results-json").disabled = !state.result || !state.result.rows.length;
    }
  }
  on("results-csv", "click", () => exportResults("csv"));
  on("results-json", "click", () => exportResults("json"));

  const presets = {
    login: ["Failed password", "failed login", "authentication failure"],
    firewall: ["firewall deny", "Deny tcp", "Deny udp", "RT_FLOW_SESSION_DENY"],
    privilege: ["privilege escalation", "session opened for user root", "USER=root"]
  };

  function detectionOptions() {
    const patterns = [...new Set($("detection-patterns").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
    if (!patterns.length) throw new Error("Enter at least one nonempty literal phrase.");
    return {
      patterns,
      ignoreCase: $("detection-ignore-case").checked,
      throttle: Number($("detection-throttle").value)
    };
  }

  on("detection-form", "input", () => {
    invalidatePreview();
    if ($("detection-output").value) $("detection-state").textContent = "Rules changed - regenerate";
  });
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      $("detection-patterns").value = presets[button.dataset.preset].join("\n");
      $("detection-state").textContent = "Preset selected - generate";
      invalidatePreview();
      notify("Preset phrases selected. Generate the configuration or preview matches.");
    });
  });
  on("detection-form", "submit", (event) => {
    event.preventDefault();
    if (!$("detection-form").reportValidity()) return;
    const output = core.generateSwatch(detectionOptions());
    $("detection-output").value = output;
    $("detection-download").disabled = !output.trim();
    $("detection-state").textContent = "Generated / literal phrases";
    notify("Swatch configuration generated. Review it before running swatchdog on your host.");
  });
  bindOutput("detection-output", ["detection-download"], "detection-state");
  on("detection-download", "click", () => downloadEditor("detection-output", "swatchrc"));

  on("detection-preview", "click", async () => {
    if (state.load) throw new Error("Wait for the import to finish or cancel it before previewing detections.");
    if (!state.events.length) throw new Error("Load log files or the sample in Log explorer before previewing detections.");
    if (!$("detection-form").reportValidity()) return;
    const options = detectionOptions();
    const version = ++state.previewVersion;
    state.previewBusy = true;
    $("detection-preview").disabled = true;
    $("detection-preview-results").replaceChildren();
    const counts = options.patterns.map((pattern) => ({
      phrase: pattern, needle: options.ignoreCase ? pattern.toLowerCase() : pattern, events: 0, hits: 0
    }));
    let matchedEvents = 0;
    const samples = [];
    try {
      for (let index = 0; index < state.events.length; index += 1) {
        const raw = textValue(state.events[index].raw);
        const haystack = options.ignoreCase ? raw.toLowerCase() : raw;
        let matched = false;
        counts.forEach((count) => {
          let at = haystack.indexOf(count.needle);
          if (at !== -1) {
            count.events += 1;
            matched = true;
          }
          while (at !== -1) {
            count.hits += 1;
            at = haystack.indexOf(count.needle, at + count.needle.length);
          }
        });
        if (matched) {
          matchedEvents += 1;
          if (samples.length < 5) samples.push(raw.length > 600 ? raw.slice(0, 600) + "..." : raw);
        }
        if (index % 250 === 0) {
          $("detection-preview-summary").textContent = "Scanning " + number(index + 1) + " of " + number(state.events.length) + " loaded events...";
          await nextTask();
          // A new import or phrase edit invalidates this in-flight preview, with a visible status.
          if (version !== state.previewVersion) return;
        }
      }
      $("detection-preview-summary").textContent = number(matchedEvents) + " of " + number(state.events.length) +
        " loaded events match at least one phrase. Hits are non-overlapping occurrences per phrase; throttling is not simulated.";
      counts.forEach((count) => {
        const row = element("div", "preview-result");
        row.append(element("span", "", count.phrase), element("strong", "", number(count.events) + " events / " + number(count.hits) + " hits"));
        $("detection-preview-results").append(row);
      });
      if (samples.length) {
        $("detection-preview-results").append(element("p", "helper", "First " + samples.length + " matching events (long lines shortened):"));
        samples.forEach((sample) => $("detection-preview-results").append(element("pre", "preview-sample", sample)));
      }
    } finally {
      if (version === state.previewVersion) {
        state.previewBusy = false;
        $("detection-preview").disabled = Boolean(state.load);
      }
    }
  });

  on("maintenance-form", "input", () => {
    if ($("maintenance-logrotate").value || $("maintenance-backup").value) $("maintenance-state").textContent = "Policy changed - regenerate";
  });
  on("maintenance-form", "submit", (event) => {
    event.preventDefault();
    if (!$("maintenance-form").reportValidity()) return;
    const options = {
      logPath: $("maintenance-log-path").value,
      archiveDir: $("maintenance-archive-dir").value,
      rotate: Number($("maintenance-rotate").value),
      frequency: $("maintenance-frequency").value,
      maxSize: $("maintenance-max-size").value,
      compression: $("maintenance-compression").value,
      engine: $("maintenance-engine").value
    };
    const output = core.generateMaintenance(options);
    $("maintenance-logrotate").value = output.logrotate;
    $("maintenance-backup").value = output.backup;
    $("maintenance-logrotate-download").disabled = !output.logrotate.trim();
    $("maintenance-backup-download").disabled = !output.backup.trim();
    $("maintenance-state").textContent = "Generated / " + options.frequency;
    setNotes("maintenance-notes", output.notes);
    notify("Rotation policy and rotated-log backup generated. Review both before installing or scheduling them.");
  });
  bindOutput("maintenance-logrotate", ["maintenance-logrotate-download"], "maintenance-state");
  bindOutput("maintenance-backup", ["maintenance-backup-download"], "maintenance-state");
  on("maintenance-logrotate-download", "click", () => downloadEditor("maintenance-logrotate", "logops.logrotate"));
  on("maintenance-backup-download", "click", () => downloadEditor("maintenance-backup", "logops-backup.sh"));

  resetProfile();
  refreshMetrics();
})();
