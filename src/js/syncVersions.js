#!/usr/bin/env node
// Standalone script (`npm run update:mineflayer`) that updates mineflayer,
// minecraft-data, and mineflayer-pathfinder to the latest versions on npm
// and prints the active Minecraft version range.
const { syncLatestMineflayer, getRuntimeInfo } = require("./runtime");

async function main() {
  console.log("[MCBP] Checking npm for latest Mineflayer & minecraft-data...");
  const info = await syncLatestMineflayer({
    onLog: (msg) => console.log(`[MCBP] ${msg}`),
  });
  console.log(
    `[MCBP] Mineflayer v${info.mineflayerVersion} | minecraft-data v${info.mcDataVersion} | pathfinder v${info.pathfinderVersion}`,
  );
  console.log(`[MCBP] Supported Minecraft versions: ${info.versionRange}`);
}

main().catch((err) => {
  console.error("[MCBP] Error syncing Mineflayer:", err.message || err);
  const fallback = getRuntimeInfo();
  console.log(`[MCBP] Fallback version range: ${fallback.versionRange}`);
});
