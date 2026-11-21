// Reach-based mining helpers shared by AIAgent, GearUp and Mine.
//
// A player can break any block whose centre is within ~4.5 blocks of their
// eyes, so the bot no longer has to walk to "1 block away" from the target.
// The old 1m rule made it chase buried stone around forever and give up on
// every log of a tree above the lowest two (they are 3-6 blocks above the
// feet, so "within 1 block" was never reachable).

const DIG_REACH = 4.5;
const SAFE_REACH = 4.3; // a little margin for server-side reach checks
const OPEN_NAMES = new Set([
  "air",
  "cave_air",
  "void_air",
  "water",
  "short_grass",
  "grass",
  "tall_grass",
  "fern",
  "large_fern",
  "snow",
  "dead_bush",
  "vine",
]);

const FACES = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function toVec(bot, p) {
  if (!p) return null;
  if (typeof p.offset === "function") return p;
  const V = bot?.entity?.position?.constructor;
  return V ? new V(p.x, p.y, p.z) : p;
}

function eyePos(bot) {
  const p = bot?.entity?.position;
  if (!p) return null;
  return p.offset(0, bot.entity.eyeHeight || 1.62, 0);
}

function eyeDistance(bot, pos) {
  const eye = eyePos(bot);
  if (!eye || !pos) return Infinity;
  const dx = pos.x + 0.5 - eye.x;
  const dy = pos.y + 0.5 - eye.y;
  const dz = pos.z + 0.5 - eye.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isOpenBlock(b) {
  if (!b) return true;
  if (b.boundingBox === "empty") return true;
  return OPEN_NAMES.has(String(b.name || ""));
}

// True when at least one face of the block touches air/water/plants, i.e. a
// player could see and hit it without digging anything else first.
function isExposed(bot, pos) {
  if (!bot || typeof bot.blockAt !== "function" || !pos) return true;
  const v = toVec(bot, pos);
  if (!v || typeof v.offset !== "function") return true;
  for (const [x, y, z] of FACES) {
    if (isOpenBlock(bot.blockAt(v.offset(x, y, z)))) return true;
  }
  return false;
}

function samePos(a, b) {
  return a && b && a.x === b.x && a.y === b.y && a.z === b.z;
}

// What the bot would hit when swinging at `pos` from where it stands now.
// { dist, inReach, visible, blocker } - blocker is the first solid block in
// the way (smartDig digs it first) or null when the target is directly visible.
function getDigInfo(bot, pos, reach = SAFE_REACH) {
  const dist = eyeDistance(bot, pos);
  const info = { dist, inReach: dist <= reach, visible: false, blocker: null };
  if (!info.inReach) return info;
  const eye = eyePos(bot);
  if (!bot.world || typeof bot.world.raycast !== "function" || !eye) {
    info.visible = true;
    return info;
  }
  try {
    const V = eye.constructor;
    const center = new V(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
    const dir = center.minus(eye).normalize();
    const hit = bot.world.raycast(eye, dir, dist + 0.6);
    if (!hit || !hit.position || samePos(hit.position, pos)) {
      info.visible = true;
    } else {
      info.blocker = bot.blockAt ? bot.blockAt(hit.position) : null;
    }
  } catch (_) {
    info.visible = true;
  }
  return info;
}

// Can the bot start breaking `pos` without moving? A single diggable block in
// the line of sight is fine (smartDig removes it first), bedrock/unbreakable or
// the block under our own feet is not.
function canMineFromHere(bot, pos, reach = SAFE_REACH) {
  if (!bot?.entity?.position || !pos) return false;
  const info = getDigInfo(bot, pos, reach);
  if (!info.inReach) return false;
  if (info.visible) return true;
  const b = info.blocker;
  if (!b) return true;
  if (b.diggable === false || b.name === "bedrock") return false;
  const f = bot.entity.position.floored();
  const underFeet =
    b.position.x === f.x && b.position.z === f.z && b.position.y < f.y;
  if (underFeet) return false;
  return eyeDistance(bot, b.position) <= reach;
}

// Remembers targets that failed. For a failed block, every block of the same
// column at or above it is skipped too (if the bottom log of a tree can't be
// reached the top ones can't either) - but blocks BELOW it stay valid, so a
// tree whose top is out of reach still gets its lower logs mined.
class MiningSkipList {
  constructor() {
    this.blocks = new Map(); // "x,y,z" -> expiry
    this.columns = new Map(); // "x,z" -> { minY, exp }
  }

  skip(pos, { ttlMs = 60000, columnAbove = true } = {}) {
    if (!pos) return;
    const exp = Date.now() + ttlMs;
    this.blocks.set(`${pos.x},${pos.y},${pos.z}`, exp);
    if (columnAbove) {
      const k = `${pos.x},${pos.z}`;
      const prev = this.columns.get(k);
      const minY =
        prev && prev.exp > Date.now() ? Math.min(prev.minY, pos.y) : pos.y;
      this.columns.set(k, { minY, exp });
    }
  }

  has(pos) {
    if (!pos) return false;
    const now = Date.now();
    const bk = `${pos.x},${pos.y},${pos.z}`;
    const be = this.blocks.get(bk);
    if (be) {
      if (be > now) return true;
      this.blocks.delete(bk);
    }
    const ck = `${pos.x},${pos.z}`;
    const col = this.columns.get(ck);
    if (col) {
      if (col.exp <= now) this.columns.delete(ck);
      else if (pos.y >= col.minY) return true;
    }
    return false;
  }

  clear() {
    this.blocks.clear();
    this.columns.clear();
  }

  get size() {
    return this.blocks.size;
  }
}

// Picks the best block to mine from findBlocks() results: something we can
// hit right now wins, then exposed blocks near our Y level, then distance.
// Never picks the block directly under our feet (no 1x1 pits).
// `prefer` (the block we are already walking to) gets a strong bonus so the
// bot does not drop it for a slightly closer block every step and end up
// following stone around instead of mining it.
function pickMiningTarget(
  bot,
  positions,
  isAllowed = () => true,
  { prefer = null } = {},
) {
  if (!Array.isArray(positions) || positions.length === 0) return null;
  const me = bot?.entity?.position;
  if (!me) return positions.find((p) => isAllowed(p)) || null;
  const f = me.floored();
  let best = null;
  let bestScore = -Infinity;
  for (const p of positions) {
    if (!p || !isAllowed(p)) continue;
    if (p.x === f.x && p.z === f.z && p.y < f.y) continue;
    const dist = eyeDistance(bot, p);
    const dy = p.y - f.y;
    let score = -dist;
    if (dist <= SAFE_REACH && canMineFromHere(bot, p)) score += 60;
    if (isExposed(bot, p)) score += 35;
    else score -= 15;
    if (dy >= -2 && dy <= 5) score += 20;
    else if (dy > 6) score -= (dy - 6) * 10;
    else if (dy < -3) score -= (-3 - dy) * 6;
    if (prefer && samePos(p, prefer)) score += 45;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

// Pathfinder goal: stand anywhere the block can be hit from (eyes within
// reach, clear line of sight). Works with Baritone and stock
// mineflayer-pathfinder. Replaces GoalLookAtBlock, whose isEnd() measures from
// the FEET to a point 1.6 above the block (so a log 3+ blocks up the trunk is
// never "in reach") and whose heuristic drags the bot up to the block's Y.
class GoalMineBlock {
  constructor(bot, pos, { reach = SAFE_REACH, allowBlocker = false } = {}) {
    this.bot = bot;
    this.world = bot?.world || null;
    this.pos = pos;
    this.x = pos.x;
    this.y = pos.y;
    this.z = pos.z;
    this.range = reach;
    this.eyeHeight = bot?.entity?.eyeHeight || 1.62;
    // Buried targets: one diggable block in the way is fine (smartDig clears it).
    this.allowBlocker = Boolean(allowBlocker);
    this.cache = new Map();
  }

  eyeDist(node) {
    const dx = node.x + 0.5 - (this.x + 0.5);
    const dy = node.y + this.eyeHeight - (this.y + 0.5);
    const dz = node.z + 0.5 - (this.z + 0.5);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  heuristic(node) {
    return Math.max(0, this.eyeDist(node) - this.range);
  }

  isEnd(node) {
    if (!node) return false;
    const nx = Math.floor(node.x);
    const ny = Math.floor(node.y);
    const nz = Math.floor(node.z);
    // Never stand inside the target or right on top of it (would dig a pit).
    if (
      nx === this.x &&
      nz === this.z &&
      (ny === this.y || ny - 1 === this.y || ny + 1 === this.y)
    ) {
      return false;
    }
    if (this.eyeDist({ x: nx, y: ny, z: nz }) > this.range) return false;
    const key = `${nx},${ny},${nz}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const ok = this.canSeeFrom(nx, ny, nz);
    if (this.cache.size > 4096) this.cache.clear();
    this.cache.set(key, ok);
    return ok;
  }

  canSeeFrom(nx, ny, nz) {
    const world = this.world;
    const V = this.pos?.constructor;
    if (
      !world ||
      typeof world.raycast !== "function" ||
      typeof V !== "function"
    )
      return true;
    try {
      const eye = new V(nx + 0.5, ny + this.eyeHeight, nz + 0.5);
      const center = new V(this.x + 0.5, this.y + 0.5, this.z + 0.5);
      const dist = eye.distanceTo(center);
      const dir = center.minus(eye).normalize();
      const hit = world.raycast(eye, dir, dist + 0.6);
      if (!hit || !hit.position || samePos(hit.position, this.pos)) return true;
      const blocker =
        typeof this.bot?.blockAt === "function"
          ? this.bot.blockAt(hit.position)
          : hit;
      const name = String(blocker?.name || "");
      if (blocker?.diggable === false || name === "bedrock") return false;
      // Under our own feet: digging it would drop us.
      if (hit.position.x === nx && hit.position.z === nz && hit.position.y < ny)
        return false;
      return this.allowBlocker || name.endsWith("leaves");
    } catch (_) {
      return true;
    }
  }

  hasChanged() {
    return false;
  }

  isValid() {
    return true;
  }
}

// Goal that is satisfied once the bot stands somewhere it can hit the block.
// Exposed blocks: any spot within reach with line of sight.
// Buried blocks: within reach with one diggable block in the way (smartDig
// clears it) - the pathfinder needs canDig to dig down/through to that spot.
function miningGoalFor(bot, goals, pos, { buried = null } = {}) {
  const isBuried = buried === null ? !isExposed(bot, pos) : buried;
  if (bot?.world)
    return new GoalMineBlock(bot, pos, { allowBlocker: isBuried });
  return new goals.GoalNear(pos.x, pos.y, pos.z, 2);
}

// How many solid blocks sit directly above `pos` before open space (0 = the
// top face is open). Used to explain why a block needs digging to reach.
function coverAbove(bot, pos, max = 8) {
  const none = { count: 0, names: [] };
  if (!bot || typeof bot.blockAt !== "function" || !pos) return none;
  const v = toVec(bot, pos);
  if (!v || typeof v.offset !== "function") return none;
  let n = 0;
  const names = new Set();
  for (let dy = 1; dy <= max; dy++) {
    const b = bot.blockAt(v.offset(0, dy, 0));
    if (isOpenBlock(b)) break;
    n += 1;
    if (b?.name) names.add(b.name);
  }
  return { count: n, names: Array.from(names) };
}

// Junk blocks the bot may pillar with. Never planks/logs (crafting needs
// them), never gravel/sand (they fall).
const CLIMB_BLOCKS = [
  "dirt",
  "coarse_dirt",
  "rooted_dirt",
  "cobblestone",
  "cobbled_deepslate",
  "netherrack",
  "andesite",
  "diorite",
  "granite",
  "tuff",
  "stone",
  "deepslate",
];

// Solid blocks over the bot's head within `depth` - it is in a pit, tunnel or
// cave and walking alone usually cannot get it out.
function isUnderCover(bot, depth = 8) {
  const p = bot?.entity?.position;
  if (!p || typeof bot.blockAt !== "function") return false;
  const f = p.floored();
  for (let dy = 2; dy <= depth; dy++) {
    const b = bot.blockAt(f.offset(0, dy, 0));
    if (b && !isOpenBlock(b)) return true;
  }
  return false;
}

// How many junk blocks the bot carries for pillaring.
function countClimbBlocks(bot) {
  try {
    return (bot?.inventory?.items?.() || [])
      .filter((i) => CLIMB_BLOCKS.includes(i.name))
      .reduce((n, i) => n + i.count, 0);
  } catch (_) {
    return 0;
  }
}

// Lets the pathfinder dig and pillar (with junk blocks only) so the bot can
// climb out of a pit / tunnel, or switches that back off on open ground so it
// does not wreck builds while walking. Returns true when climbing is enabled.
function setClimbMode(bot, on) {
  const m = bot?.pathfinder?.movements;
  if (!m) return false;
  const allowed = Boolean(on) && !inProtectedZone(bot);
  m.canDig = allowed;
  m.allow1by1towers = allowed && countClimbBlocks(bot) > 0;
  if (Array.isArray(m.scafoldingBlocks)) {
    const ids = allowed
      ? CLIMB_BLOCKS.map((n) => bot.registry?.itemsByName?.[n]?.id).filter(
          (id) => typeof id === "number",
        )
      : [];
    m.scafoldingBlocks = ids;
  }
  return allowed;
}

// Spawn protection / claims: the server refused a block break recently.
function inProtectedZone(bot) {
  return Boolean(
    bot?._mcbpProtectedZoneUntil && Date.now() < bot._mcbpProtectedZoneUntil,
  );
}

function withTimeout(promise, ms, onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try {
          if (onTimeout) onTimeout();
        } catch (_) {}
        reject(new Error(`timed out after ${Math.round(ms / 1000)}s`));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Walks until the block can be mined from where the bot stands.
// Resolves true when it is in reach, false when every approach failed.
async function approachForMining(
  bot,
  goals,
  pos,
  { timeoutMs = 18000, log = null, isCancelled = () => false } = {},
) {
  if (!bot?.pathfinder || !goals || !pos) return false;
  if (canMineFromHere(bot, pos)) return true;
  const stop = () => {
    try {
      bot.pathfinder.setGoal(null);
    } catch (_) {}
  };
  const exposed = isExposed(bot, pos);
  const attempts = exposed
    ? [
        {
          goal: miningGoalFor(bot, goals, pos, { buried: false }),
          ms: timeoutMs,
        },
        {
          goal: miningGoalFor(bot, goals, pos, { buried: true }),
          ms: Math.round(timeoutMs * 0.6),
          dig: true,
        },
      ]
    : [
        {
          goal: miningGoalFor(bot, goals, pos, { buried: true }),
          ms: timeoutMs,
          dig: true,
        },
      ];
  const movements = bot.pathfinder.movements;
  const prevCanDig = movements ? movements.canDig : undefined;
  try {
    for (const { goal, ms, dig } of attempts) {
      if (isCancelled()) return false;
      // Buried target: the pathfinder must dig down/through to reach it.
      if (dig && movements && !movements.canDig && !inProtectedZone(bot)) {
        movements.canDig = true;
      }
      try {
        await withTimeout(bot.pathfinder.goto(goal), ms, stop);
      } catch (err) {
        if (log)
          log(
            `approach ${goal.constructor?.name || "goal"} failed: ${err.message || err}`,
          );
      }
      if (canMineFromHere(bot, pos)) return true;
    }
  } finally {
    if (movements && prevCanDig !== undefined) movements.canDig = prevCanDig;
  }
  return canMineFromHere(bot, pos);
}

module.exports = {
  DIG_REACH,
  SAFE_REACH,
  eyePos,
  eyeDistance,
  isOpenBlock,
  isExposed,
  getDigInfo,
  canMineFromHere,
  MiningSkipList,
  pickMiningTarget,
  GoalMineBlock,
  miningGoalFor,
  coverAbove,
  approachForMining,
  inProtectedZone,
  isUnderCover,
  countClimbBlocks,
  setClimbMode,
  CLIMB_BLOCKS,
  withTimeout,
};
