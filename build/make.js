// `npm run make [linux|win|mac]` builds every package the current OS can make.
// Linux: AppImage, deb, rpm, pacman, tar.gz + Windows installer.
// macOS: dmg + zip (Intel and Apple Silicon) + Linux AppImage/deb/tar.gz.
// Windows: installer + zip.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const host = process.platform;
const only = process.argv[2];

function has(cmd) {
  const probe = host === "win32" ? "where" : "which";
  return spawnSync(probe, [cmd], { stdio: "ignore" }).status === 0;
}

const linuxTargets = ["AppImage", "deb", "tar.gz"];
if (host === "linux") {
  if (has("rpmbuild")) linuxTargets.push("rpm");
  else console.log("• skipping rpm (install rpm-build / rpm to enable)");
  if (has("bsdtar")) linuxTargets.push("pacman");
  else console.log("• skipping pacman (install libarchive / bsdtar to enable)");
}

const plans = {
  linux: ["--linux", ...linuxTargets, "--x64"],
  win: ["--win", "nsis", "zip", "--x64"],
  mac: ["--mac", "dmg", "zip", "--x64", "--arm64"],
};

let wanted;
if (only) {
  if (!plans[only]) {
    console.error(`Unknown target "${only}". Use linux, win or mac.`);
    process.exit(1);
  }
  wanted = [only];
} else if (host === "darwin") {
  wanted = ["mac", "linux", "win"];
} else if (host === "win32") {
  wanted = ["win"];
} else {
  wanted = ["linux", "win"];
}

if (wanted.includes("mac") && host !== "darwin") {
  console.error(
    "macOS builds need a Mac (Apple's tools only run there). Run `npm run make:mac` on a Mac.",
  );
  process.exit(1);
}

require("./build-wasm");

const bin = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bin",
  host === "win32" ? "electron-builder.cmd" : "electron-builder",
);
if (!fs.existsSync(bin)) {
  console.error("electron-builder is missing, run `npm install` first.");
  process.exit(1);
}

for (const platform of wanted) {
  console.log(`\n▶ Building ${platform}: ${plans[platform].join(" ")}`);
  const res = spawnSync(bin, [...plans[platform], "--publish", "never"], {
    stdio: "inherit",
    shell: host === "win32",
  });
  if (res.status !== 0) process.exit(res.status || 1);
}
console.log("\n✔ Done, packages are in dist/");
