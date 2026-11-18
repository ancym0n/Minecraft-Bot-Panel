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
  "down",
  "x",
]);

// Words that mean "the player who asked" (or reflexive "yourself" in "make yourself a pickaxe").
const SELF_WORDS = new Set([
  "me",
  "here",
  "myself",
  "yourself",
  "us",
  "sender",
  "you",
]);

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
  follow: ["follow", "following", "escort", "accompany", "trail"],
  stop: ["stop", "halt", "cancel", "stay", "freeze", "abort", "quit", "end"],
  look: ["look", "face", "lookat", "stare", "watch"],
  attack: [
    "attack",
    "attacking",
    "kill",
    "killing",
    "hit",
    "fight",
    "fighting",
    "slay",
    "punch",
    "murder",
  ],
  hunt: ["hunt", "hunting", "chase", "chasing", "pursue"],
  guard: [
    "guard",
    "guarding",
    "protect",
    "protecting",
    "defend",
    "escort",
    "bodyguard",
  ],
  mine: [
    "mine",
    "mining",
    "dig",
    "digging",
    "break",
    "chop",
    "chopping",
    "cut",
    "collect",
    "gather",
    "gathering",
    "harvest",
    "get",
    "farm",
    "find",
    "search",
    "obtain",
  ],
  craft: ["craft", "crafting", "make", "making", "create", "forge"],
  smelt: ["smelt", "smelting", "cook", "cooking", "melt"],
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
  use: ["use", "rightclick", "activateitem", "interact", "open"],
  click: ["click", "leftclick", "pick", "choose"],
  close: ["close", "exit", "leave"],
  hotbar: ["hotbar", "slot"],
  join: ["join", "play", "connect"],
  respawn: ["respawn", "revive"],
  unstuck: ["unstuck", "escape", "recover", "unstick", "free"],
  place: ["place", "putdown"],
  sleep: ["sleep", "bed", "rest", "nap"],
  pickup: ["pickup", "loot", "grabdrops", "collectdrops"],
  death: ["deathpoint", "deathpos", "grave", "corpse", "return"],
  plan: ["plan"],
  queue: ["queue", "enqueue", "tasks"],
  store: ["store", "deposit", "stash"],
  withdraw: ["withdraw"],
  bucket: ["fill", "bucket"],
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
    if (botName.length >= 5) {
      const nickPrefix = botName
        .slice(0, 4)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      s = s.replace(new RegExp(`^@?${nickPrefix}[a-z0-9_]*[,:]?\\s+`, "i"), "");
    }
  }
  // Strip repeated conversational prefixes like "no bro you do it make..." or "just start following me"
  for (let i = 0; i < 4; i++) {
    const next = s
      .replace(
        /^(?:no|nah|yo|hey|hi|bro|dude|man|mate|bot|please|pls|plz|just|now|then|and|also|ok|okay)[,!]?\s+/i,
        "",
      )
      .replace(
        /^(?:can you|could you|would you|i want you to|you do it|do it|go ahead and)\s+/i,
        "",
      )
      .replace(
        /^start\s+(following|hunting|chasing|mining|digging|chopping|crafting|making|smelting|cooking|attacking|fighting|guarding|walking|moving|running)\b/i,
        "$1",
      );
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\s+-\s+.*$/, "").trim();
  s = s.replace(/[.!?]+$/, "").trim();
  // Common Polish chat commands ("idz za mna", "chodz tu", "stoj", "zrob kilof", "wykop drewno")
  s = s
    .replace(/^id[zź]\s+za\s+mn[aą](?=\s|$)/i, "follow me")
    .replace(/^chod[zź]\s+(?:tu|tutaj|do\s+mnie)(?=\s|$)/i, "come to me")
    .replace(/^(?:st[oó]j|zatrzymaj\s+si[eę]|przesta[nń])(?=\s|$)/i, "stop")
    .replace(/^(?:ubierz|ekwipuj)\s+si[eę](?=\s|$)/i, "gear up")
    .replace(
      /^(?:odblokuj\s+si[eę]|wydosta[nń]\s+si[eę]|wyjd[zź]\s+z\s+dziury)(?=\s|$)/i,
      "unstuck",
    )
    .replace(/^(?:wykop|kop|zbierz|nar[aą]b)\s+/i, "mine ")
    .replace(/^(?:zr[oó]b|stw[oó]rz|scraftuj)\s+(?:sobie\s+)?/i, "craft ")
    .replace(/^(?:przepal|upiecz)\s+/i, "smelt ")
    .replace(/^(?:atakuj|zabij|bij)\s+/i, "attack ")
    .replace(/^(?:bro[nń]|chro[nń])\s+/i, "guard ")
    .replace(/^(?:zjedz|jedz)(?=\s|$)/i, "eat")
    .replace(/^skocz(?=\s|$)/i, "jump")
    .replace(/\bdrewniany\s+kilof\b/gi, "wooden_pickaxe")
    .replace(/\bkamienny\s+kilof\b/gi, "stone_pickaxe")
    .replace(/\b[zż]elazny\s+kilof\b/gi, "iron_pickaxe")
    .replace(/\bdiamentowy\s+kilof\b/gi, "diamond_pickaxe")
    .replace(/\bdrewniany\s+miecz\b/gi, "wooden_sword")
    .replace(/\bkamienny\s+miecz\b/gi, "stone_sword")
    .replace(/\b[zż]elazny\s+miecz\b/gi, "iron_sword")
    .replace(/\bdrewno\b/gi, "oak_log")
    .replace(/\bkamie[nń]\b/gi, "cobblestone");
  // Map "get out of this hole/pit/water/trap" or "climb out" to unstuck
  s = s.replace(
    /\b(?:get\s+out(?:\s+of\s+(?:here|this|the)\s+\w+|\s+of\s+here)?|climb\s+out(?:\s+of\s+\w+)?|dig\s+out\s+of\s+(?:this|the)\s+\w+)\b/gi,
    "unstuck",
  );
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
      const stripped = piece
        .replace(/^(?:just|please|pls|plz|now|also|then)\s+/i, "")
        .trim();
      const first = (stripped.split(/\s+/)[0] || "").toLowerCase();
      if (
        stripped.startsWith("/") ||
        VERB_OF.has(first) ||
        /^(turn|switch|toggle)$/.test(first)
      ) {
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
  let line = cleanLine(raw, ctx.botName)
    .replace(/(?:\s*,|\s+and)?\s*\b(etc|and so on|and more)\b\.?$/i, "")
    .replace(/^right[\s-]+click\b/i, "use")
    .replace(/^left[\s-]+click\b/i, "click")
    .trim();
  if (!line) return null;
  // Server commands like "/server kitpvp" are sent as chat.
  if (line.startsWith("/")) return `api.say({ text: ${q(line)} })`;
  // The bot's own name is who's being talked to, never the target
  // ("follow me mlodysiur" → "follow me").
  const botKey = String(ctx.botName || "").toLowerCase();
  const isBotNameOrNick = (w) => {
    if (!botKey) return false;
    const c = String(w || "")
      .toLowerCase()
      .replace(/^@|[,:!.?]+$/g, "");
    if (!c) return false;
    if (c === botKey) return true;
    return botKey.length >= 5 && c.length >= 4 && botKey.startsWith(c);
  };
  const words = line
    .split(/\s+/)
    .filter((w, i) => i === 0 || !isBotNameOrNick(w));
  const lower = words.map((w) => w.toLowerCase());
  let verb = lower[0];
  let args = words.slice(1);
  let kind = VERB_OF.get(verb);
  const who = (list) => {
    if (list.some((t) => SELF_WORDS.has(String(t || "").toLowerCase()))) {
      return sender;
    }
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
    if (
      lower[1] === "back" &&
      lower.some((w) =>
        /^(death|died|items?|drops?|grave|corpse|spot|where)$/.test(w),
      )
    ) {
      return `api.return_to_death({})`;
    }
    kind = "dir";
    verb = lower[1];
    args = words.slice(2);
  }
  // "go to bed" / "go sleep"
  if (kind === "move" && lower.some((w) => /^(bed|sleep)$/.test(w))) {
    return `api.sleep_in_bed({})`;
  }
  // "get unstuck" / "get free" / "get out"
  if (
    kind === "mine" &&
    lower[1] &&
    /^(unstuck|free|out)$/.test(lower[1])
  ) {
    return `api.unstuck({})`;
  }
  // "pick up items" / "pick up drops"
  if (kind === "click" && verb === "pick" && lower[1] === "up") {
    return `api.collect_drops({})`;
  }
  // "go mine diamonds", "go kill zombies"
  if (kind === "move" && lower[1] && !["to", "player"].includes(lower[1])) {
    const next = VERB_OF.get(lower[1]);
    if (next && !["move", "dir", "stop"].includes(next)) {
      return translateLine(words.slice(1).join(" "), ctx);
    }
  }

  // Coordinate messages: "120 64 -300", "im at 120 64 -300", "my coords are 120 64 -300", "x 120 y 64 z -300"
  if (
    !kind &&
    (/^(?:i'?m\s+at|i\s+am\s+at|my\s+coords?\s+(?:are|is)|coords?|pos|position|location|at)\b/i.test(
      line,
    ) ||
      /^\s*x\s*[:=]?\s*-?\d+/i.test(line) ||
      /^\s*-?\d+(?:\.\d+)?(?:\s*,\s*|\s+)-?\d+(?:\.\d+)?(?:\s*,\s*|\s+)-?\d+(?:\.\d+)?\s*$/.test(
        line,
      ))
  ) {
    const cleanedCoordTokens = words
      .map((w) => w.replace(/^[,xXyYzZ:=]+|[,]+$/g, ""))
      .filter(isNum)
      .map(toNum);
    if (cleanedCoordTokens.length >= 3) {
      return `api.go_to({ x: ${cleanedCoordTokens[0]}, y: ${cleanedCoordTokens[1]}, z: ${cleanedCoordTokens[2]} })`;
    }
    if (cleanedCoordTokens.length === 2) {
      return `api.go_to({ x: ${cleanedCoordTokens[0]}, z: ${cleanedCoordTokens[1]} })`;
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
      const nonNum = args.filter((t) => !isNum(t));
      const clean = cleanWords(nonNum);
      if (clean.length > 2 || clean.some((w) => VERB_OF.has(w.toLowerCase()))) {
        return { error: "who should I walk to? e.g. walk to Steve" };
      }
      const target =
        clean.length === 2 &&
        !clean.some((w) => SELF_WORDS.has(w.toLowerCase()))
          ? clean.join(" ")
          : who(args);
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
      if (
        lower.some((w) => /^(drops?|loot|ground)$/.test(w)) ||
        (verb === "collect" && lower.includes("items"))
      ) {
        return `api.collect_drops({})`;
      }
      if (
        /^(get|find|grab)$/i.test(verb) &&
        lower.some((w) => /^(death|died|grave|corpse)$/.test(w))
      ) {
        return `api.return_to_death({})`;
      }
      const nums = args.filter(isNum).map(toNum);
      const rest = cleanWords(args.filter((t) => !isNum(t))).filter(
        (t) => !SELF_WORDS.has(t.toLowerCase()),
      );
      if (!rest.length) {
        if (
          /^(find|search)$/i.test(verb) &&
          args.some((t) => SELF_WORDS.has(t.toLowerCase()))
        ) {
          return `api.come_to_player({ player: ${q(sender)} })`;
        }
        return { error: "mine what? e.g. mine 10 oak_log" };
      }
      const count = nums[0] || (/^(all|lots|many)$/i.test(rest[0]) ? 32 : 1);
      const block = rest
        .filter((t) => !/^(all|lots|many|more)$/i.test(t))
        .join("_");
      if (/^(food|meat|animals?)$/i.test(block)) {
        return `api.hunt_food({ count: ${nums[0] || 3} })`;
      }
      if (/^(water|lava)$/i.test(block)) {
        return `api.fill_bucket({ liquid: ${q(block.toLowerCase())} })`;
      }
      return `api.mine_block({ block: ${q(block)}, count: ${count} })`;
    }
    case "craft": {
      if (/^plan$/i.test(lower[1] || "")) {
        const goal = words.slice(2).join(" ").trim();
        if (!goal) return { error: "plan what? e.g. plan make iron armor" };
        return `api.create_plan({ goal: ${q(goal)} })`;
      }
      const nums = args.filter(isNum).map(toNum);
      const rest = cleanWords(args.filter((t) => !isNum(t))).filter(
        (t) =>
          !SELF_WORDS.has(t.toLowerCase()) &&
          !/^(all|lots|many|more|up|it|from|scratch|full|set)$/i.test(t),
      );
      if (!rest.length)
        return { error: "craft what? e.g. craft wooden_pickaxe" };
      const joined = rest.join("_").toLowerCase();
      const count = nums[0] || 1;
      return `api.craft_item({ item: ${q(joined)}, count: ${count} })`;
    }
    case "smelt": {
      const nums = args.filter(isNum).map(toNum);
      const rest = cleanWords(args.filter((t) => !isNum(t))).filter(
        (t) =>
          !SELF_WORDS.has(t.toLowerCase()) &&
          !/^(all|lots|many|more|up|it)$/i.test(t),
      );
      const item = rest.join("_").toLowerCase() || "raw_iron";
      const count = nums[0] || 1;
      return `api.smelt_item({ item: ${q(item)}, count: ${count} })`;
    }
    case "eat":
      return `api.eat({})`;
    case "gear": {
      const tierWord = lower.find((w) =>
        /^(leather|wood|wooden|stone|gold|golden|iron|diamond|netherite)$/.test(
          w,
        ),
      );
      const wantsGearUp =
        verb === "gearup" ||
        lower.includes("up") ||
        Boolean(tierWord) ||
        lower.some((w) =>
          /^(find|mine|craft|make|full|progression|get)$/.test(w),
        );
      if (wantsGearUp) {
        const tier =
          tierWord === "wooden"
            ? "wood"
            : tierWord === "golden"
              ? "gold"
              : tierWord;
        return tier
          ? `api.start_script({ name: "GearUp", options: { tier: ${q(tier)} } })`
          : `api.start_script({ name: "GearUp" })`;
      }
      return `api.equip_best_gear({})`;
    }
    case "hold": {
      if (/^slot$/i.test(lower[1] || "") && isNum(lower[2] || ""))
        return `api.hotbar({ slot: ${toNum(lower[2])} })`;
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
      if (
        verb === "back" &&
        lower.some((w) =>
          /^(death|died|items?|drops?|grave|corpse|spot|where)$/.test(w),
        )
      ) {
        return `api.return_to_death({})`;
      }
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
      const rest = cleanWords(args).filter(
        (t) => !/^(menu|gui|it|on|with)$/i.test(t),
      );
      return rest.length
        ? `api.use_item({ item: ${q(rest.join("_"))} })`
        : `api.use_item({})`;
    }
    case "click": {
      // "click kitpvp", "click slot 13", "click the KitPvP item"
      if (/^right$/i.test(lower[1] || "") && words.length === 2)
        return `api.use_item({})`;
      const n = args.find(isNum);
      if (n && /^slot$/i.test(lower[1] || ""))
        return `api.click_slot({ slot: ${toNum(n)} })`;
      const rest = cleanWords(args).filter(
        (t) => !/^(on|button|icon|option|menu|gui|container|in)$/i.test(t),
      );
      if (!rest.length) return { error: "click what? e.g. click kitpvp" };
      return `api.click_slot({ name: ${q(rest.join(" "))} })`;
    }
    case "join": {
      const rest = cleanWords(args).filter(
        (t) => !/^(game|server|mode|lobby|match)$/i.test(t),
      );
      if (!rest.length) return { error: "join what? e.g. join kitpvp" };
      return `api.join_game({ name: ${q(rest.join(" "))}, allowCommand: true })`;
    }
    case "guard":
    case "hunt": {
      if (
        kind === "hunt" &&
        lower.some((w) =>
          /^(food|meat|animals?|cows?|pigs?|sheep|chickens?|rabbits?)$/.test(w),
        )
      ) {
        const nums = args.filter(isNum).map(toNum);
        return `api.hunt_food({ count: ${nums[0] || 3} })`;
      }
      const target = who(args);
      if (!target) return { error: `${kind} who? e.g. ${kind} Steve` };
      const mod = kind === "guard" ? "Guard" : "Hunt";
      return `api.start_script({ name: ${q(mod)}, options: { playername: ${q(target)} } })`;
    }
    case "close":
      return `api.close_window({})`;
    case "hotbar": {
      const n = args.find(isNum);
      if (!n) return { error: "which slot? e.g. hotbar 1" };
      return `api.hotbar({ slot: ${toNum(n)} })`;
    }
    case "respawn":
      return `api.respawn({})`;
    case "unstuck":
      return `api.unstuck({})`;
    case "place": {
      const rest = cleanWords(args.filter((t) => !isNum(t))).filter(
        (t) =>
          !SELF_WORDS.has(t.toLowerCase()) && !/^(down|here|nearby)$/i.test(t),
      );
      if (!rest.length)
        return { error: "place what? e.g. place crafting_table" };
      return `api.place_block({ block: ${q(rest.join("_"))} })`;
    }
    case "sleep":
      return `api.sleep_in_bed({})`;
    case "pickup":
      return `api.collect_drops({})`;
    case "death":
      return `api.return_to_death({})`;
    case "plan": {
      const goal = args.join(" ").trim();
      if (!goal || /^(status|show|list)$/i.test(goal)) {
        return `api.get_queue({})`;
      }
      return `api.create_plan({ goal: ${q(goal)} })`;
    }
    case "queue": {
      const cmdText = args.join(" ").trim();
      if (!cmdText || /^(status|show|list)$/i.test(cmdText)) {
        return `api.get_queue({})`;
      }
      return `api.queue_task({ commands: ${q(cmdText)} })`;
    }
    case "store": {
      const nums = args.filter(isNum).map(toNum);
      const rest = cleanWords(args.filter((t) => !isNum(t))).filter(
        (t) => !/^(in|into|chest|barrel|container)$/i.test(t),
      );
      const item = rest.join("_") || "all";
      return `api.store_items({ item: ${q(item)}${nums[0] ? `, count: ${nums[0]}` : ""} })`;
    }
    case "withdraw": {
      const nums = args.filter(isNum).map(toNum);
      const rest = cleanWords(args.filter((t) => !isNum(t))).filter(
        (t) => !/^(from|out|chest|barrel|container)$/i.test(t),
      );
      const item = rest.join("_") || "all";
      return `api.take_items({ item: ${q(item)}${nums[0] ? `, count: ${nums[0]}` : ""} })`;
    }
    case "bucket": {
      const liq = lower.includes("lava") ? "lava" : "water";
      return `api.fill_bucket({ liquid: ${q(liq)} })`;
    }
    default:
      return { error: `don't know "${words[0]}"` };
  }
}

const HELP = [
  "walk to Steve | walk 100 64 -20 | come here | return to death",
  "follow Steve | stop | unstuck | collect drops | sleep",
  "look at Steve | attack zombie | attack hostile | attack Steve",
  "plan make iron armor | queue mine 5 oak_log | mine 10 oak_log | craft iron_armor | smelt iron | gear up to iron | hunt food | store all | fill bucket | place crafting_table | eat | gear | hold diamond_sword | drop 5 dirt | drop all",
  "say hello | wait 3 | jump 2 | sneak on | sprint off | forward 2 | left 1",
  "turn on KillAura players=on range=4 | turn off KillAura | stop all scripts",
  "set Spam message hi | status | queue | logs 20 | logs error | scripts | respawn",
  "guard Steve | hunt Steve | join kitpvp | use compass | click kitpvp | click slot 13 | close | hotbar 1 | /server kitpvp",
].join("\n");

// Short list for errors, so models don't copy example sentences into chat.
const VERB_LIST =
  "walk, follow, stop, unstuck, look, attack, mine, craft, smelt, plan, queue, gear up, hunt food, store, place, collect drops, sleep, return, eat, gear, hold, drop, say, wait, jump, sneak, forward, use, click, close, hotbar, join, guard, hunt, turn on, turn off, set, status, logs, scripts, /command";

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
      /^api\.(mine_block|craft_item|smelt_item|attack|hunt_food|store_items|take_items|fill_bucket|wait|jump|walk_direction)\(/.test(
        s.js,
      ) ||
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
  VERB_LIST,
};
