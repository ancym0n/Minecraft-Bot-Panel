let info = {
  name: "Mine",
  default: { interval: 5000 },
  options: [
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
    },
    {
      type: "input",
      label: "Block ID",
      id: "blockId",
    },
  ],
};

function script(bot, log, clearLog, getOption, scriptRepeater) {
  const { goals } = require("mineflayer-pathfinder");
  getOption("blockId", info.name).then((blockId) => {
    function mine() {
      blockName = blockId;
      function startMining() {
        const blockId = getBlockIdByName(blockName);

        if (!blockId) {
          log(`Block "${blockName}" not found.`);
          return;
        }

        const targetBlock = findBlockToMine(blockId);

        if (targetBlock) {
          clearLog("Mining ");
          log(`Mining ${targetBlock.name} ${targetBlock.position}`);
          walkToBlock(targetBlock.position);
        } else clearLog("Mining ");
      }

      function getBlockIdByName(name) {
        const block = bot.registry.blocksByName[name];
        return block ? block.id : null;
      }

      function findBlockToMine(blockId) {
        const block = bot.findBlock({
          matching: blockId,
          maxDistance: 100,
        });
        return block;
      }

      function walkToBlock(position) {
        bot.pathfinder.setGoal(
          new goals.GoalBlock(position.x, position.y, position.z)
        );
      }
      startMining();
    }

    getOption("repeat", info.name).then((r) => {
      if (r === "on") {
        scriptRepeater(mine, info.default.interval).then(() => {
          return;
        });
      } else mine();
    });
  });
}

module.exports = {
  info,
  script,
};
