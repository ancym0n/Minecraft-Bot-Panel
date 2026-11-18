// Script Studio backend: premade templates, Mineflayer docs (bundled copy
// plus auto-download of the matching version), docs search and saving.
const fs = require("fs");
const path = require("path");
const https = require("https");
const vm = require("vm");

const TEMPLATES_DIR = path.join(__dirname, "templates");
const DOCS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const DOC_SOURCES = [
  {
    id: "mineflayer",
    title: "Mineflayer API",
    pkg: "mineflayer",
    local: ["docs", "api.md"],
    urls: (v) => [
      `https://raw.githubusercontent.com/PrismarineJS/mineflayer/${v}/docs/api.md`,
      "https://raw.githubusercontent.com/PrismarineJS/mineflayer/master/docs/api.md",
    ],
  },
  {
    id: "pathfinder",
    title: "Pathfinder",
    pkg: "mineflayer-pathfinder",
    local: ["readme.md"],
    urls: () => [
      "https://raw.githubusercontent.com/PrismarineJS/mineflayer-pathfinder/master/readme.md",
      "https://raw.githubusercontent.com/PrismarineJS/mineflayer-pathfinder/master/README.md",
    ],
  },
];

const state = {
  docsDir: "",
  baseDirs: [],
  sections: [],
  meta: {},
  downloading: null,
};

function init({ userDataDir, baseDirs = [] }) {
  state.docsDir = path.join(userDataDir, "docs");
  state.baseDirs = baseDirs.filter(Boolean);
  loadDocs();
}

function setBaseDirs(baseDirs = []) {
  state.baseDirs = baseDirs.filter(Boolean);
}

// --- Templates -------------------------------------------------------------

function listTemplates() {
  let files = [];
  try {
    files = fs
      .readdirSync(TEMPLATES_DIR)
      .filter((f) => f.endsWith(".js"))
      .sort();
  } catch (_) {}
  return files.map((file) => {
    const code = fs.readFileSync(path.join(TEMPLATES_DIR, file), "utf8");
    const header = code.match(/^\/\/ @template ([^|\n]+)\|?([^\n]*)\n/);
    return {
      id: file.replace(/\.js$/, ""),
      title: header ? header[1].trim() : file,
      desc: header ? header[2].trim() : "",
      code: header ? code.slice(header[0].length) : code,
    };
  });
}

// --- Docs ------------------------------------------------------------------

function fetchText(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "MCBP-Docs" }, timeout: 20000 },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirects > 0
        ) {
          res.resume();
          resolve(fetchText(res.headers.location, redirects - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve(raw));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
  });
}

function readPkgVersion(pkg) {
  for (const base of state.baseDirs) {
    try {
      const p = path.join(base, "node_modules", pkg, "package.json");
      return JSON.parse(fs.readFileSync(p, "utf8")).version;
    } catch (_) {}
  }
  return "";
}

function localDocPath(source) {
  for (const base of state.baseDirs) {
    const p = path.join(base, "node_modules", source.pkg, ...source.local);
    if (fs.existsSync(p)) return p;
  }
  return "";
}

function cachedDocPath(source) {
  return path.join(state.docsDir, `${source.id}.md`);
}

function metaPath() {
  return path.join(state.docsDir, "docs-meta.json");
}

function parseMarkdownSections(md, source) {
  const text = String(md || "")
    .replace(/<!-- START doctoc[\s\S]*?<!-- END doctoc[^>]*-->/g, "")
    .replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const sections = [];
  let current = null;
  let inFence = false;
  const trail = [];

  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^(#{1,5})\s+(.+?)\s*#*$/);
    if (m) {
      if (current) sections.push(current);
      const level = m[1].length;
      const title = m[2].replace(/`/g, "").trim();
      trail.length = level - 1;
      trail[level - 1] = title;
      current = {
        id: `${source.id}-${sections.length}`,
        source: source.id,
        sourceTitle: source.title,
        level,
        title,
        path: trail.slice(1, -1).filter(Boolean).join(" › "),
        body: "",
      };
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  if (current) sections.push(current);
  return sections
    .map((s) => ({ ...s, body: s.body.trim() }))
    .filter((s) => s.body.length > 0 || s.level >= 3);
}

function loadDocs() {
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaPath(), "utf8"));
  } catch (_) {}
  state.meta = meta;

  const sections = [];
  for (const source of DOC_SOURCES) {
    const cached = cachedDocPath(source);
    const local = localDocPath(source);
    const file = fs.existsSync(cached) ? cached : local;
    if (!file) continue;
    try {
      sections.push(
        ...parseMarkdownSections(fs.readFileSync(file, "utf8"), source),
      );
    } catch (_) {}
  }
  state.sections = sections;
  return getDocsStatus();
}

function getDocsStatus() {
  const fetchedAt = state.meta.fetchedAt || 0;
  return {
    sections: state.sections.length,
    source: fetchedAt
      ? "downloaded"
      : state.sections.length
        ? "bundled"
        : "none",
    version: state.meta.mineflayer || readPkgVersion("mineflayer") || "",
    fetchedAt,
    downloading: Boolean(state.downloading),
    stale: !fetchedAt || Date.now() - fetchedAt > DOCS_MAX_AGE_MS,
  };
}

// Downloads docs for the installed Mineflayer version (falls back to master).
function downloadDocs({ force = false } = {}) {
  if (state.downloading) return state.downloading;
  const status = getDocsStatus();
  const version = readPkgVersion("mineflayer");
  if (!force && !status.stale && state.meta.mineflayer === version) {
    return Promise.resolve({ ok: true, skipped: true, status });
  }

  state.downloading = (async () => {
    const meta = { fetchedAt: Date.now(), mineflayer: version };
    const errors = [];
    let saved = 0;
    fs.mkdirSync(state.docsDir, { recursive: true });
    for (const source of DOC_SOURCES) {
      const ver = readPkgVersion(source.pkg);
      let text = "";
      for (const url of source.urls(ver || "master")) {
        try {
          text = await fetchText(url);
          if (text && text.length > 500) break;
        } catch (err) {
          errors.push(`${source.title}: ${err.message}`);
        }
      }
      if (text && text.length > 500) {
        fs.writeFileSync(cachedDocPath(source), text, "utf8");
        saved += 1;
      }
    }
    if (saved) fs.writeFileSync(metaPath(), JSON.stringify(meta), "utf8");
    loadDocs();
    const finalStatus = { ...getDocsStatus(), downloading: false };
    return saved
      ? { ok: true, saved, status: finalStatus }
      : {
          ok: false,
          error: errors[0] || "Could not download docs",
          status: finalStatus,
        };
  })().finally(() => {
    state.downloading = null;
  });
  return state.downloading;
}

function tokenize(q) {
  return String(q || "")
    .toLowerCase()
    .split(/[^a-z0-9_.]+/)
    .filter((t) => t.length > 1);
}

function scoreSection(section, terms, phrase) {
  const title = section.title.toLowerCase();
  const body = section.body.toLowerCase();
  let score = 0;
  if (phrase && title.includes(phrase)) score += 25;
  for (const t of terms) {
    if (title.includes(t)) score += 8;
    const short = t.replace(/^bot\./, "");
    if (short !== t && title.includes(short)) score += 4;
    let idx = body.indexOf(t);
    let hits = 0;
    while (idx !== -1 && hits < 6) {
      hits += 1;
      idx = body.indexOf(t, idx + t.length);
    }
    score += hits;
  }
  if (score && section.level >= 4) score += 1;
  return score;
}

function searchDocs(query, limit = 40) {
  const terms = tokenize(query);
  if (!terms.length) {
    return state.sections
      .filter((s) => s.level <= 3)
      .slice(0, limit)
      .map(toResult);
  }
  const phrase = String(query).toLowerCase().trim();
  return state.sections
    .map((s) => ({ s, score: scoreSection(s, terms, phrase) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => toResult(r.s));
}

function toResult(s) {
  return {
    id: s.id,
    title: s.title,
    path: s.path,
    source: s.sourceTitle,
    level: s.level,
  };
}

function getSection(id) {
  return state.sections.find((s) => s.id === id) || null;
}

// Picks the most relevant doc snippets for an AI request.
function buildDocsContext(request, maxChars = 6500) {
  const STOP = new Set([
    "the",
    "and",
    "that",
    "with",
    "when",
    "make",
    "bot",
    "script",
    "for",
    "from",
    "into",
    "this",
    "should",
    "will",
    "every",
    "then",
    "near",
  ]);
  const terms = tokenize(request).filter((t) => !STOP.has(t));
  const core = [
    "bot.chat(",
    "bot.findBlock(",
    "bot.dig(",
    "bot.nearestEntity(",
    "bot.lookAt(",
    "bot.equip(",
  ];
  const picked = [];
  const seen = new Set();
  const add = (s) => {
    if (!s || seen.has(s.id)) return;
    seen.add(s.id);
    picked.push(s);
  };

  if (terms.length) {
    state.sections
      .map((s) => ({ s, score: scoreSection(s, terms, "") }))
      .filter((r) => r.score > 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .forEach((r) => add(r.s));
  }
  for (const prefix of core) {
    add(state.sections.find((s) => s.title.startsWith(prefix)));
  }

  let out = "";
  for (const s of picked) {
    const chunk = `### ${s.title}\n${s.body.slice(0, 900)}\n\n`;
    if (out.length + chunk.length > maxChars) break;
    out += chunk;
  }
  return out.trim();
}

// --- Generation prompt -------------------------------------------------------

const MINEFLAYER_CHEATSHEET = `CRITICAL MINEFLAYER API RULES (DO NOT INVENT METHODS OR PROPERTIES):
1. info.options types:
   - ONLY use type: "input", type: "checkbox", or type: "select" (with choices: ["a", "b"]).
   - NEVER use type: "number" or type: "boolean". For numbers, use { type: "input", label: "Radius", id: "radius" } and convert with Number(await getOption("radius", info.name)) || 32.
2. Looking up blocks & items (ALWAYS use bot.registry, NEVER mcData.items or mcData.blocks):
   - Block lookup: const blockType = bot.registry.blocksByName[name] || bot.registry.blocksByName[\`\${name}_ore\`];
   - Item lookup: const itemType = bot.registry.itemsByName[name];
   - Always check if (!blockType) before using blockType.id!
3. Finding blocks in the world:
   - Single nearest block (returns a Block object with block.position.x, block.position.y, block.position.z, block.name):
     const block = bot.findBlock({ matching: blockType.id, maxDistance: radius });
   - Multiple block positions (returns an array of Vec3 positions [pos], NOT Block objects! Use pos.x, pos.y, pos.z or bot.blockAt(pos)):
     const positions = bot.findBlocks({ matching: blockType.id, maxDistance: radius, count: 10 });
   - NEVER write \`find:\` inside bot.findBlock / bot.findBlocks — the key is ALWAYS \`matching:\` (a number id, array of ids, or function (b) => boolean).
4. Finding entities / dropped items / players / mobs:
   - Nearest entity:
     const ent = bot.nearestEntity((e) => e.name === "item" && e.position.distanceTo(bot.entity.position) <= radius);
   - Specific player entity:
     const playerEnt = bot.players[username]?.entity;
   - All entities: Object.values(bot.entities)
5. Pathfinding & movement (bot.pathfinder is already loaded, get goals from libs):
   - const { goals } = libs;
   - Walk and wait to arrive (async):
     await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
   - Start moving without blocking:
     bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
   - Follow entity:
     bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
   - Stop moving:
     bot.pathfinder.setGoal(null);
6. Mining, inventory & equipping:
   - Equip best tool before digging:
     const tool = bot.pathfinder.bestHarvestTool(block);
     if (tool) await bot.equip(tool, "hand");
     await bot.dig(block, true);
   - Inventory items list:
     const items = bot.inventory.items(); // each item has item.name, item.count, item.displayName, item.slot
   - Equip item by name:
     const item = bot.inventory.items().find((i) => i.name === "diamond_sword" || i.name.includes(wanted));
     if (item) await bot.equip(item, "hand");`;

function pickBestTemplates(request, count = 2) {
  const templates = listTemplates();
  if (!templates.length) return [];
  const terms = tokenize(request);
  const scored = templates.map((t) => {
    const hay = `${t.id} ${t.title} ${t.desc} ${t.code}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (hay.includes(term)) score += 3;
    }
    if (
      /block|mine|dig|find|search|ore|chop|wood|collect|diamond|iron/i.test(
        request,
      ) &&
      t.id.includes("collect-blocks")
    ) {
      score += 15;
    }
    if (
      /chat|command|say|prefix|owner/i.test(request) &&
      t.id.includes("chat-commands")
    ) {
      score += 12;
    }
    if (
      /player|look|watch|entity|mob|near/i.test(request) &&
      t.id.includes("look-at-players")
    ) {
      score += 10;
    }
    if (/sleep|bed|night/i.test(request) && t.id.includes("auto-sleep")) {
      score += 12;
    }
    if (
      /health|hp|low|disconnect|guard/i.test(request) &&
      t.id.includes("health-alert")
    ) {
      score += 10;
    }
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, count).map((x) => x.t);
  if (!picked.some((t) => t.id.includes("collect-blocks")) && picked.length < 2) {
    const cb = templates.find((t) => t.id.includes("collect-blocks"));
    if (cb) picked.push(cb);
  }
  return picked;
}

function buildGenerationMessages({ request, currentCode = "", fixError = "" }) {
  const examples = pickBestTemplates(request, 2);
  const examplesBlock = examples
    .map((ex) => `// Example (${ex.title}):\n\`\`\`js\n${ex.code.trim()}\n\`\`\``)
    .join("\n\n");
  const docs = buildDocsContext(request);
  const system = `You write custom scripts for MCBP (Minecraft Bot Panel), which runs Mineflayer bots.
Return ONE complete, working JavaScript file in a single \`\`\`js code block and nothing else.

Script contract (CommonJS):
- Export { info, script } via \`module.exports = { info, script };\`.
- info = { name: "PascalCaseName", default: { interval: 1000 }, options: [...] }.
- options items: { type: "checkbox" | "input" | "select", label, id, choices? }. select needs choices: ["a","b"].
- async function script(bot, log, clearLog, getOption, scriptRepeater, libs)
  - await getOption(id, info.name) returns a string; checkboxes return "on" or "off". Always provide a fallback default!
  - await scriptRepeater(fn, ms) calls fn every ms until the user toggles the script off, then resolves. Keep the script alive with it, and guard async work with a \`let busy = false;\` lock so ticks never overlap.
  - libs = { goals, Movements, Vec3, mcData }. bot.pathfinder is already loaded; use goals from libs, never require mineflayer packages.
  - Only add bot.on listeners when the task reacts to events; remove each one in a finally block after scriptRepeater.
  - Round coordinates with Math.floor before showing them.
  - Prefix log messages with the script name, e.g. log(\`\${info.name}: done\`).
  - Never call process.exit, never use eval, avoid chat spam (space messages several seconds apart).
- Start with: if (!bot || !bot.entity) return log(\`\${info.name}: Connect a bot first\`);

${MINEFLAYER_CHEATSHEET}

Working reference templates:
${examplesBlock}

Relevant Mineflayer docs:
${docs || "(docs unavailable)"}`;

  let user;
  if (fixError && currentCode.trim()) {
    user = `The script you generated has an error: ${fixError}\nFix the script so it follows the Mineflayer API rules and works properly.\nOriginal request: ${request}\n\nBroken script:\n\`\`\`js\n${currentCode.slice(0, 8000)}\n\`\`\``;
  } else if (currentCode.trim()) {
    user = `Modify this script as requested.\nRequest: ${request}\n\nCurrent script:\n\`\`\`js\n${currentCode.slice(0, 8000)}\n\`\`\``;
  } else {
    user = `Write a complete, working MCBP script that does this: ${request}`;
  }

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// Automatically repairs common Mineflayer hallucinations made by small local LLMs.
function autoFixGeneratedScript(rawCode) {
  let code = String(rawCode || "").trim();
  if (!code) return code;

  // 1. Normalize invalid option types ("number", "text", "string" -> "input"; "boolean" -> "checkbox")
  code = code.replace(
    /(\btype\s*:\s*["'])(?:number|text|string|int|integer|float)(["'])/gi,
    "$1input$2",
  );
  code = code.replace(
    /(\btype\s*:\s*["'])(?:boolean|bool|toggle)(["'])/gi,
    "$1checkbox$2",
  );

  // 2. Fix mcData.blocksByName / mcData.itemsByName / mcData.blocks / mcData.items without mcData(bot.version)
  code = code
    .replace(/\bmcData\.blocksByName\b/g, "bot.registry.blocksByName")
    .replace(/\bmcData\.itemsByName\b/g, "bot.registry.itemsByName")
    .replace(/\bmcData\.entitiesByName\b/g, "bot.registry.entitiesByName")
    .replace(/\bmcData\.blocks\[/g, "bot.registry.blocksByName[")
    .replace(/\bmcData\.items\[/g, "bot.registry.itemsByName[");

  // 3. Fix bot.findBlocks / bot.findBlock({ find: ... }) or ({ block: ... }) -> ({ matching: ... })
  code = code.replace(
    /(bot\.findBlocks?\s*\(\s*\{[^}]*?)\b(?:find|block|blockType)\s*:/g,
    "$1matching:",
  );

  // 4. If matching: bot.registry.blocksByName[x] or matching: bot.registry.itemsByName[x] is used without .id, append ?.id
  code = code.replace(
    /(matching\s*:\s*bot\.registry\.(?:blocksByName|itemsByName)\[[^\]]+\])(?!\s*(?:\?\.|\.)id)/g,
    "$1?.id",
  );

  // 5. If module.exports is missing but info and script are defined, append module.exports = { info, script };
  if (
    !/module\.exports/.test(code) &&
    /\bconst\s+info\b|\blet\s+info\b/.test(code) &&
    /\bfunction\s+script\b/.test(code)
  ) {
    code += "\n\nmodule.exports = { info, script };\n";
  }

  return code;
}

function extractCode(text) {
  const raw = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  const blocks = [...raw.matchAll(/```(?:js|javascript)?\s*\n([\s\S]*?)```/gi)];
  let extracted;
  if (blocks.length) {
    extracted = blocks
      .map((b) => b[1])
      .sort((a, b) => b.length - a.length)[0]
      .trim();
  } else {
    const open = raw.match(/```(?:js|javascript)?\s*\n([\s\S]*)$/i);
    extracted = (open ? open[1] : raw).trim();
  }
  return autoFixGeneratedScript(extracted);
}

// --- Validation & saving -------------------------------------------------

function extractScriptName(code) {
  const m = String(code || "").match(/name\s*:\s*["'`]([^"'`\n]{1,48})["'`]/);
  return m ? m[1].trim() : "";
}

function validateScript(code) {
  const problems = [];
  const src = String(code || "");
  if (!src.trim()) return { ok: false, error: "Script is empty", problems };
  try {
    // Parse only; nothing is executed here.
    new vm.Script(
      `(function (exports, require, module, __filename, __dirname) {\n${src}\n})`,
      {
        filename: "script.js",
      },
    );
  } catch (err) {
    const lineMatch = String(err.stack || "").match(/script\.js:(\d+)/);
    const line = lineMatch ? Number(lineMatch[1]) - 1 : null;
    return {
      ok: false,
      error: `Syntax error${line ? ` on line ${line}` : ""}: ${err.message}`,
      line,
      problems,
    };
  }
  const name = extractScriptName(src);
  if (!/module\.exports/.test(src)) problems.push("Missing module.exports");
  if (!name) problems.push('info.name not found (e.g. name: "MyScript")');
  if (!/async\s+function\s+script|script\s*[:=]\s*async/.test(src))
    problems.push("No async script() function found");
  if (/process\.exit/.test(src)) problems.push("Uses process.exit");
  if (
    /require\s*\(\s*["'](?:mineflayer|mineflayer-pathfinder|vec3|minecraft-data)["']\s*\)/.test(
      src,
    )
  ) {
    problems.push(
      "Do not require('mineflayer' | 'vec3' | 'minecraft-data'); use bot and libs = { goals, Movements, Vec3, mcData }",
    );
  }
  if (/bot\.findBlocks?\s*\(\s*\{[^}]*\bfind\s*:/.test(src)) {
    problems.push(
      "bot.findBlock / bot.findBlocks uses `matching:`, not `find:`",
    );
  }
  if (/\bmcData\.(?:items|blocks|blocksByName|itemsByName)\b/.test(src)) {
    problems.push(
      "Use bot.registry.blocksByName / bot.registry.itemsByName instead of mcData.blocks / mcData.items",
    );
  }
  return {
    ok: problems.length === 0,
    name,
    problems,
    error: problems[0] || "",
  };
}

function slugify(name) {
  return (
    String(name || "")
      .trim()
      .replace(/\.js$/i, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 48) || "script"
  );
}

function listCustomScripts(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .sort()
      .map((file) => {
        const code = fs.readFileSync(path.join(dir, file), "utf8");
        return { file, name: extractScriptName(code) || file };
      });
  } catch (_) {
    return [];
  }
}

function readCustomScript(dir, file) {
  const safe = path.basename(String(file || ""));
  const full = path.join(dir, safe);
  if (!safe.endsWith(".js") || !fs.existsSync(full)) return null;
  return { file: safe, code: fs.readFileSync(full, "utf8") };
}

module.exports = {
  init,
  setBaseDirs,
  listTemplates,
  loadDocs,
  getDocsStatus,
  downloadDocs,
  searchDocs,
  getSection,
  buildGenerationMessages,
  autoFixGeneratedScript,
  extractCode,
  extractScriptName,
  validateScript,
  slugify,
  listCustomScripts,
  readCustomScript,
};
