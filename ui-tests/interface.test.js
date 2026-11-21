const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const hasDisplay =
  process.platform !== "linux" ||
  Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

test(
  "Electron interface remains accessible and usable",
  { skip: hasDisplay ? false : "Electron UI checks need a display" },
  () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mcbp-ui-test-"));
    try {
      const result = spawnSync(
        require("electron"),
        [path.join(__dirname, "interface.electron.js"), profile],
        {
          encoding: "utf8",
          timeout: 90000,
          env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
        },
      );
      assert.equal(
        result.status,
        0,
        [
          result.error?.message,
          result.stdout,
          (result.stderr || "")
            .split("\n")
            .filter((line) => !line.startsWith("Fontconfig warning:"))
            .join("\n"),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  },
);
