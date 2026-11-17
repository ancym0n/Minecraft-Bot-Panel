// Optional auto-update: checks the newest GitHub release and offers it. Never forced.
const { app, net, shell } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const REPO = "ancym0n/Minecraft-Bot-Panel";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const UA = { "User-Agent": "minecraft-bot-panel" };

let latest = null;
let installing = false;

function parse(v) {
  const m = String(v)
    .trim()
    .replace(/^(?:beta-)?v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/);
  return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] || "" } : null;
}

// true when `a` is a newer version than `b` (pre-releases rank below their final release)
function isNewer(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i];
  return !x.pre && !!y.pre;
}

// How this copy was installed decides which release file to fetch.
function installKind() {
  if (process.platform === "win32") return "nsis";
  if (process.platform === "darwin") return "dmg";
  if (process.platform !== "linux") return null;
  if (process.env.APPIMAGE) return "appimage";
  if (cachedKind !== undefined) return cachedKind;
  // deb/rpm/pacman installs: ask the package manager who owns this app.
  const pkg = "minecraft-bot-panel";
  const owned = (cmd, args) =>
    hasCommand(cmd) &&
    spawnSync(cmd, args, { stdio: "ignore", timeout: 4000 }).status === 0;
  if (owned("dpkg-query", ["-W", pkg])) cachedKind = "deb";
  else if (owned("rpm", ["-q", pkg])) cachedKind = "rpm";
  else if (owned("pacman", ["-Q", pkg])) cachedKind = "pacman";
  else cachedKind = null; // tar.gz / zip: open the release page instead
  return cachedKind;
}
let cachedKind;

function pickAsset(assets) {
  const find = (re) => assets.find((a) => re.test(a.name));
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  // Each format names the CPU differently (x64 / amd64 / x86_64).
  const a = arch === "arm64" ? "(arm64|aarch64)" : "(x64|amd64|x86_64)";
  switch (installKind()) {
    case "nsis":
      return find(/win\.x64-setup\.exe$/i);
    case "appimage":
      return find(/\.AppImage$/i);
    case "deb":
      return find(new RegExp(`linux\\.${a}\\.deb$`, "i"));
    case "rpm":
      return find(new RegExp(`linux\\.${a}\\.rpm$`, "i"));
    case "pacman":
      return find(new RegExp(`linux\\.${a}\\.pacman$`, "i"));
    case "dmg":
      return find(new RegExp(`mac\\.${arch}\\.dmg$`, "i"));
    default:
      return null;
  }
}

function hasCommand(cmd) {
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: "ignore" });
      child.on("error", () => resolve(127));
      child.on("close", (code) => resolve(code));
    } catch (_) {
      resolve(127);
    }
  });
}

// Installs a deb/rpm/pacman package with the system password prompt.
async function installLinuxPackage(kind, file) {
  if (!hasCommand("pkexec")) return false;
  const attempts = [];
  if (kind === "deb") {
    if (hasCommand("apt-get"))
      attempts.push(["apt-get", "install", "-y", "--allow-downgrades", file]);
    attempts.push(["dpkg", "-i", file]);
  } else if (kind === "rpm") {
    if (hasCommand("dnf")) attempts.push(["dnf", "install", "-y", file]);
    if (hasCommand("zypper"))
      attempts.push([
        "zypper",
        "--non-interactive",
        "install",
        "--allow-unsigned-rpm",
        file,
      ]);
    attempts.push(["rpm", "-U", "--replacepkgs", file]);
  } else if (kind === "pacman") {
    attempts.push(["pacman", "-U", "--noconfirm", file]);
  }
  for (const args of attempts) {
    const code = await run("pkexec", args);
    if (code === 0) return true;
    if (code === 126 || code === 127) return false; // prompt dismissed
  }
  return false;
}

// Leaves the file in Downloads and shows it so the user can install it.
function handOver(file) {
  try {
    const target = path.join(app.getPath("downloads"), path.basename(file));
    if (target !== file) {
      fs.copyFileSync(file, target);
      fs.rmSync(file, { force: true });
    }
    shell.showItemInFolder(target);
    return target;
  } catch (_) {
    shell.showItemInFolder(file);
    return file;
  }
}

async function getJson(url) {
  const res = await net.fetch(url, {
    headers: { ...UA, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function checkForUpdate() {
  try {
    const rel = await getJson(
      `https://api.github.com/repos/${REPO}/releases/latest`,
    );
    if (rel.draft || rel.prerelease || !isNewer(rel.tag_name, app.getVersion()))
      return (latest = null);
    const asset = pickAsset(rel.assets || []);
    latest = {
      version: String(rel.tag_name).replace(/^(?:beta-)?v/i, ""),
      page: rel.html_url,
      asset: asset && {
        name: asset.name,
        url: asset.browser_download_url,
        size: asset.size,
        digest: asset.digest,
      },
    };
    return { version: latest.version, direct: Boolean(latest.asset) };
  } catch (_) {
    return null; // offline / rate limited: silently try again later
  }
}

async function download(url, dest, onProgress) {
  const res = await net.fetch(url, { headers: UA });
  if (!res.ok || !res.body)
    throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(dest);
  let received = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      received += chunk.length;
      if (total) onProgress(received / total);
    }
    await new Promise((resolve, reject) =>
      out.end((e) => (e ? reject(e) : resolve())),
    );
  } catch (err) {
    out.destroy();
    fs.rmSync(dest, { force: true });
    throw err;
  }
  return hash.digest("hex");
}

// Resolves with "opened" (release page), or never returns when the app restarts / hands over to the installer.
async function installUpdate(onProgress) {
  if (!latest || installing) return "none";
  if (!latest.asset || !app.isPackaged) {
    shell.openExternal(latest.page);
    return "opened";
  }
  installing = true;
  const { asset } = latest;
  const kind = installKind();
  const dest =
    kind === "appimage"
      ? `${process.env.APPIMAGE}.download`
      : path.join(
          kind === "dmg" ? app.getPath("downloads") : os.tmpdir(),
          asset.name,
        );
  try {
    const sha = await download(asset.url, dest, onProgress);
    const expected = String(asset.digest || "").replace(/^sha256:/, "");
    if (expected && expected !== sha) throw new Error("Checksum mismatch");

    if (kind === "appimage") {
      fs.chmodSync(dest, 0o755);
      fs.renameSync(dest, process.env.APPIMAGE);
      app.relaunch({ execPath: process.env.APPIMAGE });
      app.exit(0);
      return "installing";
    }
    if (kind === "nsis") {
      spawn(dest, [], { detached: true, stdio: "ignore" }).unref();
      app.quit();
      return "installing";
    }
    if (kind === "dmg") {
      // Unsigned apps can't replace themselves; open the disk image instead.
      await shell.openPath(dest);
      installing = false;
      return "manual";
    }
    if (await installLinuxPackage(kind, dest)) {
      fs.rmSync(dest, { force: true });
      app.relaunch();
      app.exit(0);
      return "installing";
    }
    handOver(dest);
    installing = false;
    return "manual";
  } catch (_) {
    installing = false;
    fs.rmSync(dest, { force: true });
    shell.openExternal(latest.page); // fall back to a manual download
    return "opened";
  }
}

function start(onAvailable) {
  const run = async () => {
    const info = await checkForUpdate();
    if (info) onAvailable(info);
  };
  setTimeout(run, 4000);
  setInterval(run, CHECK_EVERY_MS).unref();
}

module.exports = { start, installUpdate, isNewer };
