// Fool-proof outgoing chat. Wraps bot.chat once per bot so EVERY path (panel
// input, AI replies, the say tool, Spam, botting, custom scripts) gets:
//  - cleaning: no newlines, control chars, section signs, zero-width or emoji
//    junk that servers kick for ("Illegal characters in chat")
//  - splitting: long text is cut on word boundaries into <=256-char messages
//    instead of being truncated or rejected
//  - pacing: a minimum gap between messages so anti-spam does not kick
//  - listening: reacts to what the server says back - plain-text only,
//    muted / can't chat here, slow down, don't repeat - and adapts
//    (ASCII mode + one resend, longer gaps, pausing chat, varying repeats)

const MAX_LEN = 256;
const MAX_QUEUE = 25;
const BASE_GAP_MS = 700;
const MAX_GAP_MS = 6000;

const PLAIN_TEXT_RE =
  /plain text (messages )?only|only plain text|(illegal|invalid|disallowed|unsupported|not allowed) (characters?|symbols?)|characters? (are|is) not allowed|use (only )?(english|ascii|latin)|non[- ]?(ascii|english|latin)/i;
const MUTED_RE =
  /you (are|have been|were) (currently )?(muted|silenced)|you can'?t (talk|chat|speak) (here|right now|yet|while)|sorry,? but you can'?t chat|chat is (currently )?(disabled|muted|locked|off)|you (do not|don'?t) have permission to (chat|talk|speak)|you need to (verify|register|login|log in) (before|to) (chat|talk)/i;
const SLOW_RE =
  /slow down|(too|chatting too) (fast|quick)ly?|please wait (\d+ ?(s|sec|seconds?) )?before (chatting|sending|talking)|you('?re| are) (sending|typing) (messages )?too (fast|quickly)|chat (cooldown|delay)|wait \d+ ?(s|sec|seconds?) (before|to) (chat|talk|send)|don'?t spam|stop spamming|spam(ming)? (detected|is not allowed)/i;
const REPEAT_RE =
  /(please )?(don'?t|do not) repeat|(same|similar|identical|duplicate) message|you (already|just) said (that|this)|repeated message/i;
const WAIT_SECONDS_RE = /(\d{1,3}) ?(s|sec|secs|seconds?)\b/i;

// Accents -> plain letters, then drop anything outside printable ASCII.
function toAscii(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00DF]/g, "ss")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Characters vanilla rejects (kick: "Illegal characters in chat") plus
// invisible junk models and pasted text often contain.
function cleanChat(text, { ascii = false } = {}) {
  let s = String(text ?? "")
    .replace(/\r?\n|\r|\t/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/\u00A7./g, "") // section-sign colour codes
    .replace(/\u00A7/g, "")
    .replace(/[\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFE0F\u200D]/g, "")
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{E000}-\u{F8FF}]/gu,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
  if (ascii) s = toAscii(s);
  return s;
}

// Splits on word boundaries into parts of at most `max` chars. Commands are
// never split (a split command would run with half its arguments).
function splitChat(text, max = MAX_LEN) {
  const s = String(text || "");
  if (s.length <= max) return s ? [s] : [];
  if (s.startsWith("/")) return [s.slice(0, max)];
  const parts = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

const norm = (t) =>
  String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

class ChatGuard {
  constructor(bot, { log = () => {}, rawChat }) {
    this.bot = bot;
    this.log = log;
    this.rawChat = rawChat;
    this.queue = [];
    this.timer = null;
    this.lastSentAt = 0;
    this.gapMs = BASE_GAP_MS;
    this.ascii = false;
    this.mutedUntil = 0;
    this.last = null; // { text, at, asciiResent }
    this.recent = []; // [{ n, at }]
    this.stats = { sent: 0, dropped: 0, resent: 0 };
  }

  // Public entry point (replaces bot.chat).
  chat(message) {
    const isCommand = String(message ?? "")
      .trimStart()
      .startsWith("/");
    const cleaned = cleanChat(message, { ascii: this.ascii && !isCommand });
    if (!cleaned) return;
    const parts = splitChat(cleaned);
    for (const text of parts) {
      if (this.queue.length >= MAX_QUEUE) {
        this.stats.dropped += 1;
        if (this.stats.dropped === 1 || this.stats.dropped % 10 === 0) {
          this.log(
            `Chat: Too many messages queued \u2014 dropping extras (${this.stats.dropped} dropped)`,
          );
        }
        return;
      }
      this.queue.push({ text, isCommand, at: Date.now() });
    }
    // A command must not sit behind a long "muted" wait for normal chat.
    if (isCommand && this.timer && Date.now() < this.mutedUntil) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pump();
  }

  // While muted, commands may jump ahead of the held chat messages.
  nextIndex(now = Date.now()) {
    if (now >= this.mutedUntil) return 0;
    const i = this.queue.findIndex((q) => q.isCommand);
    return i >= 0 ? i : 0;
  }

  pump() {
    if (this.timer || !this.queue.length) return;
    const now = Date.now();
    const next = this.queue[this.nextIndex(now)];
    let wait = Math.max(0, this.lastSentAt + this.gapMs - now);
    // Muted / "can't chat here": hold normal chat, commands still go through.
    if (!next.isCommand && now < this.mutedUntil)
      wait = Math.max(wait, this.mutedUntil - now);
    // Not in the world yet (login / server switch): try again shortly.
    if (!this.bot?.entity || this.bot._client?.state === "configuration")
      wait = Math.max(wait, 400);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushOne();
      this.pump();
    }, wait);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  flushOne() {
    const now = Date.now();
    const idx = this.nextIndex(now);
    const item = this.queue[idx];
    if (!item) return;
    if (!this.bot?.entity || this.bot._client?.state === "configuration") {
      if (now - item.at > 20000) {
        this.queue.splice(idx, 1);
        this.log(
          `Chat: Dropped "${item.text.slice(0, 40)}" (not in a world for 20s)`,
        );
      }
      return;
    }
    if (!item.isCommand && now < this.mutedUntil) return;
    this.queue.splice(idx, 1);
    let text = item.text;
    if (this.ascii && !item.isCommand) {
      text = toAscii(text);
      if (!text) return;
    }
    // Same text again within 30s: many servers block exact repeats, so add a
    // harmless variation instead of getting it eaten (or the bot warned).
    if (!item.isCommand) {
      this.recent = this.recent.filter((r) => now - r.at < 30000);
      if (
        this.recent.some((r) => r.n === norm(text)) &&
        text.length < MAX_LEN - 1
      ) {
        text = /[.!?]$/.test(text) ? text.slice(0, -1) : `${text}.`;
      }
    }
    try {
      this.rawChat(text);
      this.lastSentAt = Date.now();
      this.stats.sent += 1;
      if (!item.isCommand) {
        this.recent.push({ n: norm(text), at: this.lastSentAt });
        this.last = {
          text: item.text,
          at: this.lastSentAt,
          asciiResent: false,
        };
      }
      // Calm back down after a while without complaints.
      if (
        this.gapMs > BASE_GAP_MS &&
        this.lastSentAt - (this.slowAt || 0) > 60000
      ) {
        this.gapMs = Math.max(BASE_GAP_MS, Math.round(this.gapMs * 0.75));
      }
    } catch (err) {
      this.log(`Chat: Failed to send: ${err.message || err}`);
    }
  }

  // Server text (system / chat lines) - adapt to what the server says.
  onServerText(raw, position = "system") {
    // Only the server's own messages count: a player typing "slow down" or
    // "you can't chat here" must not change how the bot chats.
    if (position === "chat") return;
    const text = String(raw || "");
    if (!text || text.length > 300) return;
    if (this.last && text.includes(this.last.text.slice(0, 24))) return; // our own echo
    const now = Date.now();
    const recentlySent = this.last && now - this.last.at < 6000;
    if (PLAIN_TEXT_RE.test(text) && recentlySent) {
      if (!this.ascii) {
        this.ascii = true;
        this.log(
          "Chat: Server only accepts plain text \u2014 switching to plain ASCII chat",
        );
      }
      const plain = toAscii(this.last.text);
      if (!this.last.asciiResent && plain && plain !== this.last.text) {
        this.last.asciiResent = true;
        this.stats.resent += 1;
        this.queue.unshift({ text: plain, isCommand: false, at: now });
        this.pump();
      }
      return;
    }
    if (MUTED_RE.test(text) && recentlySent) {
      const secs = Number(text.match(WAIT_SECONDS_RE)?.[1]) || 60;
      const until = now + Math.min(600, secs) * 1000;
      if (until > this.mutedUntil + 1000) {
        this.log(
          `Chat: Server is blocking our chat here \u2014 holding messages for ${Math.round((until - now) / 1000)}s`,
        );
      }
      this.mutedUntil = until;
      return;
    }
    if (SLOW_RE.test(text) && recentlySent) {
      const secs = Number(text.match(WAIT_SECONDS_RE)?.[1]) || 0;
      this.slowAt = now;
      this.gapMs = Math.min(
        MAX_GAP_MS,
        Math.max(this.gapMs * 2, secs * 1000 + 250),
      );
      this.log(
        `Chat: Server asked to slow down \u2014 spacing messages ${(this.gapMs / 1000).toFixed(1)}s apart`,
      );
      return;
    }
    if (REPEAT_RE.test(text) && recentlySent) {
      this.slowAt = now;
      this.gapMs = Math.min(MAX_GAP_MS, Math.max(this.gapMs, 2500));
    }
  }

  // A kick for spam / illegal characters: remember for the next session.
  onKick(reason) {
    const text =
      typeof reason === "string" ? reason : JSON.stringify(reason || "");
    if (/illegal characters|plain text|invalid characters/i.test(text))
      this.ascii = true;
    if (/spam|too fast|flood/i.test(text))
      this.gapMs = Math.min(MAX_GAP_MS, Math.max(this.gapMs, 2000));
  }

  status() {
    return {
      queued: this.queue.length,
      gapMs: this.gapMs,
      asciiOnly: this.ascii,
      mutedForMs: Math.max(0, this.mutedUntil - Date.now()),
      ...this.stats,
    };
  }

  clear() {
    this.queue.length = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

// Per-server memory so a reconnect keeps ASCII mode / slower pacing.
const serverPrefs = new Map();

function installChatGuard(bot, { log = () => {}, serverKey = "" } = {}) {
  if (!bot || typeof bot.chat !== "function") return null;
  if (bot._mcbpChatGuard) return bot._mcbpChatGuard;
  const rawChat = bot.chat.bind(bot);
  const guard = new ChatGuard(bot, { log, rawChat });
  const prefs = serverKey ? serverPrefs.get(serverKey) : null;
  if (prefs) {
    guard.ascii = Boolean(prefs.ascii);
    guard.gapMs = Math.max(BASE_GAP_MS, Number(prefs.gapMs) || BASE_GAP_MS);
  }
  bot._mcbpRawChat = rawChat;
  bot._mcbpChatGuard = guard;
  bot.chat = (message) => guard.chat(message);
  const onText = (text, position) => guard.onServerText(text, position);
  bot.on("messagestr", onText);
  bot.on("kicked", (reason) => guard.onKick(reason));
  bot.once("end", () => {
    if (serverKey)
      serverPrefs.set(serverKey, { ascii: guard.ascii, gapMs: guard.gapMs });
    guard.clear();
  });
  return guard;
}

module.exports = {
  installChatGuard,
  cleanChat,
  splitChat,
  toAscii,
  ChatGuard,
  MAX_LEN,
};
