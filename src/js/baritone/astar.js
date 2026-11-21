// Baritone-inspired A* search engine modeled after AbstractNodeCostSearch.java:
// - O(log N) binary min-heap with direct node index tracking
// - Tick-calibrated heuristic matching ActionCosts units
// - Multi-coefficient bestSoFar tracking (COEFFICIENTS = [1.5, 2, 2.5, 3, 4, 5, 10])
//   with MIN_DIST_PATH filtering so partial/timeout paths escape dead-end traps
// - Two-phase timeouts (primaryTimeoutMs for fast segment start, failureTimeoutMs for hard paths)

const { performance } = require("perf_hooks");
const { COST_INF, HEURISTIC_TICK_SCALE } = require("./actionCosts");

const COEFFICIENTS = [1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 10.0];
const MIN_DIST_PATH = 5;
const MIN_DIST_PATH_SQ = MIN_DIST_PATH * MIN_DIST_PATH;
const MIN_IMPROVEMENT = 0.01;

class PathNode {
  constructor() {
    this.data = null;
    this.g = 0;
    this.h = 0;
    this.f = 0;
    this.parent = null;
    this.heapIndex = -1;
  }

  set(data, g, h, heuristicWeight = 1.0, parent = null) {
    this.data = data;
    this.g = g;
    this.h = h;
    this.f = g + h * heuristicWeight;
    this.parent = parent;
    return this;
  }
}

class BinaryHeap {
  constructor() {
    this.items = [];
  }

  size() {
    return this.items.length;
  }

  isEmpty() {
    return this.items.length === 0;
  }

  push(node) {
    node.heapIndex = this.items.length;
    this.items.push(node);
    this._siftUp(node.heapIndex);
  }

  pop() {
    const len = this.items.length;
    if (len === 0) return null;
    const top = this.items[0];
    top.heapIndex = -1;
    if (len === 1) {
      this.items.pop();
      return top;
    }
    const last = this.items.pop();
    this.items[0] = last;
    last.heapIndex = 0;
    this._siftDown(0);
    return top;
  }

  update(node) {
    if (node.heapIndex < 0 || node.heapIndex >= this.items.length) return;
    this._siftUp(node.heapIndex);
    this._siftDown(node.heapIndex);
  }

  _siftUp(idx) {
    const items = this.items;
    const node = items[idx];
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      const parent = items[parentIdx];
      if (node.f >= parent.f) break;
      items[idx] = parent;
      parent.heapIndex = idx;
      idx = parentIdx;
    }
    items[idx] = node;
    node.heapIndex = idx;
  }

  _siftDown(idx) {
    const items = this.items;
    const len = items.length;
    const node = items[idx];
    while (true) {
      const leftIdx = (idx << 1) + 1;
      const rightIdx = leftIdx + 1;
      let smallest = idx;

      if (leftIdx < len && items[leftIdx].f < items[smallest].f) {
        smallest = leftIdx;
      }
      if (rightIdx < len && items[rightIdx].f < items[smallest].f) {
        smallest = rightIdx;
      }
      if (smallest === idx) break;
      const swap = items[smallest];
      items[idx] = swap;
      swap.heapIndex = idx;
      idx = smallest;
    }
    items[idx] = node;
    node.heapIndex = idx;
  }
}

function reconstructPath(node) {
  const path = [];
  let cur = node;
  while (cur && cur.parent) {
    path.push(cur.data);
    cur = cur.parent;
  }
  path.reverse();
  return path;
}

class BaritoneAStar {
  constructor(
    start,
    movements,
    goal,
    timeout = 3000,
    tickTimeout = 35,
    searchRadius = -1,
    options = {},
  ) {
    this.startTime = performance.now();
    this.start = start;
    this.movements = movements;
    this.goal = goal;
    this.timeout = timeout;
    this.primaryTimeout = Math.min(
      timeout,
      typeof options.primaryTimeout === "number"
        ? options.primaryTimeout
        : Math.max(350, Math.min(850, timeout * 0.35)),
    );
    this.tickTimeout = tickTimeout;
    this.heuristicWeight =
      typeof options.heuristicWeight === "number"
        ? options.heuristicWeight
        : 1.15;
    this.heuristicScale =
      typeof options.heuristicScale === "number"
        ? options.heuristicScale
        : HEURISTIC_TICK_SCALE;
    this.minDistPathSq =
      typeof options.minDistPath === "number"
        ? options.minDistPath * options.minDistPath
        : MIN_DIST_PATH_SQ;
    this.maxNodes =
      typeof options.maxNodes === "number" ? options.maxNodes : 25000;

    this.closedDataSet = new Set();
    this.openHeap = new BinaryHeap();
    this.openDataMap = new Map();
    this.visitedChunks = new Set();

    const startH = this._evalHeuristic(start);
    const startNode = new PathNode().set(
      start,
      0,
      startH,
      this.heuristicWeight,
      null,
    );
    this.openHeap.push(startNode);
    this.openDataMap.set(start.hash, startNode);

    this.bestNode = startNode;
    this.bestSoFar = new Array(COEFFICIENTS.length).fill(null);
    this.bestScores = new Float64Array(COEFFICIENTS.length);
    for (let i = 0; i < COEFFICIENTS.length; i++) {
      this.bestScores[i] = Infinity;
    }

    this.maxCost =
      searchRadius < 0
        ? -1
        : startNode.h + searchRadius * this.heuristicScale;
    this.failing = true;
    this._primaryHit = false;
  }

  _evalHeuristic(pos) {
    if (typeof this.goal.tickHeuristic === "function") {
      return Math.max(0, this.goal.tickHeuristic(pos));
    }
    const raw = Number(this.goal.heuristic(pos));
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw * this.heuristicScale;
  }

  _distFromStartSq(pos) {
    const dx = pos.x - this.start.x;
    const dy = pos.y - this.start.y;
    const dz = pos.z - this.start.z;
    return dx * dx + dy * dy + dz * dz;
  }

  _updateBestSoFar(node) {
    if (node.h < this.bestNode.h - MIN_IMPROVEMENT) {
      this.bestNode = node;
    }
    const distSq = this._distFromStartSq(node.data);
    if (distSq < this.minDistPathSq) return;

    this.failing = false;
    for (let i = 0; i < COEFFICIENTS.length; i++) {
      // Equivalent to Baritone's h + g / COEFFICIENTS[i] (lower is better).
      const score = node.h + node.g / COEFFICIENTS[i];
      if (score < this.bestScores[i] - MIN_IMPROVEMENT) {
        this.bestScores[i] = score;
        this.bestSoFar[i] = node;
      }
    }
  }

  pickBestSoFarNode() {
    // Prefer the most optimal coefficient (lowest index, 1.5 -> 2.0 -> ...) that made
    // meaningful distance from start (>= MIN_DIST_PATH), avoiding cul-de-sac traps.
    for (let i = 0; i < COEFFICIENTS.length; i++) {
      const candidate = this.bestSoFar[i];
      if (candidate && candidate !== this.start) {
        return candidate;
      }
    }
    return this.bestNode;
  }

  makeResult(status, node) {
    return {
      status,
      cost: node ? node.g : 0,
      time: performance.now() - this.startTime,
      visitedNodes: this.closedDataSet.size,
      generatedNodes: this.closedDataSet.size + this.openHeap.size(),
      path: node ? reconstructPath(node) : [],
      isSegment: status === "partial" || (status === "timeout" && !this.failing),
      context: this,
    };
  }

  compute() {
    const computeStart = performance.now();
    let iterations = 0;

    while (!this.openHeap.isEmpty()) {
      iterations += 1;
      // Check clocks every 32 expansions to avoid performance.now() overhead in hot loop
      if ((iterations & 31) === 0) {
        const now = performance.now();
        if (now - computeStart > this.tickTimeout) {
          return this.makeResult("partial", this.pickBestSoFarNode());
        }
        const elapsed = now - this.startTime;
        if (!this._primaryHit && !this.failing && elapsed > this.primaryTimeout) {
          this._primaryHit = true;
          return this.makeResult("partial", this.pickBestSoFarNode());
        }
        if (elapsed > this.timeout || this.closedDataSet.size >= this.maxNodes) {
          return this.makeResult("timeout", this.pickBestSoFarNode());
        }
      }

      const node = this.openHeap.pop();
      if (!node) break;

      if (this.goal.isEnd(node.data)) {
        return this.makeResult("success", node);
      }

      this.openDataMap.delete(node.data.hash);
      this.closedDataSet.add(node.data.hash);
      this.visitedChunks.add(`${node.data.x >> 4},${node.data.z >> 4}`);
      this._updateBestSoFar(node);

      const neighbors = this.movements.getNeighbors(node.data);
      for (let i = 0; i < neighbors.length; i++) {
        const neighborData = neighbors[i];
        if (
          !neighborData ||
          neighborData.cost >= COST_INF ||
          this.closedDataSet.has(neighborData.hash)
        ) {
          continue;
        }

        const gFromThisNode = node.g + neighborData.cost;
        let neighborNode = this.openDataMap.get(neighborData.hash);

        if (neighborNode !== undefined) {
          if (neighborNode.g <= gFromThisNode + MIN_IMPROVEMENT) {
            continue;
          }
          neighborNode.set(
            neighborData,
            gFromThisNode,
            neighborNode.h,
            this.heuristicWeight,
            node,
          );
          this.openHeap.update(neighborNode);
          continue;
        }

        const heuristic = this._evalHeuristic(neighborData);
        if (this.maxCost > 0 && gFromThisNode + heuristic > this.maxCost) {
          continue;
        }

        neighborNode = new PathNode().set(
          neighborData,
          gFromThisNode,
          heuristic,
          this.heuristicWeight,
          node,
        );
        this.openDataMap.set(neighborData.hash, neighborNode);
        this.openHeap.push(neighborNode);
      }
    }

    return this.makeResult("noPath", this.pickBestSoFarNode());
  }
}

module.exports = {
  BaritoneAStar,
  BinaryHeap,
  PathNode,
  COEFFICIENTS,
  MIN_DIST_PATH,
  reconstructPath,
};
