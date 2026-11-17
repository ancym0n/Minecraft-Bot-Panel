const { ollamaManager } = require("../ollamaManager");
const { prepareOllama } = require("./chatai");

// Lets the local AI run bot functions (walk, follow, mine, fight, toggle
// scripts...) when players ask in chat. Options sync with the AI tab.
const info = {
  name: "AIAgent",
  default: { interval: 3000 },
  aiSync: true,
  options: [
    { type: "checkbox", label: "Reply to All Chat", id: "replyall" },
    { type: "select", label: "Actions Model", id: "agentmodel", choices: [] },
    {
      type: "input",
      label: "Allowed Players",
      id: "players",
      placeholder: "Empty = everyone",
    },
    { type: "checkbox", label: "Allow Code", id: "allowcode" },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  clearLog("AIAgent:");
  await ollamaManager.getStatus();
  const res = await prepareOllama(log, clearLog, "AIAgent", {
    model: () => ollamaManager.resolveAgentModel(),
    isActive: () => Boolean(ollamaManager.config.agentEnabled),
  });
  if (res.ok) {
    const cfg = ollamaManager.config;
    const allowed = String(cfg.agentAllowedPlayers || "").trim();
    const code = cfg.agentAllowCode && allowed ? " · can run code" : "";
    log(
      `AIAgent: Ready (${res.model} · obeys ${allowed || "everyone"}${code}) · try "${bot?.username || "bot"}, come here"`,
    );
  }
  await scriptRepeater(() => {}, info.default.interval);
}

module.exports = { info, script };
