const fs = require("fs");
const path = require("path");
const os = require("os");

class SessionLogger {
  constructor() {
    this.logsDir = "";
    this.currentFilePath = "";
    this.sessionStartTime = new Date();
    this.eventCount = 0;
    this.collectedSummary = new Map();
    this.clickCount = 0;
    this.gameEventCount = 0;
    this.chatCount = 0;
    this.writeQueue = [];
    this.flushTimer = null;
    this.initialized = false;
  }

  init(baseDir, meta = {}) {
    try {
      this.logsDir = baseDir;
      fs.mkdirSync(this.logsDir, { recursive: true });
      this.sessionStartTime = new Date();
      const stamp = this.formatDateStamp(this.sessionStartTime);
      this.currentFilePath = path.join(this.logsDir, `session-${stamp}.md`);

      const header = [
        `# MCBP Session Log - ${this.formatHumanDateTime(this.sessionStartTime)}`,
        "",
        `- **App Version**: v${meta.appVersion || "0.2.0"}`,
        `- **Platform**: \`${process.platform}\` (\`${os.arch()}\`) - ${os.type()} ${os.release()}`,
        `- **Log File**: \`${path.basename(this.currentFilePath)}\``,
        "",
        "## Session Event & Action Timeline",
        "",
        "| Time | Category | Action / Event | Details |",
        "| :--- | :--- | :--- | :--- |",
        "",
      ].join(os.EOL);

      fs.writeFileSync(this.currentFilePath, header, "utf8");
      this.initialized = true;
      this.record(
        "System",
        "Session started",
        `Logging all UI clicks, collected items, chat, AI responses, and game events to ${path.basename(this.currentFilePath)}`,
      );
    } catch (_) {
      this.initialized = false;
    }
    return this.currentFilePath;
  }

  formatDateStamp(d) {
    const pad = (n) => (n < 10 ? `0${n}` : String(n));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  formatHumanDateTime(d) {
    const pad = (n) => (n < 10 ? `0${n}` : String(n));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  formatTimeOnly(d = new Date()) {
    const pad = (n) => (n < 10 ? `0${n}` : String(n));
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`;
  }

  sanitizeMdCell(val) {
    if (val === null || val === undefined) return "";
    return String(val)
      .replace(/§#[0-9a-fA-F]{6}|§[0-9a-fk-or]/gi, "")
      .replace(/\r?\n/g, " ↵ ")
      .replace(/\|/g, "\\|")
      .trim();
  }

  record(category, event, details = "") {
    if (!this.initialized || !this.currentFilePath) return;
    this.eventCount++;
    const catLower = String(category || "").toLowerCase();
    if (catLower.includes("click") || catLower.includes("ui")) {
      this.clickCount++;
    } else if (catLower.includes("chat") || catLower.includes("ai")) {
      this.chatCount++;
    } else if (
      catLower.includes("game") ||
      catLower.includes("combat") ||
      catLower.includes("mine") ||
      catLower.includes("container")
    ) {
      this.gameEventCount++;
    }

    const timeStr = this.formatTimeOnly(new Date());
    const catCell = this.sanitizeMdCell(category);
    const evtCell = this.sanitizeMdCell(event);
    const detCell = this.sanitizeMdCell(details);
    const row = `| \`${timeStr}\` | **${catCell}** | ${evtCell} | ${detCell} |${os.EOL}`;

    this.writeQueue.push(row);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 250);
    }
  }

  recordCollected(itemName, displayName, deltaCount, pos = null) {
    if (!itemName || deltaCount <= 0) return;
    const prev = this.collectedSummary.get(itemName) || {
      displayName: displayName || itemName,
      count: 0,
    };
    prev.count += deltaCount;
    this.collectedSummary.set(itemName, prev);

    const posStr = pos
      ? ` at (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`
      : "";
    this.record(
      "Collected",
      `+${deltaCount}x ${displayName || itemName}`,
      `Item: \`${itemName}\` (Session total: ${prev.count})${posStr}`,
    );
  }

  flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (
      !this.initialized ||
      !this.currentFilePath ||
      this.writeQueue.length === 0
    ) {
      return;
    }
    const chunk = this.writeQueue.join("");
    this.writeQueue = [];
    try {
      fs.appendFileSync(this.currentFilePath, chunk, "utf8");
    } catch (_) {}
  }

  finalize() {
    this.flush();
    if (!this.initialized || !this.currentFilePath) return;
    this.initialized = false;
    try {
      const collectedLines = [];
      for (const [key, info] of this.collectedSummary.entries()) {
        collectedLines.push(
          `- **${info.displayName}** (\`${key}\`): ×${info.count}`,
        );
      }
      const summaryBlock = [
        "",
        "---",
        "## Session Summary",
        "",
        `- **Ended At**: ${this.formatHumanDateTime(new Date())}`,
        `- **Total Logged Entries**: ${this.eventCount}`,
        `- **UI Clicks & Controls**: ${this.clickCount}`,
        `- **Game & World Events**: ${this.gameEventCount}`,
        `- **Chat & AI Messages**: ${this.chatCount}`,
        "",
        "### Collected Items Summary",
        ...(collectedLines.length > 0
          ? collectedLines
          : ["- _No items collected during this session._"]),
        "",
      ].join(os.EOL);
      fs.appendFileSync(this.currentFilePath, summaryBlock, "utf8");
    } catch (_) {}
  }

  listLogFiles(limit = 25) {
    if (!this.logsDir || !fs.existsSync(this.logsDir)) return [];
    try {
      const files = fs
        .readdirSync(this.logsDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => {
          const full = path.join(this.logsDir, f);
          const stat = fs.statSync(full);
          return {
            name: f,
            path: full,
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
            isCurrent: full === this.currentFilePath,
          };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      return files.slice(0, limit);
    } catch (_) {
      return [];
    }
  }

  parseEntriesFromFile(filePath, type = "logs") {
    if (!filePath || !fs.existsSync(filePath)) return [];
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split(/\r?\n/);
      const fileName = path.basename(filePath);
      const entries = [];
      for (const line of lines) {
        const m = line.match(
          /^\|\s*`([^`]+)`\s*\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]*?)\s*\|\s*(.*?)\s*\|$/,
        );
        if (!m) continue;
        const rawTime = m[1].trim();
        const time = rawTime.split(".")[0];
        const category = m[2].trim();
        const event = m[3].replace(/\\\|/g, "|").trim();
        const details = m[4].replace(/\\\|/g, "|").trim();
        const catLower = category.toLowerCase();

        if (type === "chat") {
          if (catLower === "chat") {
            entries.push({
              time,
              raw: details || event,
              payload: details || event,
              sourceFile: fileName,
            });
          } else if (catLower === "ai reply") {
            entries.push({
              time,
              raw: `${event}: ${details}`,
              payload: `${event}: ${details}`,
              sourceFile: fileName,
            });
          }
        } else {
          if (catLower === "console") {
            entries.push({
              time,
              raw: details || event,
              sourceFile: fileName,
            });
          } else if (
            catLower !== "chat" &&
            catLower !== "ui click" &&
            catLower !== "system"
          ) {
            entries.push({
              time,
              raw: `${category}: ${event}${details ? ` - ${details}` : ""}`,
              sourceFile: fileName,
            });
          }
        }
      }
      return entries;
    } catch (_) {
      return [];
    }
  }

  readHistoricalEntries({
    type = "logs",
    beforeIndex = null,
    fileIndex = 0,
    limit = 100,
    filter = "",
  } = {}) {
    this.flush();
    const files = this.listLogFiles(30);
    if (!files.length) {
      return {
        entries: [],
        nextBeforeIndex: 0,
        nextFileIndex: 0,
        hasMore: false,
        sourceFile: "",
      };
    }

    const q = String(filter || "")
      .trim()
      .toLowerCase();
    let fIdx = Math.max(0, Number(fileIndex) || 0);
    let bIdx =
      beforeIndex !== null && beforeIndex !== undefined
        ? Number(beforeIndex)
        : null;
    const collected = [];
    let activeFile = "";

    while (fIdx < files.length && collected.length < limit) {
      const fileObj = files[fIdx];
      let all = this.parseEntriesFromFile(fileObj.path, type);
      if (q) {
        all = all.filter((e) =>
          String(e.raw || "")
            .toLowerCase()
            .includes(q),
        );
      }
      const end = bIdx !== null ? Math.min(bIdx, all.length) : all.length;
      const needed = limit - collected.length;
      const start = Math.max(0, end - needed);
      const slice = all.slice(start, end);
      if (slice.length) {
        collected.unshift(...slice);
        activeFile = fileObj.name;
      }
      if (start > 0) {
        bIdx = start;
        break;
      } else {
        fIdx += 1;
        bIdx = null;
      }
    }

    const hasMore = fIdx < files.length && (bIdx === null || bIdx > 0);
    return {
      entries: collected,
      nextBeforeIndex: bIdx,
      nextFileIndex: fIdx,
      hasMore,
      sourceFile:
        activeFile || files[Math.min(fIdx, files.length - 1)]?.name || "",
    };
  }

  getStatus() {
    return {
      initialized: this.initialized,
      logsDir: this.logsDir,
      currentFilePath: this.currentFilePath,
      currentFileName: this.currentFilePath
        ? path.basename(this.currentFilePath)
        : "",
      eventCount: this.eventCount,
      clickCount: this.clickCount,
      gameEventCount: this.gameEventCount,
      chatCount: this.chatCount,
      collectedTypes: this.collectedSummary.size,
      recentFiles: this.listLogFiles(12),
    };
  }
}

module.exports = {
  SessionLogger,
  sessionLogger: new SessionLogger(),
};
