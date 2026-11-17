// Optional auto-update: checks the newest GitHub release and offers it. Never forced.
const { app, net, shell } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

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

function pickAsset(assets) {
  const find = (re) => assets.find((a) => re.test(a.name));
  if (process.platform === "win32") return find(/win\.x64-setup\.exe$/i);
  if (process.platform === "linux" && process.env.APPIMAGE)
    return find(/\.AppImage$/i);
  return null; // zip / dev / macOS builds: just open the release page
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
  const isLinux = process.platform === "linux";
  const dest = isLinux
    ? `${process.env.APPIMAGE}.download`
    : path.join(os.tmpdir(), asset.name);
  try {
    const sha = await download(asset.url, dest, onProgress);
    const expected = String(asset.digest || "").replace(/^sha256:/, "");
    if (expected && expected !== sha) throw new Error("Checksum mismatch");
    if (isLinux) {
      fs.chmodSync(dest, 0o755);
      fs.renameSync(dest, process.env.APPIMAGE);
      app.relaunch({ execPath: process.env.APPIMAGE });
      app.exit(0);
    } else {
      spawn(dest, [], { detached: true, stdio: "ignore" }).unref();
      app.quit();
    }
    return "installing";
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
