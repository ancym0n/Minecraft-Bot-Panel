// Baritone / Fabritone-inspired pathfinding engine for Minecraft Bot Panel.
const ActionCosts = require("./actionCosts");
const {
  BacktrackMemory,
  ToolSet,
  CalculationContext,
} = require("./calculationContext");
const {
  BaritoneAStar,
  BinaryHeap,
  PathNode,
  COEFFICIENTS,
  MIN_DIST_PATH,
} = require("./astar");
const {
  BaritoneMovements,
  Move,
  isDoorOrGateOpen,
} = require("./movements");
const {
  injectBaritonePathfinder,
  splicePaths,
  areGoalsEquivalent,
  getTurnAngleRad,
} = require("./pathfinder");

let goals = null;
try {
  goals = require("mineflayer-pathfinder").goals;
} catch (_) {}

module.exports = {
  ActionCosts,
  BacktrackMemory,
  ToolSet,
  CalculationContext,
  BaritoneAStar,
  BinaryHeap,
  PathNode,
  COEFFICIENTS,
  MIN_DIST_PATH,
  BaritoneMovements,
  Move,
  isDoorOrGateOpen,
  injectBaritonePathfinder,
  splicePaths,
  areGoalsEquivalent,
  getTurnAngleRad,
  pathfinder: injectBaritonePathfinder,
  Movements: BaritoneMovements,
  goals,
};
