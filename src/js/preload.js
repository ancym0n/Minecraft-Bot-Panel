const { contextBridge, ipcRenderer } = require("electron");

function onChannel(channel, handler) {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, handler);
}

contextBridge.exposeInMainWorld("api", {
  send: (channel, data) => {
    const validChannels = [
      "loginmicrosoft",
      "loginoffline",
      "back-to-welcome",
      "open-custom-folder",
      "sync-mineflayer",
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    const validChannels = ["fromMain"];
    if (validChannels.includes(channel)) {
      onChannel(channel, (_event, ...args) => func(...args));
    }
  },
  serverConnect: (server) => {
    ipcRenderer.send("connect", server);
  },
  sendChatMessage: (chatMessage) => {
    ipcRenderer.send("send-chat-message", chatMessage);
  },
  serverDisconnect: () => {
    ipcRenderer.send("disconnect");
  },
  sendFormData: (formData) => {
    ipcRenderer.send("form-submission", formData);
  },
  backToWelcome: () => {
    ipcRenderer.send("back-to-welcome");
  },
  openExternal: (url) => {
    ipcRenderer.send("open-external", url);
  },
  openCustomFolder: () => {
    ipcRenderer.send("open-custom-folder");
  },
  syncMineflayer: () => {
    ipcRenderer.send("sync-mineflayer");
  },
  copyText: (text) => {
    ipcRenderer.send("copy-text", text);
  },
  // Microsoft Auth methods
  msaGetAccounts: () => ipcRenderer.invoke("msa-get-accounts"),
  msaStartLogin: (payload) => ipcRenderer.send("msa-start-login", payload),
  msaCancelLogin: () => ipcRenderer.send("msa-cancel-login"),
  msaOpenPopup: (payload) => ipcRenderer.send("msa-open-popup", payload),
  msaRemoveAccount: (accountId) =>
    ipcRenderer.invoke("msa-remove-account", accountId),
  onMsaCode: (callback) =>
    onChannel("msa-code", (_event, data) => callback(data)),
  onMsaStatus: (callback) =>
    onChannel("msa-status", (_event, data) => callback(data)),
  // Bot control & live inventory methods
  botControl: (payload) => {
    ipcRenderer.send("bot-control", payload);
  },
  inventoryAction: (payload) => {
    ipcRenderer.send("inventory-action", payload);
  },
  onBotTelemetry: (callback) =>
    onChannel("bot-telemetry", (_event, data) => callback(data)),
  onBotInventory: (callback) =>
    onChannel("bot-inventory", (_event, data) => callback(data)),
  // Standard panel events
  onSetUsername: (callback) =>
    onChannel("set-username", (_event, username) => callback(username)),
  onSetAccount: (callback) =>
    onChannel("set-account", (_event, email, mcName) =>
      callback(email, mcName),
    ),
  onSetVersion: (callback) =>
    onChannel("set-version", (_event, version) => callback(version)),
  onRuntimeInfo: (callback) =>
    onChannel("runtime-info", (_event, info) => callback(info)),
  onConnectionState: (callback) =>
    onChannel("connection-state", (_event, state) => callback(state)),
  onLog: (callback) => onChannel("log", (_event, text) => callback(text)),
  onClearLog: (callback) =>
    onChannel("clear-log", (_event, text) => callback(text)),
  onChat: (callback) => onChannel("chat", (_event, text) => callback(text)),
  onClearScripts: (callback) =>
    onChannel("clear-scripts", () => callback && callback()),
  onScript: (callback) =>
    onChannel("on-script", (_event, html, scriptId, meta) =>
      callback(html, scriptId, meta),
    ),
  onRemoveScript: (callback) =>
    onChannel("remove-script", (_event, scriptId) => callback(scriptId)),
  onScriptState: (callback) =>
    onChannel("script-state", (_event, scriptId, active) =>
      callback(scriptId, active),
    ),
  onCustomTheme: (callback) =>
    onChannel("custom-theme", (_event, cssText) => callback(cssText)),
  getOptionValue: (option, scriptName) => {
    const element = document.getElementById(`${option}-${scriptName}`);
    if (!element) return "";
    if (element.type === "checkbox") {
      return element.checked || element.value === "on" ? "on" : "off";
    }
    return element.value;
  },
  onScriptToggleOn: (scriptId) => {
    ipcRenderer.send("on-script-toggle-on", scriptId);
  },
  onScriptToggleOff: (scriptId) => {
    ipcRenderer.send("on-script-toggle-off", scriptId);
  },
  onUpdateAvailable: (cb) =>
    onChannel("update-available", (_e, info) => cb(info)),
  onUpdateProgress: (cb) => onChannel("update-progress", (_e, pct) => cb(pct)),
  onUpdateDone: (cb) => onChannel("update-done", (_e, result) => cb(result)),
  installUpdate: () => ipcRenderer.send("update-install"),
  // Ollama Chat AI methods
  ollamaGetStatus: () => ipcRenderer.invoke("ollama-get-status"),
  ollamaSaveConfig: (cfg) => ipcRenderer.invoke("ollama-save-config", cfg),
  ollamaAutoSetup: (payload) =>
    ipcRenderer.invoke("ollama-auto-setup", payload),
  ollamaPullModel: (modelName) =>
    ipcRenderer.invoke("ollama-pull-model", modelName),
  ollamaTestPrompt: (payload) =>
    ipcRenderer.invoke("ollama-test-prompt", payload),
  onOllamaStatus: (cb) =>
    onChannel("ollama-status", (_e, status) => cb(status)),
  onOllamaProgress: (cb) =>
    onChannel("ollama-progress", (_e, prog) => cb(prog)),
  // Script Studio methods
  studioGetInit: () => ipcRenderer.invoke("studio-get-init"),
  studioDocsDownload: (payload) =>
    ipcRenderer.invoke("studio-docs-download", payload || {}),
  studioDocsSearch: (query) => ipcRenderer.invoke("studio-docs-search", query),
  studioDocsSection: (id) => ipcRenderer.invoke("studio-docs-section", id),
  studioValidate: (code) => ipcRenderer.invoke("studio-validate", code),
  studioSave: (payload) => ipcRenderer.invoke("studio-save", payload),
  studioOpenScript: (file) => ipcRenderer.invoke("studio-open-script", file),
  studioGenerate: (payload) => ipcRenderer.invoke("studio-generate", payload),
  studioGenerateCancel: () => ipcRenderer.send("studio-generate-cancel"),
  onStudioDocsStatus: (cb) =>
    onChannel("studio-docs-status", (_e, status) => cb(status)),
  onStudioGenProgress: (cb) =>
    onChannel("studio-gen-progress", (_e, prog) => cb(prog)),
  // Session Markdown Logger methods
  sessionLogGetStatus: () => ipcRenderer.invoke("session-log-get-status"),
  openSessionLog: (filePath) =>
    ipcRenderer.send("open-session-log", filePath || ""),
  openLogsFolder: () => ipcRenderer.send("open-logs-folder"),
  recordUiEvent: (payload) => ipcRenderer.send("record-ui-event", payload),
  onSessionLogStatus: (cb) =>
    onChannel("session-log-status", (_e, status) => cb(status)),
});
