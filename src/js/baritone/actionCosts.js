// Exact Minecraft physics tick costs modeled after Baritone's ActionCosts.java.
// All movement costs and heuristics share the same unit: game ticks (20 ticks = 1 second).

const WALK_ONE_BLOCK_COST = 20 / 4.317; // ~4.6328 ticks
const WALK_ONE_IN_WATER_COST = 20 / 2.2; // ~9.0909 ticks
const WALK_ONE_OVER_SOUL_SAND_COST = WALK_ONE_BLOCK_COST * 2; // ~9.2657 ticks
const LADDER_UP_ONE_COST = 20 / 2.35; // ~8.5106 ticks
const LADDER_DOWN_ONE_COST = 20 / 3.0; // ~6.6667 ticks
const SNEAK_ONE_BLOCK_COST = 20 / 1.3; // ~15.3846 ticks
const SPRINT_ONE_BLOCK_COST = 20 / 5.612; // ~3.5638 ticks
const SPRINT_MULTIPLIER = SPRINT_ONE_BLOCK_COST / WALK_ONE_BLOCK_COST; // ~0.7692

const WALK_OFF_BLOCK_COST = WALK_ONE_BLOCK_COST * 0.8; // ~3.7063 ticks
const CENTER_AFTER_FALL_COST = WALK_ONE_BLOCK_COST - WALK_OFF_BLOCK_COST; // ~0.9266 ticks

// Exact Minecraft vertical fall physics integration:
// Each tick: distance += velocity; velocity = (velocity + 0.08) * 0.98
function computeFallTicks(targetDistance) {
  if (targetDistance <= 0) return 0;
  let dist = 0;
  let vel = 0;
  let ticks = 0;
  while (dist < targetDistance && ticks < 2000) {
    vel = (vel + 0.08) * 0.98;
    const nextDist = dist + vel;
    if (nextDist >= targetDistance) {
      const fraction = (targetDistance - dist) / vel;
      return ticks + fraction;
    }
    dist = nextDist;
    ticks += 1;
  }
  return ticks;
}

function generateFallNBlocksCost(maxHeight = 4096) {
  const costs = new Float64Array(maxHeight + 1);
  let dist = 0;
  let vel = 0;
  let ticks = 0;
  let currentBlock = 1;
  costs[0] = 0;
  while (currentBlock <= maxHeight) {
    vel = (vel + 0.08) * 0.98;
    const prevDist = dist;
    dist += vel;
    while (currentBlock <= maxHeight && dist >= currentBlock) {
      const frac = (currentBlock - prevDist) / vel;
      costs[currentBlock] = ticks + frac;
      currentBlock += 1;
    }
    ticks += 1;
  }
  return costs;
}

const FALL_N_BLOCKS_COST = generateFallNBlocksCost(512);
const FALL_1_25_BLOCKS_COST = computeFallTicks(1.25);
const FALL_0_25_BLOCKS_COST = computeFallTicks(0.25);
const JUMP_ONE_BLOCK_COST = FALL_1_25_BLOCKS_COST - FALL_0_25_BLOCKS_COST;

// Extra penalties tuned for safe, human-like Minecraft navigation
const DIAGONAL_NUDGE_COST = 0.05; // Slight tie-breaker so straight lines beat zig-zags
const CORNER_CLIP_PENALTY = 1.6; // Mild penalty when hugging 1 solid corner diagonally
const DOOR_OPEN_COST = 4.5; // Right-clicking a closed door/gate takes ~4-5 ticks
const PLACE_BLOCK_BASE_COST = 16.0; // Default Baritone blockPlacementPenalty (~20 ticks, tuned to 16)
const BREAK_BLOCK_BASE_PENALTY = 3.0; // Base overhead to aim & start breaking a block
const ADJACENT_HAZARD_PENALTY = 12.0; // Penalty for walking directly adjacent to cactus/lava/fire/magma
const PARKOUR_RISK_PENALTY = 3.5; // Discourage unnecessary parkour when a safe walk is just as fast
const WATER_ENTRY_PENALTY = 4.0; // Mild preference for dry land unless water is clearly faster
const LIQUID_FLOW_PENALTY = 18.0; // Penalty when wading through flowing water
const COST_INF = 1000000;

// Heuristic scale converting mineflayer-pathfinder block-unit goal.heuristic(node)
// into tick-unit lower bounds compatible with Baritone ActionCosts.
const HEURISTIC_TICK_SCALE = SPRINT_ONE_BLOCK_COST;

function fallCost(blocks) {
  const n = Math.floor(blocks);
  if (n <= 0) return 0;
  if (n < FALL_N_BLOCKS_COST.length) return FALL_N_BLOCKS_COST[n];
  return computeFallTicks(n);
}

// Compute Baritone-style 3D tick heuristic between two integer coordinates.
function estimateTicksBetween(ax, ay, az, bx, by, bz, { allowSprinting = true } = {}) {
  const dx = Math.abs(bx - ax);
  const dz = Math.abs(bz - az);
  const dy = by - ay;
  const horizSpeed = allowSprinting ? SPRINT_ONE_BLOCK_COST : WALK_ONE_BLOCK_COST;
  const straight = Math.abs(dx - dz);
  const diag = Math.min(dx, dz);
  let h = (straight + diag * Math.SQRT2) * horizSpeed;
  if (dy > 0) {
    h += dy * (WALK_ONE_BLOCK_COST + JUMP_ONE_BLOCK_COST);
  } else if (dy < 0) {
    h += fallCost(-dy);
  }
  return h;
}

module.exports = {
  WALK_ONE_BLOCK_COST,
  WALK_ONE_IN_WATER_COST,
  WALK_ONE_OVER_SOUL_SAND_COST,
  LADDER_UP_ONE_COST,
  LADDER_DOWN_ONE_COST,
  SNEAK_ONE_BLOCK_COST,
  SPRINT_ONE_BLOCK_COST,
  SPRINT_MULTIPLIER,
  WALK_OFF_BLOCK_COST,
  CENTER_AFTER_FALL_COST,
  FALL_N_BLOCKS_COST,
  FALL_1_25_BLOCKS_COST,
  FALL_0_25_BLOCKS_COST,
  JUMP_ONE_BLOCK_COST,
  DIAGONAL_NUDGE_COST,
  CORNER_CLIP_PENALTY,
  DOOR_OPEN_COST,
  PLACE_BLOCK_BASE_COST,
  BREAK_BLOCK_BASE_PENALTY,
  ADJACENT_HAZARD_PENALTY,
  PARKOUR_RISK_PENALTY,
  WATER_ENTRY_PENALTY,
  LIQUID_FLOW_PENALTY,
  COST_INF,
  HEURISTIC_TICK_SCALE,
  computeFallTicks,
  fallCost,
  estimateTicksBetween,
};
