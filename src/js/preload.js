const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  send: (channel, data) => {
    const validChannels = ["loginmicrosoft", "loginoffline"];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    const validChannels = ["fromMain"];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
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
  execJS: (func) => {
    ipcRenderer.send("exec-js", func);
  },
  onSetUsername: (callback) =>
    ipcRenderer.on("set-username", (event, username) => callback(username)),
  onSetAccount: (callback) =>
    ipcRenderer.on("set-account", (event, email, password) =>
      callback(email, password)
    ),
  onSetVersion: (callback) =>
    ipcRenderer.on("set-version", (event, version) => callback(version)),
  onLog: (callback) => ipcRenderer.on("log", (event, text) => callback(text)),
  onClearLog: (callback) =>
    ipcRenderer.on("clear-log", (event, text) => callback(text)),
  onChat: (callback) => ipcRenderer.on("chat", (event, text) => callback(text)),
  onScript: (callback) =>
    ipcRenderer.on("on-script", (event, html, scriptId) =>
      callback(html, scriptId)
    ),
  getOptionValue: (option, scriptName) => {
    const element = document.getElementById(`${option}-${scriptName}`);
    return element.value;
  },
  onScriptToggleOn: (scriptId) => {
    ipcRenderer.send("on-script-toggle-on", scriptId);
  },
  onScriptToggleOff: (scriptId) => {
    ipcRenderer.send("on-script-toggle-off", scriptId);
  },
});
