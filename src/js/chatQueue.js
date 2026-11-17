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

  // Resolves once every part has been sent (or dropped).
  send(parts) {
    const list = (Array.isArray(parts) ? parts : [parts])
      .map((p) => String(p || "").trim())
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
          this.log(`ChatAI: Skipped duplicate message to avoid spam kick`);
          continue;
        }
        try {
          bot.chat(text.slice(0, 250));
          sentAny = true;
          this.lastSentAt = Date.now();
          this.recent.push({
            at: this.lastSentAt,
            norm: text.toLowerCase().replace(/[^a-z0-9]+/g, ""),
          });
        } catch (err) {
          this.log(`ChatAI: Failed to send chat: ${err.message || err}`);
          break;
        }
      }
      item.resolve(sentAny);
    }
    if (gen === this.generation) this.running = false;
  }
}

module.exports = { ChatQueue };
