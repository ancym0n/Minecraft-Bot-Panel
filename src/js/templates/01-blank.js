// @template Blank script | Minimal skeleton with one option and a repeating tick
const info = {
  name: "MyScript",
  default: { interval: 2000 },
  options: [
    { type: "checkbox", label: "Repeat", id: "repeat" },
    { type: "input", label: "Message", id: "message" },
  ],
};

// bot: Mineflayer bot · log/clearLog: console output · getOption(id, name)
// returns strings ("on"/"off" for checkboxes) · scriptRepeater(fn, ms) runs fn
// until the script is toggled off · libs: { goals, Vec3, mcData, Movements }
async function script(bot, log, clearLog, getOption, scriptRepeater, libs) {
  if (!bot || !bot.entity) return log(`${info.name}: Connect a bot first`);

  async function tick() {
    const message = (await getOption("message", info.name)) || "Hello!";
    log(`${info.name}: ${message}`);
  }

  await tick();
  if ((await getOption("repeat", info.name)) === "on") {
    await scriptRepeater(tick, info.default.interval);
  }
}

module.exports = { info, script };
