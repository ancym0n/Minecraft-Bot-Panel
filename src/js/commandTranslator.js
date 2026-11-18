// Turns loose, plain-English bot commands into JavaScript that calls the
// AI Agent tools. Small local models are bad at writing Mineflayer code but
// fine at writing lines like:
//
//   walk player ancymon
//   mine 10 oak logs
//   turn on killaura players=on range=4
//   wait 3s; say done!
//
// Every line becomes one `await api.step(...)` call. Lines that already look
// like JavaScript are passed through untouched (only allowed with Allow Code).

const FILLER = new Set([
  "to",
  "the",
  "a",
  "an",
  "at",
  "towards",
  "toward",
  "player",
  "near",
  "nearest",
  "closest",
  "some",
  "of",
  "for",
  "please",
  "pls",
  "now",
  "me",
  "named",
  "called",
  "user",
  "mob",
  "entity",
  "block",
  "blocks",
  "item",
  "items",
  "my",
  "your",
  "x",
]);

// Words that mean "the player who asked".
const SELF_WORDS = new Set(["me", "here", "myself", "us", "sender"]);

const VERBS = {
  move: [
    "walk",
    "go",
    "goto",
    "move",
    "travel",
    "run",
    "head",
    "path",
    "pathfind",
    "navigate",
    "come",
    "approach",
    "tp",
    "teleport",
  ],
  follow: ["follow", "escort", "accompany", "trail"],
  stop: ["stop", "halt", "cancel", "stay", "freeze", "abort", "quit", "end"],
  look: ["look", "face", "lookat", "stare", "watch"],
  attack: ["attack", "kill", "hit", "fight", "hunt", "slay", "punch", "murder"],
  mine: [
    "mine",
    "dig",
    "break",
    "chop",
    "cut",
    "collect",
    "gather",
    "harvest",
    "get",
    "farm",
  ],
  eat: ["eat", "food", "consume"],
  gear: ["gear", "armor", "armour", "geared", "gearup"],
  hold: ["hold", "wield", "select", "equip", "grab", "take"],
  drop: ["drop", "toss", "give", "throw", "dropall"],
  say: [
    "say",
    "chat",
    "tell",
    "msg",
    "type",
    "write",
    "speak",
    "send",
    "reply",
  ],
  wait: ["wait", "delay", "pause", "idle"],
  jump: ["jump", "hop"],
  sneak: ["sneak", "crouch", "shift"],
  sprint: ["sprint"],
  dir: [
    "forward",
    "forwards",
    "back",
    "backward",
    "backwards",
    "left",
    "right",
  ],
  enable: ["enable", "activate", "start", "launch", "begin", "on"],
  disable: ["disable", "deactivate", "off"],
  set: ["set", "configure", "config", "option", "setting"],
  status: [
    "status",
    "info",
    "where",
    "pos",
    "position",
    "coords",
    "health",
    "hp",
    "inventory",
    "inv",
    "check",
  ],
  logs: ["logs", "log", "console", "errors", "history"],
  scripts: ["scripts", "modules", "list", "hacks", "mods", "features"],
  use: ["use", "rightclick", "activateitem", "interact"],
  respawn: ["respawn", "revive"],
  repeat: ["repeat", "loop"],
};

const VERB_OF = new Map();
for (const [kind, words] of Object.entries(VERBS)) {
  for (const w of words) if (!VERB_OF.has(w)) VERB_OF.set(w, kind);
}

// Friendly names for scripts so "aura", "fishing" or "auto eat" all work.
const SCRIPT_ALIASES = {
  aura: "KillAura",
  ka: "KillAura",
  killaura: "KillAura",
  fish: "AutoFish",
  fishing: "AutoFish",
  eat: "AutoEat",
  autoeat: "AutoEat",
  armor: "AutoArmor",
  armour: "AutoArmor",
  totem: "AutoTotem",
  tool: "AutoTool",
  tools: "AutoTool",
  farm: "AutoFarm",
  farming: "AutoFarm",
  build: "AutoBuild",
  reconnect: "AutoReconnect",
  rejoin: "AutoReconnect",
  respawn: "AutoRespawn",
  afk: "AntiAFK",
  antiafk: "AntiAFK",
  chest: "ChestStealer",
  stealer: "ChestStealer",
  steal: "ChestStealer",
  cheststealer: "ChestStealer",
  clear: "ClearInv",
  clearinventory: "ClearInv",
  dig: "Excavator",
  tunnel: "Excavator",
  quarry: "Excavator",
  excavate: "Excavator",
  gear: "GearUp",
  gearup: "GearUp",
  guard: "Guard",
  protect: "Guard",
  bodyguard: "Guard",
  hunt: "Hunt",
  inventory: "InvManager",
  invmanager: "InvManager",
  junk: "InvManager",
  mining: "Mine",
  safe: "SafeWalk",
  safewalk: "SafeWalk",
  spam: "Spam",
  spammer: "Spam",
  survive: "Survival",
  survival: "Survival",
  goto: "GoTo",
  follow: "Follow",
};

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const q = (v) => JSON.stringify(String(v));

function resolveScriptName(word, scripts = []) {
  const w = norm(word);
  if (!w || !scripts.length) return null;
  const exact = scripts.find((s) => norm(s) === w);
  if (exact) return exact;
  const alias = SCRIPT_ALIASES[w];
  if (alias) {
    const real = scripts.find((s) => norm(s) === norm(alias));
    if (real) return real;
  }
  const noAuto = w.replace(/^auto/, "");
  const loose = scripts.find(
    (s) =>
      norm(s).replace(/^auto/, "") === noAuto ||
      (w.length >= 4 && norm(s).startsWith(w)),
  );
  return loose || null;
}

// Finds a script name in the tokens (tries 3, 2, then 1 word spans so
// "auto eat" and "kill aura" work). Returns { name, rest } or null.
function pickScript(tokens, scripts) {
  for (let len = Math.min(3, tokens.length); len >= 1; len--) {
    for (let i = 0; i + len <= tokens.length; i++) {
      const phrase = tokens.slice(i, i + len).join("");
      if (/[=:]/.test(phrase)) continue;
      const name = resolveScriptName(phrase, scripts);
      if (name) {
        return {
          name,
          rest: [...tokens.slice(0, i), ...tokens.slice(i + len)],
        };
      }
    }
  }
  return null;
}

// "range=4 players=on" or "range 4" style options.
function parseOptions(tokens) {
  const opts = {};
  const left = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = t.match(/^([\w-]+)[=:](.*)$/);
    if (m) {
      let value = m[2];
      if (!value && tokens[i + 1]) value = tokens[++i];
      opts[m[1]] = value;
    } else {
      left.push(t);
    }
  }
  return { opts, left };
}

const isNum = (t) => /^[-+~]?\d+(\.\d+)?$/.test(String(t));
const toNum = (t) => Number(String(t).replace(/^~/, ""));

function cleanWords(tokens) {
  return tokens.filter((t) => !FILLER.has(t.toLowerCase()));
}

// Strips quotes, numbering, bullet points, "bot," prefixes and trailing dots.
function cleanLine(line, botName = "") {
  let s = String(line || "").trim();
  s = s.replace(/^\s*(?:\d+[.)]|[-*•>]|step\s*\d+\s*[:.)-])\s*/i, "");
  s = s.replace(/^`+|`+$/g, "").trim();
  s = s.replace(/^["']|["']$/g, "").trim();
  if (botName) {
    const esc = botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`^@?${esc}[,:]?\\s+`, "i"), "");
  }
  s = s.replace(/^(?:please|pls|plz|now|then|and|also|ok|okay)[,]?\s+/i, "");
  s = s.replace(/^(?:can you|could you|would you|i want you to)\s+/i, "");
  s = s.replace(/[.!?]+$/, "").trim();
  s = s
    .replace(/\ba few\b/gi, "3")
    .replace(
      /\b(once|twice|thrice|one|two|three|four|five|six|seven|eight|nine|ten|twenty)\b/gi,
      (w) => String(WORD_NUMBERS[w.toLowerCase()]),
    )
    .replace(/\b(\d+)\s+times?\b/gi, "$1");
  return s;
}

// Splits a block of text into single commands.
function splitCommands(text) {
  const parts = String(text || "")
    .replace(/```(?:\w+)?/g, "\n")
    .split(/\r?\n|;|\s+then\s+|,\s*then\s+|\s+and then\s+|\s+->\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  // "jump and say hi" → two commands, but "turn on aura and autoeat" stays
  // one (the second half doesn't start with a command word).
  const out = [];
  for (const part of parts) {
    if (/^(say|chat|tell|msg|type|write|speak|send|reply)\b/i.test(part)) {
      out.push(part);
      continue;
    }
    const pieces = part.split(/\s+and\s+|,\s+/i);
    let cur = pieces[0];
    for (const piece of pieces.slice(1)) {
      const first = piece.split(/\s+/)[0].toLowerCase();
      if (VERB_OF.has(first) || /^(turn|switch|toggle)$/.test(first)) {
        out.push(cur);
        cur = piece;
      } else {
        cur += ` and ${piece}`;
      }
    }
    out.push(cur);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

const WORD_NUMBERS = {
  once: 1,
  twice: 2,
  thrice: 3,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twenty: 20,
  a_few: 3,
};

function looksLikeJs(line) {
  return (
    /\b(await|const|let|var|return|function|new)\b/.test(line) ||
    /\bbot\.\w+/.test(line) ||
    /[{}]|=>|\w\(.*\)\s*;?$/.test(line)
  );
}

// Turns one plain command into a JS call string, or { error }.
function translateLine(raw, ctx) {
  const { scripts = [], sender = "" } = ctx;
  const line = cleanLine(raw, ctx.botName);
  if (!line) return null;
  const words = line.split(/\s+/);
  const lower = words.map((w) => w.toLowerCase());
  let verb = lower[0];
  let args = words.slice(1);
  let kind = VERB_OF.get(verb);
  const who = (list) => {
    const name = cleanWords(list).find((t) => !isNum(t));
    if (!name || SELF_WORDS.has(name.toLowerCase())) return sender;
    return name.replace(/^@/, "");
  };

  // "turn on X", "switch off X", "toggle X on", "X on", "X off"
  if (
    /^(turn|switch|toggle|put|set)$/.test(verb) &&
    /^(on|off)$/.test(lower[1] || "")
  ) {
    kind = lower[1] === "on" ? "enable" : "disable";
    args = words.slice(2);
  } else if (/^(turn|switch|toggle)$/.test(verb)) {
    const last = (lower[lower.length - 1] || "").replace(/[^a-z]/g, "");
    kind = last === "off" ? "disable" : "enable";
    args = words.slice(1, last === "on" || last === "off" ? -1 : undefined);
  } else if (
    words.length >= 2 &&
    /^(on|off|enable|enabled|disable|disabled|start|stop)$/.test(
      lower[lower.length - 1],
    ) &&
    pickScript(words.slice(0, -1), scripts)
  ) {
    kind = /^(on|enable|enabled|start)$/.test(lower[lower.length - 1])
      ? "enable"
      : "disable";
    args = words.slice(0, -1);
  }

  // "walk forward 2" → direction
  if (kind === "move" && VERB_OF.get(lower[1]) === "dir") {
    kind = "dir";
    verb = lower[1];
    args = words.slice(2);
  }
  // "go mine diamonds", "go kill zombies"
  if (kind === "move" && lower[1] && !["to", "player"].includes(lower[1])) {
    const next = VERB_OF.get(lower[1]);
    if (next && !["move", "dir", "stop"].includes(next)) {
      return translateLine(words.slice(1).join(" "), ctx);
    }
  }

  // A bare script name, e.g. "killaura" → toggle on.
  if (!kind) {
    const sc = pickScript(words, scripts);
    if (sc && cleanWords(sc.rest).every((t) => /[=:]/.test(t))) {
      kind = "enable";
      args = words;
    }
  }

  switch (kind) {
    case "move": {
      const nums = args.filter(isNum).map(toNum);
      if (nums.length >= 3)
        return `api.go_to({ x: ${nums[0]}, y: ${nums[1]}, z: ${nums[2]} })`;
      if (nums.length === 2)
        return `api.go_to({ x: ${nums[0]}, z: ${nums[1]} })`;
      const target = who(args);
      if (!target) return { error: "who should I walk to? e.g. walk to Steve" };
      return `api.come_to_player({ player: ${q(target)} })`;
    }
    case "follow": {
      const target = who(args);
      if (!target) return { error: "follow who? e.g. follow Steve" };
      return `api.follow_player({ player: ${q(target)} })`;
    }
    case "stop": {
      const sc = args.length ? pickScript(args, scripts) : null;
      if (sc) return `api.stop_script({ name: ${q(sc.name)} })`;
      const rest = lower.slice(1).join(" ");
      if (
        /\b(all|every|everything)\b/.test(rest) &&
        /\b(scripts?|modules?|hacks?|everything)\b/.test(rest)
      )
        return `api.stop_all_scripts({})`;
      return `api.stop({})`;
    }
    case "look": {
      const nums = args.filter(isNum).map(toNum);
      if (nums.length >= 3)
        return `api.look_at({ x: ${nums[0]}, y: ${nums[1]}, z: ${nums[2]} })`;
      const target = who(args);
      if (!target) return { error: "look at who? e.g. look at Steve" };
      return `api.look_at_player({ player: ${q(target)} })`;
    }
    case "attack": {
      const rest = cleanWords(args);
      let target = rest.join("_") || "hostile";
      if (
        /^(hostiles?|monsters?|mobs?|enemies|enemy|anything|everything)$/i.test(
          target,
        )
      )
        target = "hostile";
      else if (rest.length === 1 && SELF_WORDS.has(rest[0].toLowerCase()))
        target = sender;
      return `api.attack({ target: ${q(target)} })`;
    }
    case "mine": {
      const nums = args.filter(isNum).map(toNum);
      const rest = cleanWords(args.filter((t) => !isNum(t)));
      if (!rest.length) return { error: "mine what? e.g. mine 10 oak_log" };
      const count = nums[0] || (/^(all|lots|many)$/i.test(rest[0]) ? 32 : 1);
      const block = rest
        .filter((t) => !/^(all|lots|many|more)$/i.test(t))
        .join("_");
      return `api.mine_block({ block: ${q(block)}, count: ${count} })`;
    }
    case "eat":
      return `api.eat({})`;
    case "gear":
      return `api.equip_best_gear({})`;
    case "hold": {
      const rest = cleanWords(args);
      if (
        !rest.length ||
        /^(best|gear|armor|armour|everything|all)$/i.test(rest[0])
      )
        return `api.equip_best_gear({})`;
      return `api.hold({ item: ${q(rest.join("_"))} })`;
    }
    case "drop": {
      const toIdx = lower.indexOf("to");
      const body = toIdx > 0 ? words.slice(1, toIdx) : args;
      const nums = body.filter(isNum).map(toNum);
      const rest = cleanWords(body.filter((t) => !isNum(t)));
      if (
        verb === "dropall" ||
        !rest.length ||
        /^(all|everything|inventory|inv)$/i.test(rest.join(""))
      )
        return `api.drop_all({})`;
      const item = rest.filter((t) => !/^(all|every)$/i.test(t)).join("_");
      return `api.toss_item({ item: ${q(item)}${nums[0] ? `, count: ${nums[0]}` : ""} })`;
    }
    case "say": {
      // Keep the original text (case, punctuation) after the verb.
      // Text after the verb in the raw line, so "3. say Hi!" keeps "Hi!".
      const src = String(raw);
      const at = src.toLowerCase().indexOf(words[0].toLowerCase());
      const text = src
        .slice(at + words[0].length)
        .trim()
        .replace(/^["'](.*)["']$/, "$1");
      if (!text) return { error: "say what? e.g. say hello" };
      return `api.say({ text: ${q(text)} })`;
    }
    case "wait": {
      const m = args
        .join(" ")
        .match(
          /(\d+(?:\.\d+)?)\s*(ms|milli\w*|mins?|minutes?|m\b|s|secs?|seconds?)?/i,
        );
      const n = m ? Number(m[1]) : 1;
      const unit = (m && m[2] ? m[2] : "s").toLowerCase();
      let ms = n * 1000;
      if (/^(ms|milli)/.test(unit)) ms = n;
      else if (/^m(in|$)/.test(unit)) ms = n * 60000;
      return `api.wait({ ms: ${Math.max(0, Math.min(600000, Math.round(ms)))} })`;
    }
    case "jump": {
      const n = args.find(isNum);
      return `api.jump({ times: ${Math.max(1, Math.min(20, n ? toNum(n) : 1))} })`;
    }
    case "sneak":
    case "sprint": {
      const off = /^(off|stop|false|no)$/i.test(lower[1] || "");
      return `api.control({ control: ${q(kind)}, on: ${!off} })`;
    }
    case "dir": {
      const dir = verb.startsWith("forward")
        ? "forward"
        : verb.startsWith("back")
          ? "back"
          : verb;
      const n = args.find(isNum);
      const sec = n ? toNum(n) : 1;
      return `api.walk_direction({ direction: ${q(dir)}, seconds: ${Math.max(0.1, Math.min(30, sec))} })`;
    }
    case "enable":
    case "disable": {
      const sc = pickScript(args.length ? args : words, scripts);
      if (!sc) {
        if (kind === "disable" && /\b(all|everything)\b/i.test(args.join(" ")))
          return `api.stop_all_scripts({})`;
        return {
          error: `unknown module "${args.join(" ")}". Modules: ${scripts.join(", ")}`,
        };
      }
      // "turn on killaura and autoeat"
      const more = [];
      let rest = sc.rest;
      for (
        let next = pickScript(rest, scripts);
        next;
        next = pickScript(rest, scripts)
      ) {
        more.push(next.name);
        rest = next.rest;
      }
      if (more.length) {
        const names = [sc.name, ...more].filter(
          (n, i, a) => a.indexOf(n) === i,
        );
        const { opts: shared } = parseOptions(rest);
        return names.map((n, i) =>
          kind === "disable"
            ? `api.stop_script({ name: ${q(n)} })`
            : `api.start_script({ name: ${q(n)}${i === 0 && Object.keys(shared).length ? `, options: ${JSON.stringify(shared)}` : ""} })`,
        );
      }
      if (kind === "disable") return `api.stop_script({ name: ${q(sc.name)} })`;
      const { opts } = parseOptions(sc.rest);
      const hasOpts = Object.keys(opts).length > 0;
      return `api.start_script({ name: ${q(sc.name)}${hasOpts ? `, options: ${JSON.stringify(opts)}` : ""} })`;
    }
    case "set": {
      const sc = pickScript(args, scripts);
      if (!sc)
        return { error: "set needs a module, e.g. set killaura range 4" };
      const { opts, left } = parseOptions(sc.rest);
      const rest = cleanWords(left);
      if (!Object.keys(opts).length && rest.length >= 2) {
        opts[rest[0]] = rest.slice(1).join(" ");
      }
      if (!Object.keys(opts).length)
        return { error: `set what? e.g. set ${sc.name} range 4` };
      return `api.set_script_options({ name: ${q(sc.name)}, options: ${JSON.stringify(opts)} })`;
    }
    case "status":
      return `api.get_status({})`;
    case "logs": {
      const n = args.find(isNum);
      const filter = cleanWords(args.filter((t) => !isNum(t))).join(" ");
      return `api.read_logs({ lines: ${n ? toNum(n) : 15}${filter ? `, filter: ${q(filter)}` : ""} })`;
    }
    case "scripts":
      return `api.list_scripts({})`;
    case "use": {
      const rest = cleanWords(args);
      return rest.length
        ? `api.use_item({ item: ${q(rest.join("_"))} })`
        : `api.use_item({})`;
    }
    case "respawn":
      return `api.respawn({})`;
    default:
      return { error: `don't know "${words[0]}"` };
  }
}

const HELP = [
  "walk to Steve | walk 100 64 -20 | come here",
  "follow Steve | stop",
  "look at Steve | attack zombie | attack hostile | attack Steve",
  "mine 10 oak_log | eat | gear | hold diamond_sword | drop 5 dirt | drop all",
  "say hello | wait 3 | jump 2 | sneak on | sprint off | forward 2 | left 1",
  "turn on KillAura players=on range=4 | turn off KillAura | stop all scripts",
  "set Spam message hi | status | logs 20 | logs error | scripts | use | respawn",
].join("\n");

// text → { js, steps, errors, long, needsCode }
function translate(text, ctx = {}) {
  const steps = [];
  // Real JavaScript stays one block so variables carry across lines.
  const plain = String(text || "")
    .replace(/```(?:\w+)?/g, "\n")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const allJs =
    plain.length > 0 &&
    plain.every(
      (l) =>
        looksLikeJs(l) ||
        /^(\}|\)|\/\/)/.test(l) ||
        /^(if|for|while|else|try|catch)\b/.test(l),
    ) &&
    !VERB_OF.has(plain[0].split(/\s+/)[0].toLowerCase());
  const lines = allJs ? [] : splitCommands(text);
  if (allJs) steps.push({ line: plain.join("\n"), js: null, raw: true });
  let needsCode = allJs;
  const errors = [];
  for (const raw of lines) {
    if (looksLikeJs(raw) && !VERB_OF.has(raw.split(/\s+/)[0].toLowerCase())) {
      steps.push({ line: raw, js: null, raw: true });
      needsCode = true;
      continue;
    }
    const res = translateLine(raw, ctx);
    if (res === null) continue;
    if (Array.isArray(res)) {
      for (const js of res) steps.push({ line: raw, js });
      continue;
    }
    if (typeof res === "object") {
      errors.push(`"${raw}": ${res.error}`);
      steps.push({ line: raw, error: res.error });
      continue;
    }
    steps.push({ line: raw, js: res });
  }

  const runnable = steps.filter((s) => s.js || s.raw);
  const out = [];
  runnable.forEach((s, i) => {
    if (s.raw) {
      out.push(
        `await api.raw(${i + 1}, ${q(s.line)}, async () => { ${s.line} });`,
      );
      return;
    }
    out.push(`await api.step(${i + 1}, ${q(s.line)}, () => ${s.js});`);
    // Wait to arrive before doing the next thing.
    if (/^api\.(go_to|come_to_player)\(/.test(s.js) && i < runnable.length - 1)
      out.push(`await api.arrive();`);
  });

  const long = runnable.some(
    (s) =>
      s.raw ||
      /^api\.(mine_block|attack|wait|jump|walk_direction)\(/.test(s.js) ||
      (/^api\.(go_to|come_to_player)\(/.test(s.js) && runnable.length > 1),
  );
  return {
    js: out.join("\n"),
    steps,
    errors,
    long,
    needsCode,
    count: runnable.length,
  };
}

module.exports = {
  translate,
  translateLine,
  splitCommands,
  resolveScriptName,
  HELP,
};
