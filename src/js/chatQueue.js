// Many servers reject emojis and fancy symbols ("Plain text messages only").
function plainChat(text) {
  return String(text || "")
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu,
      "",
    )
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Sends AI chat output in paced chunks so servers' anti-spam filters
// don't kick the bot: typing delay, randomized gaps, duplicate guard.
class ChatQueue {
  constructor({ getBot, getConfig, log = () => {} }) {
    this.getBot = getBot;
    this.getConfig = getConfig;
    this.log = log;
    this.queue = [];
    this.running = false;
    this.lastSentAt = 0;
    this.recent = [];
    this.generation = 0;
  }

  clear() {
    this.generation += 1;
    const pending = this.queue.splice(0);
    pending.forEach((item) => item.resolve(false));
    this.running = false;
  }

  isBusy() {
    return this.running || this.queue.length > 0;
  }

  // Resends the last message once, e.g. after "move before using chat".
  resendLast() {
    const last = this.lastMessage;
    if (!last || Date.now() - last.at > 20000 || last.resent) return false;
    last.resent = true;
    this.recent = this.recent.filter((r) => r.norm !== last.norm);
    this.send([last.text]);
    return true;
  }

  // Resolves once every part has been sent (or dropped).
  send(parts) {
    const list = (Array.isArray(parts) ? parts : [parts])
      .map((p) => plainChat(p))
      .filter(Boolean);
    if (!list.length) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.queue.push({ parts: list, resolve });
      this.pump();
    });
  }

  isDuplicate(text) {
    const now = Date.now();
    this.recent = this.recent.filter((r) => now - r.at < 30000);
    const norm = text.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return this.recent.some((r) => r.norm === norm);
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    while (this.queue.length && gen === this.generation) {
      const item = this.queue.shift();
      let sentAny = false;
      for (let i = 0; i < item.parts.length; i++) {
        if (gen !== this.generation) break;
        const text = item.parts[i];
        const cfg = this.getConfig() || {};
        const baseGap =
          Math.max(0.5, Number(cfg.messageDelaySec) || 1.6) * 1000;
        const jitter = baseGap * (0.15 + Math.random() * 0.35);
        // First part simulates typing; later parts respect the gap.
        const typing =
          i === 0 ? Math.min(2400, 500 + text.length * 28) : baseGap + jitter;
        const sinceLast = Date.now() - this.lastSentAt;
        const minGap = baseGap + jitter;
        await wait(Math.max(typing, minGap - sinceLast));
        if (gen !== this.generation) break;

        const bot = this.getBot();
        if (!bot || typeof bot.chat !== "function") break;
        if (this.isDuplicate(text)) {
          this.log(`AIChat: Skipped duplicate message to avoid spam kick`);
          continue;
        }
        try {
          bot.chat(text.slice(0, 250));
          sentAny = true;
          this.lastSentAt = Date.now();
          const norm = text.toLowerCase().replace(/[^a-z0-9]+/g, "");
          this.recent.push({ at: this.lastSentAt, norm });
          this.lastMessage = {
            text,
            norm,
            at: this.lastSentAt,
            resent: Boolean(
              this.lastMessage?.resent && this.lastMessage.norm === norm,
            ),
          };
        } catch (err) {
          this.log(`AIChat: Failed to send chat: ${err.message || err}`);
          break;
        }
      }
      item.resolve(sentAny);
    }
    if (gen === this.generation) this.running = false;
  }
}

module.exports = { ChatQueue };
