// Automatic Mineflayer & minecraft-data runtime manager.
// Ensures mineflayer, minecraft-data, and mineflayer-pathfinder are installed,
// automatically checks npm for newer releases so new Minecraft versions work
// out of the box, and exposes the live list of supported Minecraft versions.
const bufferModule = require("buffer");
if (!bufferModule.SlowBuffer) {
  bufferModule.SlowBuffer = bufferModule.Buffer;
}
const electron = process.versions.electron ? require("electron") : {};
const { app, BrowserWindow } = electron;
const { spawn } = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const Module = require("module");

const PACKAGES = ["mineflayer", "minecraft-data", "mineflayer-pathfinder"];
const UA = { "User-Agent": "minecraft-bot-panel" };

const appRoot = () => path.resolve(__dirname, "..", "..");
const runtimeDir = () =>
  app && typeof app.getPath === "function"
    ? path.join(app.getPath("userData"), "mineflayer-runtime")
    : path.join(appRoot(), "mineflayer-runtime");

function parseSemver(v) {
  const m = String(v || "")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/);
  return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] || "" } : null;
}

function isNewer(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i];
  return !x.pre && Boolean(y.pre);
}

function getExtraSearchDirs() {
  const home = os.homedir ? os.homedir() : process.env.HOME || "";
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const appData =
      process.env.APPDATA || path.join(home, "AppData", "Roaming");
    const localAppData =
      process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return [
      path.join(pf, "nodejs"),
      path.join(pf86, "nodejs"),
      path.join(localAppData, "Programs", "nodejs"),
      path.join(appData, "npm"),
      path.join(home, ".volta", "bin"),
      path.join(localAppData, "mise", "shims"),
    ];
  }
  return [
    path.join(home, ".local", "share", "mise", "shims"),
    path.join(home, ".local", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".asdf", "shims"),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
}

function findExecutable(binaryName) {
  const pathEnv = process.env.PATH || "";
  const pathExt =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".CMD;.EXE;.BAT").split(";")
      : [""];
  const dirs = [
    ...pathEnv.split(path.delimiter).filter(Boolean),
    ...getExtraSearchDirs(),
  ];
  for (const dir of dirs) {
    for (const ext of pathExt) {
      const full = path.join(dir, binaryName + ext);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch (_) {}
    }
  }
  return null;
}

function readPkgVersion(baseDir, pkgName) {
  try {
    const pkgJson = path.join(baseDir, "node_modules", pkgName, "package.json");
    if (!fs.existsSync(pkgJson)) return null;
    return JSON.parse(fs.readFileSync(pkgJson, "utf8")).version || null;
  } catch (_) {
    return null;
  }
}

function selectActiveBaseDir() {
  const userBase = runtimeDir();
  const bundledBase = appRoot();
  const userMf = readPkgVersion(userBase, "mineflayer");
  const bundledMf = readPkgVersion(bundledBase, "mineflayer");
  const userMcData = readPkgVersion(userBase, "minecraft-data");
  const bundledMcData = readPkgVersion(bundledBase, "minecraft-data");

  if (userMf && !bundledMf) return userBase;
  if (!userMf && bundledMf) return bundledBase;
  if (userMf && bundledMf) {
    if (isNewer(userMf, bundledMf)) return userBase;
    if (isNewer(userMcData, bundledMcData)) return userBase;
  }
  return bundledBase;
}

function createScopedRequire(baseDir) {
  if (!baseDir || baseDir === appRoot() || baseDir.includes(".asar")) {
    return require;
  }
  const pkgPath = path.join(baseDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    try {
      fs.mkdirSync(baseDir, { recursive: true });
      fs.writeFileSync(
        pkgPath,
        JSON.stringify({ name: "mcbp-runtime", private: true }, null, 2),
      );
    } catch (_) {}
  }
  try {
    return Module.createRequire(pkgPath);
  } catch (_) {
    return require;
  }
}

function loadLibraries() {
  const baseDir = selectActiveBaseDir();
  const req = createScopedRequire(baseDir);
  try {
    const mineflayer = req("mineflayer");
    const mcData = req("minecraft-data");
    const pathfinderPkg = req("mineflayer-pathfinder");
    const vec3Pkg = req("vec3");
    const Vec3 = vec3Pkg.Vec3 || vec3Pkg;
    let prismarineAuth = null;
    try {
      prismarineAuth = req("prismarine-auth");
    } catch (_) {
      try {
        prismarineAuth = require("prismarine-auth");
      } catch (_) {}
    }
    const libs = {
      baseDir,
      mineflayer,
      mcData,
      Vec3,
      pathfinder: pathfinderPkg.pathfinder,
      Movements: pathfinderPkg.Movements,
      goals: pathfinderPkg.goals,
      Authflow: prismarineAuth ? prismarineAuth.Authflow : null,
      Titles: prismarineAuth ? prismarineAuth.Titles : null,
    };
    global.mcbpRuntime = libs;
    return libs;
  } catch (_) {
    const mineflayer = require("mineflayer");
    const mcData = require("minecraft-data");
    const pathfinderPkg = require("mineflayer-pathfinder");
    const vec3Pkg = require("vec3");
    const Vec3 = vec3Pkg.Vec3 || vec3Pkg;
    let prismarineAuth = null;
    try {
      prismarineAuth = require("prismarine-auth");
    } catch (_) {}
    const libs = {
      baseDir: appRoot(),
      mineflayer,
      mcData,
      Vec3,
      pathfinder: pathfinderPkg.pathfinder,
      Movements: pathfinderPkg.Movements,
      goals: pathfinderPkg.goals,
      Authflow: prismarineAuth ? prismarineAuth.Authflow : null,
      Titles: prismarineAuth ? prismarineAuth.Titles : null,
    };
    global.mcbpRuntime = libs;
    return libs;
  }
}

function isInstalled() {
  try {
    const libs = loadLibraries();
    return Boolean(libs && libs.mineflayer && libs.mcData && libs.pathfinder);
  } catch (_) {
    return false;
  }
}

function compareMcVersions(a, b) {
  const pa = String(a)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function isSupportedReleaseVersion(v) {
  const str = String(v || "").trim();
  const m = str.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major === 1 && minor < 8) return false;
  return major >= 1;
}

function getRuntimeInfo() {
  try {
    const libs = loadLibraries();
    const base = libs.baseDir;
    const mineflayerVersion =
      readPkgVersion(base, "mineflayer") ||
      readPkgVersion(appRoot(), "mineflayer") ||
      "latest";
    const mcDataVersion =
      readPkgVersion(base, "minecraft-data") ||
      readPkgVersion(appRoot(), "minecraft-data") ||
      "latest";
    const pathfinderVersion =
      readPkgVersion(base, "mineflayer-pathfinder") ||
      readPkgVersion(appRoot(), "mineflayer-pathfinder") ||
      "latest";

    const versionSet = new Set();
    if (Array.isArray(libs.mineflayer.testedVersions)) {
      libs.mineflayer.testedVersions.forEach((v) => {
        if (isSupportedReleaseVersion(v)) versionSet.add(v);
      });
    }
    if (
      libs.mcData &&
      libs.mcData.supportedVersions &&
      Array.isArray(libs.mcData.supportedVersions.pc)
    ) {
      libs.mcData.supportedVersions.pc.forEach((v) => {
        if (isSupportedReleaseVersion(v)) versionSet.add(v);
      });
    }

    const supportedVersions = Array.from(versionSet).sort((a, b) =>
      compareMcVersions(b, a),
    );
    const minMcVersion =
      supportedVersions.length > 0
        ? supportedVersions[supportedVersions.length - 1]
        : "1.8";
    const maxMcVersion =
      supportedVersions.length > 0 ? supportedVersions[0] : "latest";

    return {
      mineflayerVersion,
      mcDataVersion,
      pathfinderVersion,
      supportedVersions,
      minMcVersion: minMcVersion.startsWith("1.8") ? "1.8" : minMcVersion,
      maxMcVersion,
      versionRange: `1.8 ➙ ${maxMcVersion}`,
    };
  } catch (_) {
    return {
      mineflayerVersion: "unknown",
      mcDataVersion: "unknown",
      pathfinderVersion: "unknown",
      supportedVersions: [],
      minMcVersion: "1.8",
      maxMcVersion: "latest",
      versionRange: "1.8 ➙ latest",
    };
  }
}

function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { ...UA, Accept: "application/json" }, timeout: timeoutMs },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.resume();
          return resolve(fetchJson(res.headers.location, timeoutMs));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("Request timed out"));
    });
    req.on("error", reject);
  });
}

async function checkNpmLatest() {
  const results = {};
  await Promise.all(
    PACKAGES.map(async (pkg) => {
      try {
        const data = await fetchJson(
          `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`,
        );
        if (data && data.version) results[pkg] = data.version;
      } catch (_) {}
    }),
  );
  return results;
}

function runNpmInstall(targetDir, pkgSpecs, onProgress) {
  return new Promise((resolve, reject) => {
    const npmBin = findExecutable(
      process.platform === "win32" ? "npm.cmd" : "npm",
    );
    if (!npmBin) {
      return reject(new Error("npm not found on system PATH"));
    }
    fs.mkdirSync(targetDir, { recursive: true });
    const pkgJsonPath = path.join(targetDir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      fs.writeFileSync(
        pkgJsonPath,
        JSON.stringify(
          {
            name: "mcbp-mineflayer-runtime",
            private: true,
            description: "Auto-managed Mineflayer runtime for MCBP",
          },
          null,
          2,
        ),
      );
    }

    if (onProgress) onProgress(0.25, `Installing ${pkgSpecs.join(", ")}...`);
    const args = [
      "install",
      "--prefix",
      targetDir,
      "--no-audit",
      "--no-fund",
      "--prefer-online",
      ...pkgSpecs,
    ];

    const extraDirs = getExtraSearchDirs().join(path.delimiter);
    const childEnv = {
      ...process.env,
      PATH: [process.env.PATH || "", extraDirs]
        .filter(Boolean)
        .join(path.delimiter),
    };
    if (process.platform === "linux" && process.env.APPDIR) {
      delete childEnv.LD_LIBRARY_PATH;
    }

    const child = spawn(npmBin, args, {
      cwd: targetDir,
      windowsHide: true,
      env: childEnv,
      shell: process.platform === "win32",
    });

    let tail = "";
    const collect = (d) => {
      tail = (tail + d.toString()).slice(-1500);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        if (onProgress) onProgress(1, "Mineflayer runtime ready!");
        resolve();
      } else {
        reject(new Error(`npm install exited with code ${code}\n${tail}`));
      }
    });
  });
}

function clearRuntimeRequireCache() {
  const prefixes = [runtimeDir(), path.join(appRoot(), "node_modules")];
  Object.keys(require.cache).forEach((key) => {
    if (
      prefixes.some((p) => key.startsWith(p)) &&
      (key.includes("mineflayer") ||
        key.includes("minecraft-data") ||
        key.includes("minecraft-protocol") ||
        key.includes("prismarine-"))
    ) {
      delete require.cache[key];
    }
  });
}

const PROGRESS_PAGE = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;height:100vh;display:flex;flex-direction:column;
align-items:center;justify-content:center;background:#15121c;color:#f0ebff;
font-family:Nunito,Poppins,'Segoe UI',Arial,sans-serif;padding:24px;text-align:center;user-select:none}
h1{font-size:20px;margin:0 0 6px;font-weight:800}p{margin:0 0 18px;color:#b197fc;font-size:13px;font-weight:700}
.bar{width:100%;height:12px;background:#211c2d;border:2px solid #6f4ee0;border-radius:8px;overflow:hidden}
#fill{height:100%;width:0;background:linear-gradient(90deg,#6f4ee0,#9171f8,#b197fc);
border-radius:6px;transition:width .25s}#step{margin-top:14px;font-size:13px;color:#d0bfff;min-height:34px;font-weight:700}
#err{color:#ff8585;font-size:12px;white-space:pre-wrap;max-height:90px;overflow:auto}
</style><h1>Setting up Mineflayer Runtime</h1>
<p>Downloading latest Mineflayer, minecraft-data &amp; pathfinder packages.<br>This ensures support for the newest Minecraft versions.</p>
<div class="bar"><div id="fill"></div></div><div id="step">Starting...</div><div id="err"></div>
<script>function set(p,t){document.getElementById('fill').style.width=(p*100)+'%';
document.getElementById('step').textContent=t}
function fail(m){document.getElementById('step').textContent='Setup failed';
document.getElementById('err').textContent=m}</script>`;

function openProgressWindow(iconPath) {
  if (!BrowserWindow) return null;
  const win = new BrowserWindow({
    width: 480,
    height: 280,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: "#15121c",
    icon: iconPath,
    title: "MCBP - Mineflayer Setup",
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win
    .loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(PROGRESS_PAGE),
    )
    .catch(() => {});
  const ready = new Promise((r) => win.webContents.once("did-finish-load", r));
  const call = async (fn, ...args) => {
    await ready;
    if (!win.isDestroyed())
      win.webContents
        .executeJavaScript(
          `${fn}(${args.map((a) => JSON.stringify(a)).join(",")})`,
        )
        .catch(() => {});
  };
  return {
    win,
    set: (p, t) => call("set", p, t),
    fail: (m) => call("fail", m),
  };
}

let pendingBootstrap = null;

async function ensureMineflayer(iconPath, onLog) {
  if (isInstalled()) return loadLibraries();
  if (pendingBootstrap) return pendingBootstrap;

  pendingBootstrap = (async () => {
    const ui = openProgressWindow(iconPath);
    const target = app && app.isPackaged ? runtimeDir() : appRoot();
    try {
      if (onLog)
        onLog("Mineflayer not found locally — downloading latest packages...");
      if (ui) await ui.set(0.1, "Checking npm registry...");
      const specs = PACKAGES.map((p) => `${p}@latest`);
      await runNpmInstall(target, specs, (pct, text) => {
        if (ui) ui.set(pct, text);
      });
      clearRuntimeRequireCache();
      await new Promise((r) => setTimeout(r, 400));
      return loadLibraries();
    } catch (err) {
      if (ui) {
        await ui.fail(String(err.message || err));
        await new Promise((r) => setTimeout(r, 4000));
      }
      throw err;
    } finally {
      pendingBootstrap = null;
      if (ui && !ui.win.isDestroyed()) ui.win.close();
    }
  })();

  return pendingBootstrap;
}

let updateInProgress = false;

async function syncLatestMineflayer({ onLog, onUpdated, force = false } = {}) {
  if (updateInProgress) return getRuntimeInfo();
  updateInProgress = true;
  try {
    const current = getRuntimeInfo();
    const latest = await checkNpmLatest();
    const toUpdate = [];

    if (
      latest["mineflayer"] &&
      (force || isNewer(latest["mineflayer"], current.mineflayerVersion))
    ) {
      toUpdate.push(`mineflayer@${latest["mineflayer"]}`);
    }
    if (
      latest["minecraft-data"] &&
      (force || isNewer(latest["minecraft-data"], current.mcDataVersion))
    ) {
      toUpdate.push(`minecraft-data@${latest["minecraft-data"]}`);
    }
    if (
      latest["mineflayer-pathfinder"] &&
      (force ||
        isNewer(latest["mineflayer-pathfinder"], current.pathfinderVersion))
    ) {
      toUpdate.push(`mineflayer-pathfinder@${latest["mineflayer-pathfinder"]}`);
    }

    if (toUpdate.length > 0) {
      const npmBin = findExecutable(
        process.platform === "win32" ? "npm.cmd" : "npm",
      );
      if (!npmBin) {
        return current;
      }
      if (onLog) {
        onLog(`Updating Mineflayer runtime (${toUpdate.join(", ")})...`);
      }
      const target = app && app.isPackaged ? runtimeDir() : appRoot();
      const allSpecs = PACKAGES.map(
        (pkg) => `${pkg}@${latest[pkg] || "latest"}`,
      );
      await runNpmInstall(target, allSpecs);
      clearRuntimeRequireCache();
      const updatedInfo = getRuntimeInfo();
      if (onLog) {
        onLog(
          `Mineflayer v${updatedInfo.mineflayerVersion} ready (MC ${updatedInfo.versionRange})`,
        );
      }
      if (onUpdated) onUpdated(updatedInfo);
      return updatedInfo;
    }

    return current;
  } catch (_) {
    return getRuntimeInfo();
  } finally {
    updateInProgress = false;
  }
}

module.exports = {
  loadLibraries,
  ensureMineflayer,
  syncLatestMineflayer,
  getRuntimeInfo,
  isNewer,
};
