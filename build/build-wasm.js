const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const target = fs.mkdtempSync(path.join(os.tmpdir(), "mcbp-wasm-build-"));
const args = [
  "build",
  "--manifest-path",
  path.join(root, "rust", "planner", "Cargo.toml"),
  "--target",
  "wasm32-unknown-unknown",
  "--target-dir",
  target,
  "--release",
];
const rustup = spawnSync("rustup", ["--version"], { stdio: "ignore" });
const rustc =
  rustup.status === 0
    ? spawnSync("rustup", ["which", "--toolchain", "stable", "rustc"], {
        encoding: "utf8",
      })
    : null;
const result =
  rustup.status === 0
    ? spawnSync("rustup", ["run", "stable", "cargo", ...args], {
        stdio: "inherit",
        env: {
          ...process.env,
          ...(rustc.status === 0 ? { RUSTC: rustc.stdout.trim() } : {}),
        },
      })
    : spawnSync("cargo", args, { stdio: "inherit" });
try {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      "Rust Wasm build failed; install the wasm32-unknown-unknown target",
    );
  }
  fs.copyFileSync(
    path.join(target, "wasm32-unknown-unknown", "release", "mcbp_planner.wasm"),
    path.join(root, "src", "js", "planner.wasm"),
  );
} finally {
  fs.rmSync(target, { recursive: true, force: true });
}
