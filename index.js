const { app, BrowserWindow, ipcMain } = require("electron");
let version = require("./package.json").version;
const path = require("path");
const fs = require("fs");
const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
if (require("electron-squirrel-startup")) return app.quit();

function checkForPort(serverAdress) {
  a = serverAdress.split(":");
  if (a[1])
    return {
      ip: a[0],
      port: a[1],
    };
  else
    return {
      ip: a[0],
      port: "",
    };
}

function createMainWindow() {
  let scriptFunctions = [];
  let activeScripts = [];
  let bot;
  function log(text) {
    mainWindow.webContents.send("log", text);
  }
  function clearLog(text) {
    mainWindow.webContents.send("clear-log", text);
  }

  function getOption(option, scriptName) {
    return new Promise((resolve, reject) => {
      mainWindow.webContents
        .executeJavaScript(
          `window.api.getOptionValue("${option}", "${scriptName}")`
        )
        .then((value) => {
          resolve(value);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  function loadScripts(directory, type) {
    let fullDirectory = path.join(__dirname, directory);
    fs.readdir(fullDirectory, (err, files) => {
      let scriptAmount = 0;
      files.forEach((file) => {
        if (file.includes(".js")) {
          scriptAmount += 1;
          let scriptDetails = require(path.join(fullDirectory, file));
          let scriptName = scriptDetails.info.name;
          let formattedHTML = `<div class="${scriptName}-script script-container"><p class="${scriptName}-name script-name">${scriptName}</p><form class="script-options">`;
          for (var i = 0; scriptDetails.info.options.length > i; i++) {
            let option = scriptDetails.info.options[i];
            if (option.type === "checkbox") {
              formattedHTML += `<div></div><input type="checkbox" id="${option.id}-${scriptName}" value="off" onclick="checkbox('${option.id}-${scriptName}')"/><label for="${option.id}-${scriptName}">${option.label}</label>`;
            } else if (option.type === "input") {
              formattedHTML += `<label for="${scriptName}-${scriptName}" style="display:block">${option.label}</label><input type="text" id="${option.id}-${scriptName}" class="script-text-input" spellcheck="false"/>`;
            }
          }
          formattedHTML += "</form></div>";
          mainWindow.webContents.send("on-script", formattedHTML, scriptName);

          scriptFunctions.push([
            scriptName,
            (gO) => {
              scriptDetails.script(
                bot,
                log,
                clearLog,
                getOption,
                (func, intervalNum) => {
                  return new Promise((resolve, reject) => {
                    let tI = setInterval(() => {
                      if (!activeScripts.includes(scriptName)) {
                        clearInterval(tI);
                        resolve(true);
                      } else {
                        func();
                      }
                    }, intervalNum);
                  });
                }
              );
            },
          ]);
        }
      });
      log(`Loaded ${type} (${scriptAmount}) scripts`);
      return;
    });
  }
  function loadAllScripts() {
    let defaultLoading = "Loading default scripts...";
    let customLoading = "Loading custom scripts...";
    log(defaultLoading);
    loadScripts("./src/js/scripts", "default");
    clearLog(defaultLoading);
    log(customLoading);
    loadScripts("./custom/scripts", "custom");
    clearLog(customLoading);
  }
  const mainWindow = new BrowserWindow({
    title: "MCBT v" + version,
    width: 800,
    height: 600,
    resizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "src/icons/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "src/js/preload.js"),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      devTools: true, // CHANGE TO FALSE
    },
  });

  mainWindow
    .loadFile(path.join(__dirname, `./src/views/welcomeScreen.html`))
    .then(() => {
      mainWindow.webContents.send("set-version", version);
    });
  ["microsoft", "offline"].forEach((e) => {
    ipcMain.on("login" + e, () => {
      mainWindow
        .loadFile(path.join(__dirname, `./src/views/${e}.html`))
        .then(() => {
          mainWindow.webContents.send("set-version", version);
        });
    });
  });
  ipcMain.on("form-submission", (event, data) => {
    if (data.username) {
      mainWindow
        .loadFile(path.join(__dirname, "./src/views/panel.html"))
        .then(() => {
          log("Welcome to MCBP!");
          log("https://github.com/ancym0n");
          mainWindow.webContents.send("set-username", data.username);
          mainWindow.webContents.send("set-version", version);
          loadAllScripts();
        });
    } else if (data.email && data.password) {
      mainWindow
        .loadFile(path.join(__dirname, "./src/views/panel.html"))
        .then(() => {
          mainWindow.webContents.send("set-account", data.email, data.password);
          mainWindow.webContents.send("set-version", version);
        });
    }
  });
  ipcMain.on("connect", (event, server) => {
    let adress = checkForPort(server.ip);
    log(`Connecting to ${server.ip}`);
    if (server.auth) {
      bot = mineflayer.createBot({
        host: adress.ip,
        port: parseInt(adress.port),
        version: server.version,
        username: server.username,
        password: server.password,
        auth: server.auth,
      });
    } else {
      bot = mineflayer.createBot({
        host: adress.ip,
        port: parseInt(adress.port),
        version: server.version,
        username: server.username,
        password: server.password,
        auth: server.auth,
      });
    }
    bot.loadPlugin(pathfinder);
    bot.on("spawn", () => {
      mcData = require("minecraft-data")(bot.version);
      let movement = new Movements(bot, mcData);
      bot.pathfinder.setMovements(movement);
      log(`Connected as ${bot.username}`);
    });
    bot.on("messagestr", (message) => {
      mainWindow.webContents.send("chat", message);
    });
    bot.on("end", () => {
      log(`Bot disconnected`);
    });
    bot.on("disconnect", () => {
      log(`Bot disconnected`);
    });
  });
  ipcMain.on("disconnect", () => {
    bot.end();
  });

  ipcMain.on("send-chat-message", (event, chatMessage) => {
    bot.chat(chatMessage);
  });
  ipcMain.on("exec-js", (event, func) => {
    mainWindow.webContents
      .executeJavaScript(`eval(${"`" + func + "`"})`)
      .then((value) => {
        resolve(value);
      })
      .catch((err) => {
        reject(err);
      });
  });
  ipcMain.on("on-script-toggle-on", (event, scriptId) => {
    for (var i = 0; i < scriptFunctions.length; i++) {
      currentScript = scriptFunctions[i];
      if (currentScript[0] === scriptId) {
        currentScript[1](getOption);
        activeScripts.push(scriptId);
        let tempLogText = "Toggled on ";
        clearLog(tempLogText);
        log(tempLogText + scriptId);
      }
    }
  });
  ipcMain.on("on-script-toggle-off", (event, scriptId) => {
    for (var i = 0; i < activeScripts.length; i++) {
      currentScript = activeScripts[i];
      if (currentScript === scriptId) {
        let tempLogText = "Toggled off ";
        activeScripts = activeScripts.filter((scr) => scr !== scriptId);
        clearLog(tempLogText);
        log(tempLogText + scriptId);
      }
    }
  });
}

app.on("ready", createMainWindow);
