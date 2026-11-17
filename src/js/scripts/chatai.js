const { ollamaManager } = require("../ollamaManager");

const info = {
  name: "ChatAI",
  default: { interval: 2000 },
  options: [
    {
      type: "checkbox",
      label: "Reply to All Chat",
      id: "replyall",
    },
    {
      type: "checkbox",
      label: "Game State Context",
      id: "context",
    },
    {
      type: "input",
      label: "Ollama Model",
      id: "model",
    },
    {
      type: "input",
      label: "Cooldown [sec]",
      id: "cooldown",
    },
    {
      type: "input",
      label: "Persona / Prompt",
      id: "persona",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  const [replyAllOpt, contextOpt, rawModel, rawCooldown, rawPersona] =
    await Promise.all([
      getOption("replyall", info.name),
      getOption("context", info.name),
      getOption("model", info.name),
      getOption("cooldown", info.name),
      getOption("persona", info.name),
    ]);

  const parsedCooldown = parseFloat(rawCooldown);
  const cooldownSec =
    Number.isFinite(parsedCooldown) &&
    parsedCooldown >= 1 &&
    parsedCooldown <= 120
      ? parsedCooldown
      : ollamaManager.config.cooldownSec || 4;

  const updates = {
    enabled: true,
    triggerMode: replyAllOpt === "on" ? "all" : "mention",
    includeBotContext: contextOpt !== "off",
    cooldownSec,
  };
  if (rawModel && String(rawModel).trim()) {
    updates.model = String(rawModel).trim();
  }
  if (rawPersona && String(rawPersona).trim()) {
    updates.systemPrompt = String(rawPersona).trim();
  }

  ollamaManager.saveConfig(updates);

  const status = await ollamaManager.getStatus();
  const targetModel =
    ollamaManager.config.model ||
    status.hardware?.recommendedModel ||
    "qwen2.5:1.5b";

  clearLog("ChatAI:");
  if (!status.serverRunning) {
    log(`ChatAI: Starting local Ollama & preparing ${targetModel}...`);
    const setupRes = await ollamaManager.autoSetup({
      preferredModel: targetModel,
      onProgress: (p) => {
        if (p?.message) {
          clearLog("ChatAI:");
          log(`ChatAI: ${p.message}`);
        }
      },
    });
    if (!setupRes.ok) {
      log(`ChatAI error: ${setupRes.error}`);
    } else {
      log(
        `ChatAI: Ready (${setupRes.model} · ${updates.triggerMode === "all" ? "All chat" : "Mentions"})`,
      );
    }
  } else {
    log(
      `ChatAI: Armed (${targetModel} · ${updates.triggerMode === "all" ? "All chat" : "Mentions"} · ${cooldownSec}s cooldown)`,
    );
  }

  async function syncOptions() {
    const [liveReplyAll, liveContext, liveModel, liveCooldown, livePersona] =
      await Promise.all([
        getOption("replyall", info.name),
        getOption("context", info.name),
        getOption("model", info.name),
        getOption("cooldown", info.name),
        getOption("persona", info.name),
      ]);
    const cd = parseFloat(liveCooldown);
    const next = {
      enabled: true,
      triggerMode: liveReplyAll === "on" ? "all" : "mention",
      includeBotContext: liveContext !== "off",
    };
    if (Number.isFinite(cd) && cd >= 1 && cd <= 120) {
      next.cooldownSec = cd;
    }
    if (liveModel && String(liveModel).trim()) {
      next.model = String(liveModel).trim();
    }
    if (livePersona && String(livePersona).trim()) {
      next.systemPrompt = String(livePersona).trim();
    }
    ollamaManager.saveConfig(next);
    if (bot) {
      bot._mcbpChatAiEnabled = true;
    }
  }

  await syncOptions();
  await scriptRepeater(syncOptions, info.default.interval);
}

module.exports = {
  info,
  script,
};
