const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, session } = require("electron");

const root = path.join(__dirname, "..");
app.setPath("userData", process.argv[2]);
app.commandLine.appendSwitch("disable-gpu");

const events = { login: [], forms: [], scripts: [], saves: [], copied: [] };
let historyReads = 0;
let historyFixture = null;
let aiStatus = null;
let proxyStatus = { proxies: [], config: { enabled: false } };
let bottingStatus = { bots: [], onlineCount: 0, totalCount: 0 };
const handlers = {
  "msa-get-accounts": () => [
    { id: "long-fixture-account-name@example.test", mcName: "ExamplePlayer" },
  ],
  "ollama-get-status": () => aiStatus,
  "session-log-get-status": () => ({ eventCount: 0 }),
  "session-log-read-history": (_event, request) => {
    if (request.type === "logs") {
      historyReads++;
      if (historyFixture) {
        const entries = historyFixture.shift() || [];
        return { entries, hasMore: historyFixture.length > 0 };
      }
      return {
        entries: [{ raw: "System: disk history", time: "00:00:00" }],
        hasMore: false,
      };
    }
    return { entries: [], hasMore: false };
  },
  "ai-brain-get-status": () => null,
  "proxy-get-status": () => proxyStatus,
  "proxy-save-config": (_event, config) => ({ proxies: [], config }),
  "botting-get-status": () => bottingStatus,
  "studio-get-init": () => ({
    templates: [],
    customScripts: [],
    docs: { source: "bundled", sections: 0 },
  }),
  "studio-docs-search": () => [],
  "studio-validate": () => ({ ok: true, name: "Fixture" }),
  "studio-save": (_event, payload) => {
    events.saves.push(payload);
    return { ok: true, file: `${payload.file}.js`, name: "Fixture" };
  },
};

for (const [channel, handler] of Object.entries(handlers)) {
  ipcMain.handle(channel, handler);
}
for (const channel of ["loginmicrosoft", "loginoffline", "back-to-welcome"]) {
  ipcMain.on(channel, () => events.login.push(channel));
}
ipcMain.on("form-submission", (_event, value) => events.forms.push(value));
ipcMain.on("copy-text", (_event, value) => events.copied.push(value));
ipcMain.on("on-script-toggle-on", (_event, name) =>
  events.scripts.push(["on", name]),
);
ipcMain.on("on-script-toggle-off", (_event, name) =>
  events.scripts.push(["off", name]),
);

const wait = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

function contrast(foreground, background) {
  function luminance(color) {
    const components = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number);
    const linear = components.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
  const win = new BrowserWindow({
    width: 1100,
    height: 740,
    useContentSize: true,
    show: false,
    webPreferences: {
      preload: path.join(root, "src/js/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const rendererErrors = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3 && !message.includes("ERR_BLOCKED_BY_CLIENT")) {
      rendererErrors.push(message);
    }
  });

  const evaluate = (source) => win.webContents.executeJavaScript(source);
  const open = async (page) => {
    await win.loadFile(path.join(root, "src/views", `${page}.html`));
    await wait(200);
  };
  const key = async (selector, value) => {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(value)}, bubbles: true, cancelable: true }))`,
    );
    await wait(60);
  };
  const activateButton = async (selector) => {
    const focusable = await evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      button.focus();
      const focused = document.activeElement === button && button.tagName === "BUTTON";
      button.click();
      return focused;
    })()`);
    assert.equal(focusable, true, `${selector} must be a focusable button`);
    await wait(100);
  };

  try {
    await open("welcomeScreen");
    assert.equal(
      await evaluate('document.querySelector("#offline").tagName'),
      "BUTTON",
    );
    await activateButton("#offline");
    assert.deepEqual(events.login, ["loginoffline"]);

    await open("offline");
    await evaluate('document.querySelector("#username").value = "FixtureBot"');
    await activateButton("#continue");
    assert.deepEqual(events.forms, [{ username: "FixtureBot" }]);
    await activateButton("#back-btn");
    assert.equal(events.login.at(-1), "back-to-welcome");

    await open("microsoft");
    win.webContents.send("msa-code", { userCode: "ABCD-EFGH" });
    await wait();
    assert.match(
      await evaluate(
        'document.querySelector("#msa-code-value").getAttribute("aria-label")',
      ),
      /ABCD-EFGH/,
    );
    await activateButton("#msa-code-value");
    assert.equal(events.copied.at(-1), "ABCD-EFGH");
    const loginError = `Authentication failed: ${"x".repeat(200)}`;
    win.webContents.send("msa-status", { state: "error", message: loginError });
    await wait();
    assert.equal(
      await evaluate(
        'document.querySelector("#msa-status-text").classList.contains("status-error")',
      ),
      true,
    );
    win.setContentSize(420, 520);
    for (const zoom of [1, 1.25, 2]) {
      win.webContents.setZoomFactor(zoom);
      await wait();
      const loginLayout = await evaluate(`(() => {
        const status = document.querySelector("#msa-status-text");
        return {
          text: status.textContent,
          statusOverflow: status.scrollWidth - status.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      })()`);
      assert.equal(loginLayout.text, `Auth error: ${loginError}`);
      assert.ok(
        loginLayout.statusOverflow <= 1,
        `login error overflows at ${zoom}x`,
      );
      assert.ok(
        loginLayout.pageOverflow <= 1,
        `login page overflows at ${zoom}x`,
      );
    }
    win.webContents.setZoomFactor(1);
    win.setContentSize(1100, 740);

    await open("panel");
    await evaluate(`localStorage.setItem("mcbp-server-profiles-v1", JSON.stringify([
      { ip: "one.example.test", version: "1.18.2", modules: [] },
      { ip: "two.example.test", version: "1.20.4", modules: [] }
    ])); localStorage.setItem("mcbp-last-server-v1", "one.example.test")`);
    await win.webContents.reloadIgnoringCache();
    await wait(250);

    await key("#ip", "ArrowDown");
    await key("#ip", "ArrowDown");
    assert.equal(
      await evaluate(
        'document.querySelector("#ip").getAttribute("aria-expanded")',
      ),
      "true",
    );
    await key("#ip", "Enter");
    assert.deepEqual(
      await evaluate(`({
        ip: document.querySelector("#ip").value,
        version: document.querySelector("#version").value,
        saved: localStorage.getItem("mcbp-last-server-v1")
      })`),
      { ip: "two.example.test", version: "1.20.4", saved: "two.example.test" },
    );
    await key("#ip", "ArrowDown");
    await key("#ip", "ArrowDown");
    await key("#ip", "Delete");
    assert.deepEqual(
      await evaluate(
        'JSON.parse(localStorage.getItem("mcbp-server-profiles-v1")).map(p => p.ip)',
      ),
      ["two.example.test"],
    );
    await key("#ip", "Escape");
    assert.equal(
      await evaluate(
        'document.querySelector("#ip").getAttribute("aria-expanded")',
      ),
      "false",
    );

    await key('.workspace-tab[data-tab="scripts"]', "ArrowRight");
    assert.deepEqual(
      await evaluate(`({
        selected: document.querySelector(".workspace-tab[aria-selected=true]").dataset.tab,
        focused: document.activeElement.dataset.tab,
        panelVisible: !document.querySelector("#tab-control").hidden
      })`),
      { selected: "control", focused: "control", panelVisible: true },
    );
    await key('.workspace-tab[data-tab="control"]', "Home");
    assert.equal(
      await evaluate("document.activeElement.dataset.tab"),
      "scripts",
    );
    await key('.console-tab[data-console-tab="logs"]', "End");
    assert.deepEqual(
      await evaluate(`({
        selected: document.querySelector(".console-tab[aria-selected=true]").dataset.consoleTab,
        focused: document.activeElement.dataset.consoleTab,
        paneVisible: !document.querySelector("#console-chat").hidden
      })`),
      { selected: "chat", focused: "chat", paneVisible: true },
    );
    await key('.console-tab[data-console-tab="chat"]', "Home");
    await activateButton("#main-proxy-toggle");
    assert.equal(
      await evaluate(
        'document.querySelector("#main-proxy-toggle").getAttribute("aria-pressed")',
      ),
      "true",
    );

    const scriptHtml =
      '<div class="script-container" data-script="Fixture"><button type="button" class="script-name" data-script="Fixture" aria-pressed="false">Fixture with a long script name</button><form class="script-options"><label class="script-checkbox-row"><input type="checkbox" id="fixture-option"><span>Use an option</span></label></form></div>';
    win.webContents.send("on-script", scriptHtml, "Fixture", {});
    await wait();
    await activateButton(".script-name");
    assert.deepEqual(events.scripts.at(-1), ["on", "Fixture"]);
    assert.equal(
      await evaluate(
        'document.querySelector(".script-name").getAttribute("aria-pressed")',
      ),
      "true",
    );
    await activateButton(".script-gear");
    assert.equal(
      await evaluate(
        'document.querySelector(".script-gear").getAttribute("aria-expanded")',
      ),
      "true",
    );
    win.webContents.send("on-script", scriptHtml, "Fixture", {});
    await wait();
    assert.equal(
      await evaluate(
        'document.querySelector(".script-gear").getAttribute("aria-expanded")',
      ),
      "true",
    );
    win.webContents.send("script-state", "Fixture", false);
    await wait();
    assert.equal(
      await evaluate(
        'document.querySelector(".script-name").getAttribute("aria-pressed")',
      ),
      "false",
    );
    win.webContents.send("bot-telemetry", {
      connected: true,
      health: 18,
      food: 19,
      position: { x: 123, y: 64, z: -456 },
      yaw: 0,
      pitch: 0,
      nearbyPlayers: [
        { username: "LongPlayerName16", distance: 23, inRange: true },
      ],
      nearbyEntities: [{ id: 1, name: "zombie", distance: 9 }],
      nearbySigns: [
        {
          x: 1,
          y: 64,
          z: 2,
          distance: 8,
          lines: ["Fixture" + "long".repeat(35)],
        },
      ],
    });
    proxyStatus = {
      config: { enabled: true },
      workingCount: 1,
      proxies: [
        {
          id: "fixture",
          host: "long-proxy-host.example.test",
          port: 1080,
          protocol: "socks5",
          status: "working",
          latencyMs: 42,
        },
      ],
    };
    bottingStatus = {
      onlineCount: 1,
      totalCount: 1,
      bots: [
        {
          id: "fixture",
          username: "LongBotName12345",
          state: "online",
          health: 18,
          proxy: "long-proxy-host.example.test:1080",
          task: "A long running test task",
          position: { x: 123, y: 64, z: -456 },
        },
      ],
    };
    aiStatus = {
      installed: true,
      serverRunning: true,
      hardware: {
        catalog: [
          {
            name: "deepseek-v4-pro",
            sizeLabel: "cloud",
            tags: ["chat", "tools", "code"],
          },
        ],
        recommendedModel: "deepseek-v4-pro",
        recommendedCodeModel: "deepseek-v4-pro",
      },
      installedModels: [{ name: "deepseek-v4-pro", sizeLabel: "cloud" }],
      config: { provider: "deepseek", model: "deepseek-v4-pro" },
      deepseek: {
        hasKey: true,
        keyHint: "fixture",
        usage: {
          requests: 2,
          inputTokens: 10,
          outputTokens: 5,
          cacheHitPct: 50,
        },
      },
    };
    win.webContents.send("ollama-status", aiStatus);
    await wait();
    assert.match(
      await evaluate(
        'document.querySelector("#radar-players-list").textContent',
      ),
      /LongPlayerName16/,
    );
    assert.match(
      await evaluate('document.querySelector("#radar-signs-list").textContent'),
      /Fixturelong/,
    );
    await evaluate(
      'document.querySelector(".workspace-tab[data-tab=botting]").click()',
    );
    await wait();
    assert.match(
      await evaluate(
        'document.querySelector("#botting-bots-list").textContent',
      ),
      /LongBotName12345/,
    );
    assert.match(
      await evaluate('document.querySelector("#proxy-list").textContent'),
      /long-proxy-host\.example\.test/,
    );
    await evaluate(
      'document.querySelector(".workspace-tab[data-tab=ai]").click()',
    );
    await wait();
    assert.equal(
      await evaluate('document.querySelector("#ai-ds-note").hidden'),
      false,
    );

    const colors = await evaluate(`(() => {
      const button = getComputedStyle(document.querySelector("#connect"));
      const label = getComputedStyle(document.querySelector('label[for="ip"]'));
      const card = getComputedStyle(document.querySelector(".connect-card"));
      return { buttonText: button.color, buttonBg: button.backgroundColor,
        labelText: label.color, cardBg: card.backgroundColor };
    })()`);
    assert.ok(contrast(colors.buttonText, colors.buttonBg) >= 4.5);
    assert.ok(contrast(colors.labelText, colors.cardBg) >= 4.5);

    win.webContents.send("log", "System: §aGreen  spaces\nnext <img src=x>");
    await wait(80);
    assert.deepEqual(
      await evaluate(`(() => {
        const row = document.querySelector(".log-line");
        const msg = row.querySelector(".log-msg");
        return { fresh: row.classList.contains("line-enter"),
          whitespace: getComputedStyle(msg).whiteSpace, text: msg.textContent,
          color: msg.querySelector(".mc-seg").style.color,
          images: msg.querySelectorAll("img").length };
      })()`),
      {
        fresh: true,
        whitespace: "pre-wrap",
        text: "Green  spaces\nnext <img src=x>",
        color: "rgb(85, 255, 85)",
        images: 0,
      },
    );
    win.webContents.send("chat", {
      text: "Gold  text\nnext",
      segments: [{ text: "Gold  text\nnext", color: "gold", bold: true }],
    });
    await wait();
    assert.deepEqual(
      await evaluate(`(() => {
        const msg = document.querySelector(".chat-msg");
        const segment = msg.querySelector(".mc-seg");
        return { whitespace: getComputedStyle(msg).whiteSpace, text: msg.textContent,
          color: segment.style.color, bold: segment.classList.contains("mc-bold") };
      })()`),
      {
        whitespace: "pre-wrap",
        text: "Gold  text\nnext",
        color: "rgb(255, 170, 0)",
        bold: true,
      },
    );

    for (let i = 0; i < 260; i++)
      win.webContents.send("log", `System: history ${i}`);
    await wait(350);
    await evaluate('document.querySelector(".pre-logs").scrollTop = 0');
    await wait(400);
    const history = await evaluate(`(() => {
      const scroller = document.querySelector(".pre-logs");
      const row = [...scroller.querySelectorAll(".log-line")].find(el => el.dataset.raw === "System: disk history");
      return { found: !!row, animated: row?.classList.contains("line-enter"), scrollTop: scroller.scrollTop };
    })()`);
    assert.ok(historyReads > 0 && history.found);
    assert.equal(history.animated, false);
    assert.ok(
      history.scrollTop > 0,
      "prepending history preserves the visible position",
    );
    win.webContents.send("log", "System: arrived while reading history");
    await wait();
    assert.equal(
      await evaluate('document.querySelector("#logs-jump-live").hidden'),
      false,
    );
    await evaluate('document.querySelector("#logs-jump-live").click()');
    await wait();
    assert.equal(
      await evaluate(
        'document.querySelector(".pre-logs .log-line:last-child").dataset.raw',
      ),
      "System: arrived while reading history",
    );
    await evaluate(`(() => {
      const input = document.querySelector("#log-filter");
      input.value = "arrived while";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    assert.equal(
      await evaluate(
        'document.querySelectorAll(".pre-logs .line-enter").length',
      ),
      0,
    );

    await evaluate(
      'document.querySelector(".workspace-tab[data-tab=studio]").click()',
    );
    await key('.studio-view-tab[data-studio-view="editor"]', "End");
    assert.deepEqual(
      await evaluate(`({
        selected: document.querySelector(".studio-view-tab[aria-selected=true]").dataset.studioView,
        focused: document.activeElement.dataset.studioView,
        paneVisible: !document.querySelector("#studio-view-docs").hidden
      })`),
      { selected: "docs", focused: "docs", paneVisible: true },
    );
    await key('.studio-view-tab[data-studio-view="docs"]', "Home");
    const code = `// ${"long".repeat(150)}\n${Array.from({ length: 60 }, (_, i) => `// line ${i}`).join("\n")}`;
    await evaluate(`(() => {
      const editor = document.querySelector("#studio-editor");
      editor.value = ${JSON.stringify(code)};
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#studio-filename").value = "ui-fixture";
      editor.scrollTop = editor.scrollHeight;
      editor.dispatchEvent(new Event("scroll"));
    })()`);
    await wait(100);
    const editorState = await evaluate(`(() => {
      const editor = document.querySelector("#studio-editor");
      return { wrap: editor.getAttribute("wrap"), horizontal: editor.scrollWidth > editor.clientWidth,
        editorScroll: editor.scrollTop, gutterScroll: document.querySelector("#studio-gutter").scrollTop };
    })()`);
    assert.equal(editorState.wrap, "off");
    assert.equal(editorState.horizontal, true);
    assert.ok(editorState.editorScroll > 0);
    assert.equal(editorState.gutterScroll, editorState.editorScroll);
    await evaluate('document.querySelector("#studio-save-btn").click()');
    await wait();
    assert.equal(events.saves.at(-1).code, code);
    assert.equal(events.saves.at(-1).file, "ui-fixture");
    assert.match(
      await evaluate('document.querySelector("#studio-check").textContent'),
      /Saved ui-fixture\.js/,
    );

    const sizes = [
      [420, 520, 1],
      [640, 600, 1],
      [641, 621, 1],
      [880, 720, 1],
      [881, 720, 1],
      [1100, 620, 1],
      [1100, 740, 1],
      [1440, 900, 1],
      [420, 520, 1.25],
      [420, 520, 2],
    ];
    for (const [width, height, zoom] of sizes) {
      win.setContentSize(width, height);
      win.webContents.setZoomFactor(zoom);
      await wait(120);
      for (const tab of [
        "scripts",
        "control",
        "inventory",
        "ai",
        "botting",
        "studio",
      ]) {
        await evaluate(
          `document.querySelector('.workspace-tab[data-tab="${tab}"]').click()`,
        );
        await wait(35);
        const layout = await evaluate(`(() => {
          const pane = document.querySelector("#tab-${tab}");
          const right = pane.getBoundingClientRect().left + pane.clientLeft + pane.clientWidth;
          return {
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            paneOverflow: pane.scrollWidth - pane.clientWidth,
            inaccessibleOverflow: pane.scrollHeight > pane.clientHeight + 1 &&
              !["auto", "scroll"].includes(getComputedStyle(pane).overflowY),
            overflowers: [...pane.querySelectorAll("*")].filter(el =>
              el.getClientRects().length && el.getBoundingClientRect().right > right + 1
            ).slice(0, 12).map(el => ({
              id: el.id, className: el.className, tag: el.tagName,
              right: Math.round(el.getBoundingClientRect().right - right)
            })),
            innerOverflowers: [...pane.querySelectorAll("*")].filter(el =>
              el.getClientRects().length && el.scrollWidth > el.clientWidth + 1
            ).slice(0, 12).map(el => ({
              id: el.id, className: el.className, tag: el.tagName,
              extra: el.scrollWidth - el.clientWidth
            })),
            unnamed: [...pane.querySelectorAll("button, input, textarea, select")]
              .filter(el => el.getClientRects().length && el.type !== "hidden")
              .filter(el => !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")
                && !el.title && !(el.labels && [...el.labels].some(label => label.textContent.trim()))
                && !(el.tagName === "BUTTON" && el.textContent.trim())
                && !(el.closest("label") && el.closest("label").textContent.trim()))
              .map(el => el.id || el.className),
            smallInputs: [...pane.querySelectorAll("input:not([type=checkbox]), textarea")]
              .filter(el => el.getClientRects().length && parseFloat(getComputedStyle(el).fontSize) < 14)
              .map(el => el.id || el.className),
            clippedRadarControls: [...pane.querySelectorAll(".radar-list button")]
              .filter(el => el.getClientRects().length)
              .filter(el => {
                const list = el.closest(".radar-list");
                const left = list.getBoundingClientRect().left + list.clientLeft;
                const rect = el.getBoundingClientRect();
                return rect.left < left - 1 || rect.right > left + list.clientWidth + 1;
              })
              .map(el => el.textContent.trim()),
            clippedRadarText: [...pane.querySelectorAll(".radar-item-info, .radar-item-name, .radar-dist, .radar-item-info .ai-model-badge")]
              .filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1)
              .map(el => ({ text: el.textContent.trim(), extra: el.scrollWidth - el.clientWidth }))
          };
        })()`);
        assert.ok(
          layout.pageOverflow <= 1,
          `${width}x${height} zoom ${zoom} ${tab}: page overflow ${layout.pageOverflow}`,
        );
        assert.ok(
          layout.paneOverflow <= 1,
          `${width}x${height} zoom ${zoom} ${tab}: pane overflow ${layout.paneOverflow} ${JSON.stringify(layout.overflowers)} ${JSON.stringify(layout.innerOverflowers)}`,
        );
        assert.equal(
          layout.inaccessibleOverflow,
          false,
          `${width}x${height} zoom ${zoom} ${tab}: inaccessible content`,
        );
        assert.deepEqual(layout.unnamed, [], `${tab}: controls need labels`);
        assert.deepEqual(
          layout.smallInputs,
          [],
          `${tab}: inputs are too small`,
        );
        assert.deepEqual(
          layout.clippedRadarControls,
          [],
          `${width}x${height} zoom ${zoom} ${tab}: clipped radar buttons`,
        );
        assert.deepEqual(
          layout.clippedRadarText,
          [],
          `${width}x${height} zoom ${zoom} ${tab}: clipped radar text`,
        );
      }
      for (const [tab, target] of [
        ["botting", "#proxy-add-btn"],
        ["studio", "#studio-save-btn"],
      ]) {
        await evaluate(`(() => {
          document.querySelector('.workspace-tab[data-tab="${tab}"]').click();
          const pane = document.querySelector("#tab-${tab}");
          pane.style.scrollBehavior = "auto";
          pane.scrollTop = pane.scrollHeight;
        })()`);
        await wait(60);
        const reachable = await evaluate(`(() => {
          const pane = document.querySelector("#tab-${tab}").getBoundingClientRect();
          const target = document.querySelector("${target}").getBoundingClientRect();
          return target.top >= pane.top - 1 && target.bottom <= pane.bottom + 1 &&
            target.left >= pane.left - 1 && target.right <= pane.right + 1;
        })()`);
        assert.equal(
          reachable,
          true,
          `${width}x${height} zoom ${zoom}: ${target} is clipped`,
        );
      }
    }

    win.webContents.setZoomFactor(1);
    win.setContentSize(1100, 740);
    win.webContents.send(
      "custom-theme",
      ":root { --panel-bg: rgb(18, 34, 51); --main-color: rgb(240, 232, 200); }",
    );
    await wait();
    assert.equal(
      await evaluate(
        'getComputedStyle(document.querySelector(".connect-card")).backgroundColor',
      ),
      "rgb(18, 34, 51)",
    );

    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await evaluate(
      'document.querySelector("#log-filter").value = ""; document.querySelector("#log-filter").dispatchEvent(new Event("input", { bubbles: true }))',
    );
    win.webContents.send("log", "System: reduced-motion entry");
    await wait(80);
    assert.equal(
      await evaluate(
        'getComputedStyle(document.querySelector(".pre-logs .log-line:last-child")).animationName',
      ),
      "none",
    );
    await open("welcomeScreen");
    assert.deepEqual(
      await evaluate(
        `["#banner-logo", ".auth-card", "#credit"].map(selector => getComputedStyle(document.querySelector(selector)).opacity)`,
      ),
      ["1", "1", "1"],
    );
    win.webContents.debugger.detach();
    historyFixture = [
      [{ raw: "unrelated first page", time: "00:00:00" }],
      [{ raw: "unrelated second page", time: "00:00:00" }],
      [{ raw: "older unique matching entry", time: "00:00:00" }],
    ];
    await open("panel");
    await evaluate(`(() => {
      const input = document.querySelector("#log-filter");
      input.value = "unique matching";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await wait(400);
    assert.equal(
      await evaluate(
        `!!document.querySelector('.pre-logs .log-line[data-raw="older unique matching entry"]')`,
      ),
      true,
      "filter must search multiple older pages even without a scrollbar",
    );
    assert.deepEqual(rendererErrors, []);
    console.log("Electron interface checks passed");
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error.message);
    win.destroy();
    app.exit(1);
  }
});
