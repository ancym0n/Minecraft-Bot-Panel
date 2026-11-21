const fs = require("fs");
const path = require("path");

let planner;

function getPlanner() {
  if (!planner) {
    const file = path.join(__dirname, "planner.wasm");
    try {
      const module = new WebAssembly.Module(fs.readFileSync(file));
      planner = new WebAssembly.Instance(module).exports;
    } catch (err) {
      throw new Error(`Could not load Rust planner (${file}): ${err.message}`);
    }
  }
  return planner;
}

function readPoints(exports, count) {
  if (count < 0) throw new RangeError("Invalid spatial planner arguments");
  const pointer = exports.plan_output();
  const view = new DataView(exports.memory.buffer, pointer, count * 12);
  return Array.from({ length: count }, (_, i) => ({
    dx: view.getInt32(i * 12, true),
    dy: view.getInt32(i * 12 + 4, true),
    dz: view.getInt32(i * 12 + 8, true),
  }));
}

function validateIntegers(...values) {
  if (!values.every(Number.isSafeInteger)) {
    throw new RangeError("Invalid spatial planner arguments");
  }
}

function quarry(size, depth) {
  validateIntegers(size, depth);
  const exports = getPlanner();
  return readPoints(exports, exports.plan_quarry(size, depth));
}

function tunnel(size, depth, dir) {
  validateIntegers(size, depth, dir?.fx, dir?.fz, dir?.rx, dir?.rz);
  const exports = getPlanner();
  return readPoints(
    exports,
    exports.plan_tunnel(size, depth, dir.fx, dir.fz, dir.rx, dir.rz),
  );
}

function template(name, size) {
  validateIntegers(size);
  const kind =
    {
      wall: 1,
      tower: 2,
      pillar: 2,
      bridge: 3,
      bunker: 4,
      hut: 4,
    }[
      String(name || "platform")
        .trim()
        .toLowerCase()
    ] ?? 0;
  const exports = getPlanner();
  return readPoints(exports, exports.plan_template(kind, size));
}

module.exports = { quarry, tunnel, template };
