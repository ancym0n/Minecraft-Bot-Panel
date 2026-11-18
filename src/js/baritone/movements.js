// Baritone / Fabritone-inspired Movements & MovementHelper for Mineflayer.
// Drop-in compatible with mineflayer-pathfinder's Movements API while upgrading:
// - Exact Minecraft tick ActionCosts (walk, sprint, water, soul sand, ladder, fall, jump, break, place)
// - Full Baritone safety checks: avoidWalkingInto, avoidStandingOn, avoidBreaking, avoidAdjacent
// - Strict diagonal corner checks (no squeezing through double-solid or fence/cactus corners)
// - Smart wooden door & fence gate handling (inspects `open` state so open doors aren't closed)
// - Realistic parkour cost & takeoff/headroom/landing validation
// - Per-search BlockStateCache, ToolSet dig-time memoization, and BacktrackMemory penalties

const { Vec3 } = require("vec3");
const {
  WALK_ONE_BLOCK_COST,
  WALK_ONE_IN_WATER_COST,
  WALK_ONE_OVER_SOUL_SAND_COST,
  LADDER_UP_ONE_COST,
  LADDER_DOWN_ONE_COST,
  SPRINT_ONE_BLOCK_COST,
  WALK_OFF_BLOCK_COST,
  CENTER_AFTER_FALL_COST,
  JUMP_ONE_BLOCK_COST,
  DIAGONAL_NUDGE_COST,
  CORNER_CLIP_PENALTY,
  DOOR_OPEN_COST,
  PLACE_BLOCK_BASE_COST,
  ADJACENT_HAZARD_PENALTY,
  PARKOUR_RISK_PENALTY,
  WATER_ENTRY_PENALTY,
  LIQUID_FLOW_PENALTY,
  COST_INF,
  fallCost,
} = require("./actionCosts");
const { CalculationContext } = require("./calculationContext");

const CARDINAL_DIRS = [
  { x: -1, z: 0 }, // West
  { x: 1, z: 0 }, // East
  { x: 0, z: -1 }, // North
  { x: 0, z: 1 }, // South
];

const DIAGONAL_DIRS = [
  { x: -1, z: -1 },
  { x: -1, z: 1 },
  { x: 1, z: -1 },
  { x: 1, z: 1 },
];

const HAZARD_BLOCK_NAMES = [
  "lava",
  "fire",
  "soul_fire",
  "cactus",
  "sweet_berry_bush",
  "wither_rose",
  "campfire",
  "soul_campfire",
  "magma_block",
  "powder_snow",
  "cobweb",
  "web",
  "pointed_dripstone",
  "big_dripleaf",
  "end_portal",
  "nether_portal",
];

const ADJACENT_DANGER_NAMES = [
  "cactus",
  "lava",
  "fire",
  "soul_fire",
  "sweet_berry_bush",
];

const SLOW_FLOOR_NAMES = ["soul_sand", "honey_block"];

const GRAVITY_BLOCK_NAMES = [
  "sand",
  "red_sand",
  "gravel",
  "anvil",
  "chipped_anvil",
  "damaged_anvil",
  "pointed_dripstone",
  "dragon_egg",
];

const VALUABLE_BLOCK_NAMES = [
  "chest",
  "trapped_chest",
  "ender_chest",
  "barrel",
  "furnace",
  "blast_furnace",
  "smoker",
  "crafting_table",
  "enchanting_table",
  "brewing_stand",
  "anvil",
  "chipped_anvil",
  "damaged_anvil",
  "beacon",
  "spawner",
  "mob_spawner",
  "budding_amethyst",
  "dragon_egg",
  "respawn_anchor",
  "lodestone",
];

const CLIMBABLE_NAMES = [
  "ladder",
  "vine",
  "twisting_vines",
  "twisting_vines_plant",
  "weeping_vines",
  "weeping_vines_plant",
  "scaffolding",
];

const DEFAULT_SCAFFOLD_NAMES = [
  "cobblestone",
  "cobbled_deepslate",
  "dirt",
  "netherrack",
  "stone",
  "andesite",
  "diorite",
  "granite",
  "oak_planks",
  "spruce_planks",
  "birch_planks",
  "jungle_planks",
  "acacia_planks",
  "dark_oak_planks",
  "cherry_planks",
  "mangrove_planks",
  "pale_oak_planks",
];

class Move extends Vec3 {
  constructor(
    x,
    y,
    z,
    remainingBlocks,
    cost,
    toBreak = [],
    toPlace = [],
    parkour = false,
    meta = null,
  ) {
    super(Math.floor(x), Math.floor(y), Math.floor(z));
    this.remainingBlocks = remainingBlocks;
    this.cost = cost;
    this.toBreak = toBreak;
    this.toPlace = toPlace;
    this.parkour = parkour;
    this.meta = meta;
    this.hash = `${this.x},${this.y},${this.z}`;
  }
}

function loadOptionalJson(relPath, fallback = []) {
  try {
    return require(relPath);
  } catch (_) {
    return fallback;
  }
}

function isDoorOrGateOpen(block) {
  if (!block) return false;
  try {
    if (typeof block.getProperties === "function") {
      const props = block.getProperties();
      if (props && "open" in props) {
        return props.open === true || props.open === "true";
      }
    }
    if (block._properties && "open" in block._properties) {
      return block._properties.open === true || block._properties.open === "true";
    }
  } catch (_) {}
  // Fallback: if shapes are empty (open fence gate), it's open
  if (Array.isArray(block.shapes) && block.shapes.length === 0) return true;
  return false;
}

class BaritoneMovements {
  constructor(bot, mcDataArg = null) {
    this.bot = bot;
    const registry =
      bot?.registry ||
      (typeof mcDataArg === "function" ? mcDataArg(bot?.version) : mcDataArg) ||
      {};
    this.registry = registry;
    const blocksByName = registry.blocksByName || {};
    const itemsByName = registry.itemsByName || {};
    const blocksArray = Array.isArray(registry.blocksArray)
      ? registry.blocksArray
      : Object.values(blocksByName);

    // Stock mineflayer-pathfinder compatible flags & cost multipliers
    this.canDig = true;
    this.digCost = 1;
    this.placeCost = 1;
    this.liquidCost = 1;
    this.entityCost = 2.5;

    this.dontCreateFlow = true;
    this.dontMineUnderFallingBlock = true;
    this.allow1by1towers = true;
    this.allowFreeMotion = false;
    this.allowParkour = true;
    this.allowParkourAscend = true;
    this.allowSprinting = true;
    this.allowEntityDetection = true;
    this.canOpenDoors = true;

    // Baritone-specific safety & navigation flags
    this.allowDiagonalDescend = true;
    this.allowDiagonalAscend = true;
    this.avoidAdjacentHazards = true;
    this.protectValuableBlocks = true;
    this.maxDropDown = 4;
    this.infiniteLiquidDropdownDistance = true;

    this.entitiesToAvoid = new Set();
    this.passableEntities = new Set(
      loadOptionalJson("mineflayer-pathfinder/lib/passableEntities.json", [
        "item",
        "experience_orb",
        "arrow",
        "snowball",
      ]),
    );
    this.interactableBlocks = new Set(
      loadOptionalJson("mineflayer-pathfinder/lib/interactable.json", []),
    );

    this.blocksCantBreak = new Set();
    this.valuableBlocks = new Set();
    for (const name of VALUABLE_BLOCK_NAMES) {
      const b = blocksByName[name];
      if (b && typeof b.id === "number") {
        this.valuableBlocks.add(b.id);
        this.blocksCantBreak.add(b.id);
      }
    }
    for (const block of blocksArray) {
      if (!block || typeof block.id !== "number") continue;
      if (block.diggable === false) {
        this.blocksCantBreak.add(block.id);
      }
      const n = String(block.name || "").toLowerCase();
      if (n.includes("shulker_box") || n.endsWith("_bed")) {
        this.valuableBlocks.add(block.id);
        this.blocksCantBreak.add(block.id);
      }
    }

    this.blocksToAvoid = new Set();
    for (const name of HAZARD_BLOCK_NAMES) {
      const b = blocksByName[name];
      if (b && typeof b.id === "number") this.blocksToAvoid.add(b.id);
    }

    this.adjacentDangerBlocks = new Set();
    for (const name of ADJACENT_DANGER_NAMES) {
      const b = blocksByName[name];
      if (b && typeof b.id === "number") this.adjacentDangerBlocks.add(b.id);
    }

    this.slowFloorBlocks = new Set();
    for (const name of SLOW_FLOOR_NAMES) {
      const b = blocksByName[name];
      if (b && typeof b.id === "number") this.slowFloorBlocks.add(b.id);
    }

    this.liquids = new Set();
    this.waterId = blocksByName.water?.id ?? -1;
    this.lavaId = blocksByName.lava?.id ?? -1;
    if (this.waterId >= 0) this.liquids.add(this.waterId);
    if (this.lavaId >= 0) this.liquids.add(this.lavaId);

    this.gravityBlocks = new Set();
    for (const name of GRAVITY_BLOCK_NAMES) {
      const b = blocksByName[name];
      if (b && typeof b.id === "number") this.gravityBlocks.add(b.id);
    }
    for (const block of blocksArray) {
      if (
        block &&
        typeof block.id === "number" &&
        String(block.name || "").endsWith("_concrete_powder")
      ) {
        this.gravityBlocks.add(block.id);
      }
    }

    this.climbables = new Set();
    for (const name of CLIMBABLE_NAMES) {
      const b = blocksByName[name];
      if (b && typeof b.id === "number") this.climbables.add(b.id);
    }

    this.replaceables = new Set();
    for (const name of [
      "air",
      "cave_air",
      "void_air",
      "water",
      "lava",
      "short_grass",
      "grass",
      "tall_grass",
      "fern",
      "large_fern",
      "dead_bush",
      "snow",
    ]) {
      const b = blocksByName[name];
      if (b && typeof b.id === "number") this.replaceables.add(b.id);
    }

    this.scafoldingBlocks = [];
    for (const name of DEFAULT_SCAFFOLD_NAMES) {
      const item = itemsByName[name];
      if (item && typeof item.id === "number") {
        this.scafoldingBlocks.push(item.id);
      }
    }

    this.emptyBlocks = new Set();
    this.fences = new Set();
    this.carpets = new Set();
    this.openable = new Set();
    this.doors = new Set();
    this.snowLayerId = blocksByName.snow?.id ?? -1;

    let BlockClass = null;
    try {
      if (bot?.registry) {
        BlockClass = require("prismarine-block")(bot.registry);
      }
    } catch (_) {}

    for (const block of blocksArray) {
      if (!block || typeof block.id !== "number") continue;
      const n = String(block.name || "").toLowerCase();

      // Classify openable wooden doors & fence gates (never iron_door / iron_trapdoor)
      if (
        (n.endsWith("_fence_gate") || n.endsWith("_door")) &&
        !n.includes("iron")
      ) {
        this.openable.add(block.id);
        if (n.endsWith("_door")) this.doors.add(block.id);
      }

      if (
        n.includes("fence") &&
        !n.includes("fence_gate")
      ) {
        this.fences.add(block.id);
      } else if (n.endsWith("_wall")) {
        this.fences.add(block.id);
      }

      if (BlockClass && typeof block.minStateId === "number") {
        try {
          const sample = BlockClass.fromStateId(block.minStateId, 0);
          if (sample?.shapes?.length > 0) {
            const topY = sample.shapes[0][4];
            if (topY > 1.0) this.fences.add(block.id);
            if (topY < 0.1) this.carpets.add(block.id);
          } else if (sample?.shapes?.length === 0) {
            this.emptyBlocks.add(block.id);
          }
        } catch (_) {}
      } else if (block.boundingBox === "empty") {
        this.emptyBlocks.add(block.id);
      }
    }

    this.exclusionAreasStep = [];
    this.exclusionAreasBreak = [];
    this.exclusionAreasPlace = [];
    this.entityIntersections = {};

    this.context = new CalculationContext(bot, this);
  }

  prepareForSearch(backtrackMemory = null) {
    if (backtrackMemory) {
      this.context.backtrackMemory = backtrackMemory;
    }
    this.context.resetForSearch();
  }

  exclusionPlace(block) {
    if (this.exclusionAreasPlace.length === 0) return 0;
    let weight = 0;
    for (const fn of this.exclusionAreasPlace) weight += fn(block);
    return weight;
  }

  exclusionStep(block) {
    if (this.exclusionAreasStep.length === 0) return 0;
    let weight = 0;
    for (const fn of this.exclusionAreasStep) weight += fn(block);
    return weight;
  }

  exclusionBreak(block) {
    if (this.exclusionAreasBreak.length === 0) return 0;
    let weight = 0;
    for (const fn of this.exclusionAreasBreak) weight += fn(block);
    return weight;
  }

  countScaffoldingItems() {
    let count = 0;
    const items =
      typeof this.bot?.inventory?.items === "function"
        ? this.bot.inventory.items()
        : [];
    if (!items.length || !this.scafoldingBlocks.length) return 0;
    const allowed = new Set(this.scafoldingBlocks);
    for (const item of items) {
      if (item && allowed.has(item.type)) count += item.count || 0;
    }
    return count;
  }

  getScaffoldingItem() {
    const items =
      typeof this.bot?.inventory?.items === "function"
        ? this.bot.inventory.items()
        : [];
    for (const id of this.scafoldingBlocks) {
      for (const item of items) {
        if (item && item.type === id) return item;
      }
    }
    return null;
  }

  clearCollisionIndex() {
    this.entityIntersections = {};
  }

  updateCollisionIndex() {
    const entities = this.bot?.entities;
    if (!entities) return;
    for (const ent of Object.values(entities)) {
      if (!ent || ent === this.bot.entity || !ent.position) continue;
      const avoidedEnt = this.entitiesToAvoid.has(ent.name);
      if (avoidedEnt || !this.passableEntities.has(ent.name)) {
        const halfW = (Number(ent.width) || 0.6) / 2.0;
        const height = Number(ent.height) || 1.8;
        const minY = Math.floor(ent.position.y);
        const maxY = Math.ceil(ent.position.y + height);
        const minX = Math.floor(ent.position.x - halfW);
        const maxX = Math.ceil(ent.position.x + halfW);
        const minZ = Math.floor(ent.position.z - halfW);
        const maxZ = Math.ceil(ent.position.z + halfW);
        const cost = avoidedEnt ? 120 : 1;
        for (let y = minY; y < maxY; y++) {
          for (let x = minX; x < maxX; x++) {
            for (let z = minZ; z < maxZ; z++) {
              const k = `${x},${y},${z}`;
              this.entityIntersections[k] =
                (this.entityIntersections[k] || 0) + cost;
            }
          }
        }
      }
    }
  }

  getNumEntitiesAt(pos, dx = 0, dy = 0, dz = 0) {
    if (this.allowEntityDetection === false || !pos) return 0;
    const key = `${pos.x + dx},${pos.y + dy},${pos.z + dz}`;
    return this.entityIntersections[key] || 0;
  }

  _classifyBlock(raw, x, y, z) {
    if (!raw) {
      return {
        raw: null,
        position: new Vec3(x, y, z),
        type: -1,
        name: "",
        loaded: false,
        replaceable: false,
        canFall: false,
        safe: false,
        physical: false,
        solidFloor: false,
        liquid: false,
        isWater: false,
        isLava: false,
        climbable: false,
        hazard: false,
        adjacentDanger: false,
        slowFloor: false,
        fenceLike: false,
        valuable: false,
        openable: false,
        isOpen: false,
        isDoor: false,
        height: y,
      };
    }

    const type = raw.type;
    const isWater = type === this.waterId;
    const isLava = type === this.lavaId;
    const liquid = this.liquids.has(type);
    const climbable = this.climbables.has(type);
    const hazard = this.blocksToAvoid.has(type);
    const adjacentDanger = this.adjacentDangerBlocks.has(type);
    const slowFloor = this.slowFloorBlocks.has(type);
    const fenceLike = this.fences.has(type);
    const valuable = this.valuableBlocks.has(type);
    const openable = this.openable.has(type);
    const isDoor = this.doors.has(type);
    const isOpen = openable ? isDoorOrGateOpen(raw) : false;

    let maxShapeY = 0;
    if (Array.isArray(raw.shapes) && raw.shapes.length > 0) {
      for (const s of raw.shapes) {
        if (s && typeof s[4] === "number" && s[4] > maxShapeY) {
          maxShapeY = s[4];
        }
      }
    } else if (raw.boundingBox === "block") {
      maxShapeY = 1;
    }

    // Handle multi-layer snow properly (layers 1..2 are walkable through; layers >= 3 act as elevated floor/step)
    let snowThick = false;
    if (type === this.snowLayerId) {
      let layers = 1;
      try {
        const props = typeof raw.getProperties === "function" ? raw.getProperties() : null;
        if (props && props.layers) layers = Number(props.layers) || 1;
      } catch (_) {}
      maxShapeY = (layers - 1) * 0.125;
      if (layers >= 4) snowThick = true;
    }

    const isEmptyOrCarpet =
      raw.boundingBox === "empty" ||
      climbable ||
      this.carpets.has(type) ||
      (type === this.snowLayerId && !snowThick);

    const safe =
      !hazard &&
      (isEmptyOrCarpet || (openable && isOpen));

    const physical =
      !hazard &&
      !fenceLike &&
      !openable &&
      (raw.boundingBox === "block" || snowThick);

    const solidFloor = physical && !this.blocksToAvoid.has(type);
    const replaceable = this.replaceables.has(type) && !physical;
    const canFall = this.gravityBlocks.has(type);

    return {
      raw,
      position: raw.position || new Vec3(x, y, z),
      type,
      name: raw.name || "",
      loaded: true,
      replaceable,
      canFall,
      safe,
      physical,
      solidFloor,
      liquid,
      isWater,
      isLava,
      climbable,
      hazard,
      adjacentDanger,
      slowFloor,
      fenceLike,
      valuable,
      openable,
      isOpen,
      isDoor,
      height: y + maxShapeY,
      digTime: typeof raw.digTime === "function" ? raw.digTime.bind(raw) : null,
      shapes: raw.shapes || [],
    };
  }

  getBlock(pos, dx = 0, dy = 0, dz = 0) {
    if (!pos) return this._classifyBlock(null, 0, 0, 0);
    const x = pos.x + dx;
    const y = pos.y + dy;
    const z = pos.z + dz;
    return this.context.getCachedBlock(x, y, z, (raw, bx, by, bz) =>
      this._classifyBlock(raw, bx, by, bz),
    );
  }

  // Baritone MovementHelper.avoidBreaking equivalent
  safeToBreak(block) {
    if (!this.canDig || !block || !block.loaded || block.type < 0) return false;
    if (this.blocksCantBreak.has(block.type)) return false;
    if (this.protectValuableBlocks && block.valuable) return false;
    if (this.exclusionBreak(block.raw || block) >= 100) return false;

    const pos = block.position;
    // Never break a block touching lava on any side (including above & below)
    const above = this.getBlock(pos, 0, 1, 0);
    const below = this.getBlock(pos, 0, -1, 0);
    const north = this.getBlock(pos, 0, 0, -1);
    const south = this.getBlock(pos, 0, 0, 1);
    const east = this.getBlock(pos, 1, 0, 0);
    const west = this.getBlock(pos, -1, 0, 0);

    if (
      above.isLava ||
      below.isLava ||
      north.isLava ||
      south.isLava ||
      east.isLava ||
      west.isLava
    ) {
      return false;
    }

    if (this.dontCreateFlow) {
      if (
        above.liquid ||
        north.liquid ||
        south.liquid ||
        east.liquid ||
        west.liquid
      ) {
        return false;
      }
    }

    if (this.dontMineUnderFallingBlock) {
      if (above.canFall || this.getNumEntitiesAt(pos, 0, 1, 0) > 0) {
        return false;
      }
    }

    // Never break the block supporting a valuable container/bed directly above
    if (this.protectValuableBlocks && above.valuable) {
      return false;
    }

    return true;
  }

  // Returns additional tick cost to step into/break `block`, or COST_INF if impossible.
  safeOrBreak(block, toBreak) {
    if (!block || !block.loaded) return COST_INF;
    let cost = 0;
    const exStep = this.exclusionStep(block.raw || block);
    if (exStep >= 100) return COST_INF;
    cost += exStep;
    cost += this.getNumEntitiesAt(block.position, 0, 0, 0) * this.entityCost;

    if (block.safe) return cost;
    if (!this.safeToBreak(block)) return COST_INF;

    toBreak.push(block.position);
    if (block.physical) {
      cost += this.getNumEntitiesAt(block.position, 0, 1, 0) * this.entityCost;
    }

    const breakInfo = this.context.toolSet.getBreakInfo(block.raw || block);
    if (breakInfo.ticks >= COST_INF) return COST_INF;
    cost += breakInfo.ticks * this.digCost;
    return cost;
  }

  // Baritone MovementHelper.avoidAdjacent — penalizes stepping right next to cactus/lava/fire/berries
  adjacentHazardCost(pos) {
    if (!this.avoidAdjacentHazards) return 0;
    let penalty = 0;
    for (let i = 0; i < 4; i++) {
      const d = CARDINAL_DIRS[i];
      const footSide = this.getBlock(pos, d.x, 0, d.z);
      const headSide = this.getBlock(pos, d.x, 1, d.z);
      if (footSide.adjacentDanger || headSide.adjacentDanger) {
        penalty +=
          footSide.isLava || headSide.isLava
            ? ADJACENT_HAZARD_PENALTY * 2.2
            : ADJACENT_HAZARD_PENALTY;
      }
    }
    return penalty;
  }

  _baseHorizontalCost(fromFeet, toFeet, toFloor) {
    if (fromFeet.isWater || toFeet.isWater) {
      let c = WALK_ONE_IN_WATER_COST * this.liquidCost;
      if (!fromFeet.isWater && toFeet.isWater) c += WATER_ENTRY_PENALTY;
      const level = toFeet.raw?.metadata ?? 0;
      if (level > 0 && level < 8) c += LIQUID_FLOW_PENALTY * 0.25;
      return c;
    }
    if (toFloor && toFloor.slowFloor) {
      return WALK_ONE_OVER_SOUL_SAND_COST;
    }
    return this.allowSprinting ? SPRINT_ONE_BLOCK_COST : WALK_ONE_BLOCK_COST;
  }

  _withBacktrackPenalty(node, tx, ty, tz, cost) {
    const bm = this.context.backtrackMemory;
    if (!bm) return cost;
    return (
      cost +
      bm.getNodePenalty(tx, ty, tz, this.context.now) +
      bm.getEdgePenalty(node.x, node.y, node.z, tx, ty, tz, this.context.now)
    );
  }

  _tryOpenDoorOrBreak(block, toBreak, toPlace, isHead = false) {
    if (block.safe) return 0;
    if (this.canOpenDoors && block.openable && !block.isOpen) {
      // Only push one activation per door column (lower block activates the full 2-block wooden door)
      if (!isHead) {
        toPlace.push({
          x: block.position.x,
          y: block.position.y,
          z: block.position.z,
          dx: 0,
          dy: 0,
          dz: 0,
          useOne: true,
          isDoor: block.isDoor,
        });
      }
      return isHead ? 0 : DOOR_OPEN_COST;
    }
    return this.safeOrBreak(block, toBreak);
  }

  getMoveForward(node, dir, neighbors) {
    const blockB = this.getBlock(node, dir.x, 1, dir.z);
    const blockC = this.getBlock(node, dir.x, 0, dir.z);
    const blockD = this.getBlock(node, dir.x, -1, dir.z);
    const blockHere = this.getBlock(node, 0, 0, 0);

    if (!blockC.loaded || !blockB.loaded || !blockD.loaded) return;

    const toBreak = [];
    const toPlace = [];
    let cost = this._baseHorizontalCost(blockHere, blockC, blockD);
    cost += this.exclusionStep(blockC.raw || blockC);
    if (cost >= COST_INF) return;

    // Bridging when floor is missing and destination is not water
    if (!blockD.solidFloor && !blockC.isWater) {
      if (node.remainingBlocks === 0) return;
      if (this.getNumEntitiesAt(blockD.position, 0, 0, 0) > 0) return;
      if (!blockD.replaceable) {
        if (!this.safeToBreak(blockD)) return;
        const exB = this.exclusionBreak(blockD.raw || blockD);
        if (exB >= 100) return;
        cost += exB;
        toBreak.push(blockD.position);
      }
      const exP = this.exclusionPlace(blockD.raw || blockD);
      if (exP >= 100) return;
      cost += exP + PLACE_BLOCK_BASE_COST * this.placeCost;
      toPlace.push({
        x: node.x,
        y: node.y - 1,
        z: node.z,
        dx: dir.x,
        dy: 0,
        dz: dir.z,
      });
    }

    // Handle feet & head (supporting wooden 2-block doors and 1-block fence gates)
    const cCost = this._tryOpenDoorOrBreak(blockC, toBreak, toPlace, false);
    if (cCost >= COST_INF) return;
    cost += cCost;

    const bCost =
      blockC.isDoor && !blockC.isOpen && blockB.isDoor
        ? 0
        : this._tryOpenDoorOrBreak(blockB, toBreak, toPlace, true);
    if (bCost >= COST_INF) return;
    cost += bCost;

    cost += this.adjacentHazardCost(blockC.position);
    cost = this._withBacktrackPenalty(
      node,
      blockC.position.x,
      blockC.position.y,
      blockC.position.z,
      cost,
    );
    if (cost >= COST_INF) return;

    neighbors.push(
      new Move(
        blockC.position.x,
        blockC.position.y,
        blockC.position.z,
        node.remainingBlocks - toPlace.filter((p) => !p.useOne).length,
        cost,
        toBreak,
        toPlace,
      ),
    );
  }

  getMoveJumpUp(node, dir, neighbors) {
    const blockA = this.getBlock(node, 0, 2, 0);
    const blockH = this.getBlock(node, dir.x, 2, dir.z);
    const blockB = this.getBlock(node, dir.x, 1, dir.z);
    const blockC = this.getBlock(node, dir.x, 0, dir.z);
    const block0 = this.getBlock(node, 0, -1, 0);
    const blockHere = this.getBlock(node, 0, 0, 0);

    if (!blockB.loaded || !blockC.loaded || !blockH.loaded || !blockA.loaded) {
      return;
    }

    // Entities perched above blocks we'd break
    if (blockA.physical && this.getNumEntitiesAt(blockA.position, 0, 1, 0) > 0) return;
    if (blockH.physical && this.getNumEntitiesAt(blockH.position, 0, 1, 0) > 0) return;

    const toBreak = [];
    const toPlace = [];
    let cost = 0;
    let effectiveTargetHeight = blockC.height;

    if (!blockC.solidFloor) {
      if (node.remainingBlocks === 0) return;
      if (this.getNumEntitiesAt(blockC.position, 0, 0, 0) > 0) return;

      const blockD = this.getBlock(node, dir.x, -1, dir.z);
      if (!blockD.solidFloor) {
        if (node.remainingBlocks < 2) return;
        if (this.getNumEntitiesAt(blockD.position, 0, 0, 0) > 0) return;
        if (!blockD.replaceable) {
          if (!this.safeToBreak(blockD)) return;
          cost += this.exclusionBreak(blockD.raw || blockD);
          toBreak.push(blockD.position);
        }
        const exP1 = this.exclusionPlace(blockD.raw || blockD);
        if (exP1 >= 100) return;
        cost += exP1 + PLACE_BLOCK_BASE_COST * this.placeCost;
        toPlace.push({
          x: node.x,
          y: node.y - 1,
          z: node.z,
          dx: dir.x,
          dy: 0,
          dz: dir.z,
          returnPos: new Vec3(node.x, node.y, node.z),
        });
      }

      if (!blockC.replaceable) {
        if (!this.safeToBreak(blockC)) return;
        cost += this.exclusionBreak(blockC.raw || blockC);
        toBreak.push(blockC.position);
      }
      const exP2 = this.exclusionPlace(blockC.raw || blockC);
      if (exP2 >= 100) return;
      cost += exP2 + PLACE_BLOCK_BASE_COST * this.placeCost;
      toPlace.push({
        x: node.x + dir.x,
        y: node.y - 1,
        z: node.z + dir.z,
        dx: 0,
        dy: 1,
        dz: 0,
      });
      effectiveTargetHeight = node.y + 1;
    }

    const stepDelta = effectiveTargetHeight - block0.height;
    if (stepDelta > 1.25) return; // Cannot jump higher than 1.25 blocks
    if (blockHere.isWater && stepDelta > 1.05) return; // Hard to exit water onto tall blocks
    if (block0.slowFloor && stepDelta > 0.6) return; // Soul sand / honey impedes jumps

    // Auto-step (slab/stairs <= 0.55) vs full jump
    cost +=
      stepDelta <= 0.55
        ? WALK_ONE_BLOCK_COST * 1.15
        : WALK_ONE_BLOCK_COST + JUMP_ONE_BLOCK_COST;

    if (blockHere.isWater) cost += WALK_ONE_IN_WATER_COST * 0.5 * this.liquidCost;

    const aCost = this.safeOrBreak(blockA, toBreak);
    if (aCost >= COST_INF) return;
    cost += aCost;

    const hCost = this.safeOrBreak(blockH, toBreak);
    if (hCost >= COST_INF) return;
    cost += hCost;

    const bCost = this._tryOpenDoorOrBreak(blockB, toBreak, toPlace, false);
    if (bCost >= COST_INF) return;
    cost += bCost;

    cost += this.adjacentHazardCost(blockB.position);
    cost = this._withBacktrackPenalty(
      node,
      blockB.position.x,
      blockB.position.y,
      blockB.position.z,
      cost,
    );
    if (cost >= COST_INF) return;

    neighbors.push(
      new Move(
        blockB.position.x,
        blockB.position.y,
        blockB.position.z,
        node.remainingBlocks - toPlace.filter((p) => !p.useOne).length,
        cost,
        toBreak,
        toPlace,
      ),
    );
  }

  // Baritone MovementDiagonal — strictly validates BOTH orthogonal corner columns so
  // the 0.6-wide player hitbox NEVER clips through double-solid walls, fences, or cacti!
  getMoveDiagonal(node, dir, neighbors) {
    const blockC = this.getBlock(node, dir.x, 0, dir.z);
    const blockD = this.getBlock(node, dir.x, -1, dir.z);
    const block0 = this.getBlock(node, 0, -1, 0);
    const blockHere = this.getBlock(node, 0, 0, 0);
    if (!blockC.loaded || !blockD.loaded) return;

    let dy = 0;
    if (blockC.solidFloor) {
      if (!this.allowDiagonalAscend) return;
      dy = 1;
    } else if (!blockD.solidFloor && !blockC.isWater) {
      if (!this.allowDiagonalDescend) return;
      const blockE = this.getBlock(node, dir.x, -2, dir.z);
      if (!blockD.safe || (!blockE.solidFloor && !blockD.isWater)) return;
      dy = -1;
    }

    const destFeet = this.getBlock(node, dir.x, dy, dir.z);
    const destHead = this.getBlock(node, dir.x, dy + 1, dir.z);
    const destFloor = this.getBlock(node, dir.x, dy - 1, dir.z);
    if (!destFeet.loaded || !destHead.loaded) return;

    // Baritone diagonal rule: never dig during diagonal moves (orthogonal moves handle digging cleanly)
    if (!destFeet.safe || !destHead.safe) return;

    // Check BOTH orthogonal corners (side1 = (0, *, dz), side2 = (dx, *, 0))
    const checkYMin = Math.min(0, dy);
    const checkYMax = Math.max(1, dy + 1);

    let side1Open = true;
    let side2Open = true;
    let side1HardForbid = false;
    let side2HardForbid = false;

    for (let cy = checkYMin; cy <= checkYMax; cy++) {
      const s1 = this.getBlock(node, 0, cy, dir.z);
      const s2 = this.getBlock(node, dir.x, cy, 0);
      // Fences, walls, doors, and hazards on either corner ALWAYS block diagonal movement!
      if (s1.fenceLike || s1.hazard || s1.adjacentDanger || (s1.openable && !s1.isOpen)) {
        side1HardForbid = true;
      }
      if (s2.fenceLike || s2.hazard || s2.adjacentDanger || (s2.openable && !s2.isOpen)) {
        side2HardForbid = true;
      }
      if (!s1.safe) side1Open = false;
      if (!s2.safe) side2Open = false;
    }

    if (side1HardForbid || side2HardForbid) return;
    // Double-solid corner squeeze is physically impossible in Minecraft!
    if (!side1Open && !side2Open) return;
    // Ascending or descending diagonally requires BOTH corners open so hitbox won't snag mid-jump
    if (dy !== 0 && (!side1Open || !side2Open)) return;

    // Check headroom for diagonal ascend
    if (dy === 1) {
      if (blockC.height - block0.height > 1.25) return;
      if (block0.slowFloor || blockHere.isWater) return;
      if (!this.getBlock(node, 0, 2, 0).safe) return;
    }
    // Check headroom for diagonal descend
    if (dy === -1 && !this.getBlock(node, dir.x, 1, dir.z).safe) return;

    let horizCost = this._baseHorizontalCost(blockHere, destFeet, destFloor);
    let cost = Math.SQRT2 * horizCost + DIAGONAL_NUDGE_COST;
    if (!side1Open || !side2Open) {
      cost += CORNER_CLIP_PENALTY;
    }
    if (dy === 1) {
      cost += JUMP_ONE_BLOCK_COST;
    } else if (dy === -1) {
      cost += fallCost(1);
    }

    const exStep = this.exclusionStep(destFeet.raw || destFeet);
    if (exStep >= 100) return;
    cost += exStep;
    cost += this.getNumEntitiesAt(destFeet.position, 0, 0, 0) * this.entityCost;
    cost += this.adjacentHazardCost(destFeet.position);
    cost = this._withBacktrackPenalty(
      node,
      destFeet.position.x,
      destFeet.position.y,
      destFeet.position.z,
      cost,
    );
    if (cost >= COST_INF) return;

    neighbors.push(
      new Move(
        destFeet.position.x,
        destFeet.position.y,
        destFeet.position.z,
        node.remainingBlocks,
        cost,
      ),
    );
  }

  getLandingBlock(node, dir) {
    const minY = this.bot?.game?.minY ?? -64;
    let blockLand = this.getBlock(node, dir.x, -2, dir.z);
    while (blockLand.loaded && blockLand.position.y > minY) {
      if (blockLand.isWater && blockLand.safe) {
        return { landing: blockLand, intoWater: true };
      }
      if (blockLand.hazard || blockLand.isLava) return null;
      if (blockLand.solidFloor) {
        const drop = node.y - (blockLand.position.y + 1);
        if (drop <= this.maxDropDown) {
          const standSpot = this.getBlock(blockLand.position, 0, 1, 0);
          return standSpot.safe ? { landing: standSpot, intoWater: false } : null;
        }
        return null;
      }
      if (!blockLand.safe) return null;
      blockLand = this.getBlock(blockLand.position, 0, -1, 0);
    }
    return null;
  }

  getMoveDropDown(node, dir, neighbors) {
    const blockB = this.getBlock(node, dir.x, 1, dir.z);
    const blockC = this.getBlock(node, dir.x, 0, dir.z);
    const blockD = this.getBlock(node, dir.x, -1, dir.z);
    if (!blockB.loaded || !blockC.loaded || !blockD.loaded) return;
    if (blockC.liquid) return;

    const landRes = this.getLandingBlock(node, dir);
    if (!landRes || !landRes.landing) return;
    const blockLand = landRes.landing;
    const dropDist = node.y - blockLand.position.y;
    if (dropDist <= 0) return;
    if (!this.infiniteLiquidDropdownDistance && dropDist > this.maxDropDown) {
      return;
    }

    const toBreak = [];
    const toPlace = [];
    let cost = WALK_OFF_BLOCK_COST + fallCost(dropDist) + CENTER_AFTER_FALL_COST;

    // Penalize non-water drops > 3 blocks (causes fall damage in Minecraft)
    if (!landRes.intoWater && dropDist > 3) {
      cost += (dropDist - 3) * 14.0;
    }

    const bCost = this.safeOrBreak(blockB, toBreak);
    if (bCost >= COST_INF) return;
    cost += bCost;

    const cCost = this.safeOrBreak(blockC, toBreak);
    if (cCost >= COST_INF) return;
    cost += cCost;

    const dCost = this.safeOrBreak(blockD, toBreak);
    if (dCost >= COST_INF) return;
    cost += dCost;

    cost += this.getNumEntitiesAt(blockLand.position, 0, 0, 0) * this.entityCost;
    cost += this.adjacentHazardCost(blockLand.position);
    cost = this._withBacktrackPenalty(
      node,
      blockLand.position.x,
      blockLand.position.y,
      blockLand.position.z,
      cost,
    );
    if (cost >= COST_INF) return;

    neighbors.push(
      new Move(
        blockLand.position.x,
        blockLand.position.y,
        blockLand.position.z,
        node.remainingBlocks - toPlace.length,
        cost,
        toBreak,
        toPlace,
      ),
    );
  }

  getMoveDown(node, neighbors) {
    const blockHere = this.getBlock(node, 0, 0, 0);
    const block0 = this.getBlock(node, 0, -1, 0);
    if (!block0.loaded) return;

    // Descending a ladder / vine cleanly without digging
    if (block0.climbable && block0.safe) {
      let cost = LADDER_DOWN_ONE_COST;
      cost += this.adjacentHazardCost(block0.position);
      cost = this._withBacktrackPenalty(
        node,
        block0.position.x,
        block0.position.y,
        block0.position.z,
        cost,
      );
      if (cost < COST_INF) {
        neighbors.push(
          new Move(
            block0.position.x,
            block0.position.y,
            block0.position.z,
            node.remainingBlocks,
            cost,
          ),
        );
      }
      return;
    }

    if (blockHere.liquid) return;

    const landRes = this.getLandingBlock(node, { x: 0, z: 0 });
    if (!landRes || !landRes.landing) return;
    const blockLand = landRes.landing;
    const dropDist = node.y - blockLand.position.y;
    if (dropDist <= 0 || (!landRes.intoWater && dropDist > this.maxDropDown)) {
      return;
    }

    const toBreak = [];
    let cost = fallCost(dropDist) + CENTER_AFTER_FALL_COST;
    if (!landRes.intoWater && dropDist > 3) {
      cost += (dropDist - 3) * 16.0;
    }

    const b0Cost = this.safeOrBreak(block0, toBreak);
    if (b0Cost >= COST_INF) return;
    cost += b0Cost;

    cost += this.getNumEntitiesAt(blockLand.position, 0, 0, 0) * this.entityCost;
    cost += this.adjacentHazardCost(blockLand.position);
    cost = this._withBacktrackPenalty(
      node,
      blockLand.position.x,
      blockLand.position.y,
      blockLand.position.z,
      cost,
    );
    if (cost >= COST_INF) return;

    neighbors.push(
      new Move(
        blockLand.position.x,
        blockLand.position.y,
        blockLand.position.z,
        node.remainingBlocks,
        cost,
        toBreak,
      ),
    );
  }

  getMoveUp(node, neighbors) {
    const block1 = this.getBlock(node, 0, 0, 0);
    const block2 = this.getBlock(node, 0, 2, 0);
    if (!block1.loaded || !block2.loaded) return;
    if (block1.liquid) return;
    if (this.getNumEntitiesAt(node, 0, 0, 0) > 0) return;

    const toBreak = [];
    const toPlace = [];
    let cost = 0;

    const b2Cost = this.safeOrBreak(block2, toBreak);
    if (b2Cost >= COST_INF) return;
    cost += b2Cost;

    if (block1.climbable) {
      cost += LADDER_UP_ONE_COST;
    } else {
      if (!this.allow1by1towers || node.remainingBlocks === 0) return;
      if (!block1.replaceable) {
        if (!this.safeToBreak(block1)) return;
        toBreak.push(block1.position);
      }
      const block0 = this.getBlock(node, 0, -1, 0);
      if (!block0.solidFloor || block0.height - node.y < -0.2) return;
      if (block0.slowFloor) return;

      const exP = this.exclusionPlace(block1.raw || block1);
      if (exP >= 100) return;
      cost +=
        JUMP_ONE_BLOCK_COST +
        WALK_ONE_BLOCK_COST * 0.5 +
        exP +
        PLACE_BLOCK_BASE_COST * this.placeCost;
      toPlace.push({
        x: node.x,
        y: node.y - 1,
        z: node.z,
        dx: 0,
        dy: 1,
        dz: 0,
        jump: true,
      });
    }

    cost += this.adjacentHazardCost({ x: node.x, y: node.y + 1, z: node.z });
    cost = this._withBacktrackPenalty(node, node.x, node.y + 1, node.z, cost);
    if (cost >= COST_INF) return;

    neighbors.push(
      new Move(
        node.x,
        node.y + 1,
        node.z,
        node.remainingBlocks - toPlace.length,
        cost,
        toBreak,
        toPlace,
      ),
    );
  }

  // Baritone MovementParkour — realistic tick cost + strict takeoff, ceiling, and landing validation
  getMoveParkourForward(node, dir, neighbors) {
    const block0 = this.getBlock(node, 0, -1, 0);
    const blockHere = this.getBlock(node, 0, 0, 0);
    if (!block0.solidFloor || block0.slowFloor || blockHere.liquid) return;

    const block1 = this.getBlock(node, dir.x, -1, dir.z);
    // Only consider parkour when there is an actual gap or hazard directly ahead
    if (
      (block1.solidFloor && block1.height >= block0.height) ||
      !this.getBlock(node, dir.x, 0, dir.z).safe ||
      !this.getBlock(node, dir.x, 1, dir.z).safe
    ) {
      return;
    }

    let ceilingClear =
      this.getBlock(node, 0, 2, 0).safe &&
      this.getBlock(node, dir.x, 2, dir.z).safe;
    let floorCleared = !this.getBlock(node, dir.x, -2, dir.z).physical;
    let overLava = block1.isLava;

    const maxD = this.allowSprinting ? 4 : 2;
    const speedCost = this.allowSprinting
      ? SPRINT_ONE_BLOCK_COST
      : WALK_ONE_BLOCK_COST;

    for (let d = 2; d <= maxD; d++) {
      const dx = dir.x * d;
      const dz = dir.z * d;
      const blockA = this.getBlock(node, dx, 2, dz);
      const blockB = this.getBlock(node, dx, 1, dz);
      const blockC = this.getBlock(node, dx, 0, dz);
      const blockD = this.getBlock(node, dx, -1, dz);
      if (!blockC.loaded || !blockD.loaded) break;

      if (blockD.isLava) overLava = true;

      const baseCost =
        d * speedCost +
        JUMP_ONE_BLOCK_COST +
        PARKOUR_RISK_PENALTY +
        (overLava ? 22.0 : 0);

      if (ceilingClear && blockB.safe && blockC.safe && blockD.solidFloor) {
        let cost = baseCost + this.exclusionStep(blockC.raw || blockC);
        cost += this.getNumEntitiesAt(blockC.position, 0, 0, 0) * this.entityCost;
        cost += this.adjacentHazardCost(blockC.position);
        cost = this._withBacktrackPenalty(
          node,
          blockC.position.x,
          blockC.position.y,
          blockC.position.z,
          cost,
        );
        if (cost < COST_INF) {
          neighbors.push(
            new Move(
              blockC.position.x,
              blockC.position.y,
              blockC.position.z,
              node.remainingBlocks,
              cost,
              [],
              [],
              true,
            ),
          );
        }
        break;
      } else if (
        this.allowParkourAscend &&
        ceilingClear &&
        blockB.safe &&
        blockC.solidFloor
      ) {
        // 4-block forward + 1 up is extremely tight & error-prone; cap at d <= 3
        if (blockA.safe && d <= 3 && blockC.height - block0.height <= 1.2) {
          let cost =
            baseCost +
            JUMP_ONE_BLOCK_COST +
            this.exclusionStep(blockB.raw || blockB);
          cost +=
            this.getNumEntitiesAt(blockB.position, 0, 0, 0) * this.entityCost;
          cost += this.adjacentHazardCost(blockB.position);
          cost = this._withBacktrackPenalty(
            node,
            blockB.position.x,
            blockB.position.y,
            blockB.position.z,
            cost,
          );
          if (cost < COST_INF) {
            neighbors.push(
              new Move(
                blockB.position.x,
                blockB.position.y,
                blockB.position.z,
                node.remainingBlocks,
                cost,
                [],
                [],
                true,
              ),
            );
          }
          break;
        }
      } else if (
        (ceilingClear || d === 2) &&
        blockB.safe &&
        blockC.safe &&
        blockD.safe &&
        floorCleared
      ) {
        const blockE = this.getBlock(node, dx, -2, dz);
        if (blockE.solidFloor) {
          let cost =
            baseCost +
            fallCost(1) +
            this.exclusionStep(blockD.raw || blockD);
          cost +=
            this.getNumEntitiesAt(blockD.position, 0, 0, 0) * this.entityCost;
          cost += this.adjacentHazardCost(blockD.position);
          cost = this._withBacktrackPenalty(
            node,
            blockD.position.x,
            blockD.position.y,
            blockD.position.z,
            cost,
          );
          if (cost < COST_INF) {
            neighbors.push(
              new Move(
                blockD.position.x,
                blockD.position.y,
                blockD.position.z,
                node.remainingBlocks,
                cost,
                [],
                [],
                true,
              ),
            );
          }
        }
        floorCleared = floorCleared && !blockE.physical;
      } else if (!blockB.safe || !blockC.safe) {
        break;
      }

      ceilingClear = ceilingClear && blockA.safe;
    }
  }

  getNeighbors(node) {
    const neighbors = [];

    for (let i = 0; i < 4; i++) {
      const dir = CARDINAL_DIRS[i];
      this.getMoveForward(node, dir, neighbors);
      this.getMoveJumpUp(node, dir, neighbors);
      this.getMoveDropDown(node, dir, neighbors);
      if (this.allowParkour) {
        this.getMoveParkourForward(node, dir, neighbors);
      }
    }

    for (let i = 0; i < 4; i++) {
      this.getMoveDiagonal(node, DIAGONAL_DIRS[i], neighbors);
    }

    this.getMoveDown(node, neighbors);
    this.getMoveUp(node, neighbors);

    return neighbors;
  }
}

module.exports = {
  BaritoneMovements,
  Move,
  CARDINAL_DIRS,
  DIAGONAL_DIRS,
  isDoorOrGateOpen,
};
