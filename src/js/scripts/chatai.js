const { ollamaManager } = require("../ollamaManager");

// Options here are two-way synced with the AI tab (same saved config),
// so the panel writes changes straight to the AI settings.
const info = {
  name: "AIChat",
  default: { interval: 3000 },
  aiSync: true,
  options: [
    { type: "checkbox", label: "Reply to All Chat", id: "replyall" },
    { type: "checkbox", label: "Game State Context", id: "context" },
    { type: "checkbox", label: "Split Long Replies", id: "split" },
    { type: "select", label: "Model", id: "model", choices: [] },
    { type: "input", label: "Cooldown [sec]", id: "cooldown" },
    { type: "input", label: "Message Gap [sec]", id: "gap" },
    { type: "input", label: "Persona / Prompt", id: "persona" },
  ],
};

// Makes sure Ollama runs and the model is downloaded and loaded in memory.
// Progress stops being logged once the script is switched off; a download
// that is already running is shared, never started twice.
async function prepareOllama(log, clearLog, tag, { model, isActive }) {
  const status = await ollamaManager.getStatus();
  if (!isActive()) return { ok: false, cancelled: true };
  const targetModel = model();
  if (ollamaManager.isRemote()) {
    if (!status.serverRunning) {
      const error = "DeepSeek API key is missing";
      log(`${tag} error: ${error}`);
      return { ok: false, error };
    }
    return { ok: true, model: targetModel };
  }
  const hasModel = status.installedModels.some(
    (m) => m.name === targetModel || m.name === `${targetModel}:latest`,
  );

  if (!status.serverRunning || !hasModel) {
    if (!hasModel) {
      log(
        `${tag}: Downloading ${targetModel} (one time)${ollamaManager.isPulling(targetModel) ? ", already in progress" : ""}...`,
      );
    }
    let lastPct = -10;
    let lastStage = "";
    const res = await ollamaManager.autoSetup({
      preferredModel: targetModel,
      keepModel: true,
      onProgress: (p) => {
        if (!isActive() || !p?.message) return;
        const pct = typeof p.percent === "number" ? p.percent : 0;
        if (p.stage === lastStage && pct - lastPct < 10 && pct < 100) return;
        lastStage = p.stage;
        lastPct = pct;
        clearLog(`${tag}:`);
        log(`${tag}: ${p.message}`);
      },
    });
    if (!isActive()) return { ok: false, cancelled: true };
    clearLog(`${tag}:`);
    if (!res.ok) {
      log(`${tag} error: ${res.error}`);
      return res;
    }
  }

  if (!isActive()) return { ok: false, cancelled: true };
  const warm = Date.now();
  await ollamaManager.warmUp(targetModel);
  if (Date.now() - warm > 1500 && isActive()) {
    log(`${tag}: Loaded ${targetModel} into memory`);
  }
  return { ok: isActive(), model: targetModel };
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  clearLog("AIChat:");
  const res = await prepareOllama(log, clearLog, "AIChat", {
    model: () => ollamaManager.resolveModel(),
    isActive: () =>
      !scriptRepeater.signal?.aborted && Boolean(ollamaManager.config.enabled),
  });
  if (res.ok) {
    const cfg = ollamaManager.config;
    log(
      `AIChat: Ready (${res.model} · ${cfg.triggerMode === "all" ? "all chat" : "mentions"} · ${cfg.splitMessages ? `split, ${cfg.messageDelaySec}s gap` : "single message"})`,
    );
  }
  // Stay alive while toggled on; the chat listener does the replying.
  if (!scriptRepeater.signal?.aborted)
    await scriptRepeater(() => {}, info.default.interval);
}

module.exports = { info, script, prepareOllama };
