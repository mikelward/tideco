// Tests for tidedefaults.mjs: tide for Linux's defaults read from a
// checkout's files, and a port's compared with them. tide on KDE copies
// this file unchanged, as it does tidedefaults.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { camel, compare, luaTable, main, readTide } from "./tidedefaults.mjs";

// layout.lua's M.defaults as tide writes it: comments, nested tables,
// lists of tables and an empty one.
const LAYOUT_LUA = `local M = {}

M.defaults = {
    -- Work-area aspect ratio at and above which ...
    ultrawide_aspect = 2.1,
    default_mode = { normal = "tile", ultrawide = "threecol" },
    single = {
        { min_aspect = 2.1, width = 0.8 },
        { min_aspect = 3.2, width = 0.6 },
    },
    modes = {
        tile = { mfact = 0.55, nmaster = 1 },
        monocle = {},
    },
    cycle = { "tile", "threecol", "twocol" }, -- monocle has its own toggle
    new_window = "end",
    mfact_step = 0.025,
}

return M
`;

// A tide checkout's files that tidedefaults.mjs reads, in a fresh directory
// with `layout` as its layout.lua; `f` gets the directory, which is
// removed after.
async function withTide(layout, f) {
  const dir = mkdtempSync(join(tmpdir(), "tide-"));
  const files = {
    "hypr/tide/layout.lua": layout,
    "hypr/tide/geometry.lua": "local M = {}\nM.mfact_min, M.mfact_max = 0.1, 0.9\nreturn M\n",
    "shell/lib/clocks.mjs": 'export const DEFAULT_CLOCKS = Object.freeze([{ zone: "Europe/London", label: "LON" }]);\n',
    "shell/lib/workspacenames.mjs": 'export const DEFAULT_STANDING = Object.freeze(["in", "re"]);\n',
  };
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return await f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A port's defaults, matching the fixture's.
const SAME = [
  {
    from: "src/settings.js",
    values: {
      ultrawideAspect: 2.1,
      defaultMode: { normal: "tile", ultrawide: "threecol" },
      modes: { tile: { mfact: 0.55, nmaster: 1 } },
      single: [
        { minAspect: 2.1, width: 0.8 },
        { minAspect: 3.2, width: 0.6 },
      ],
      cycle: ["tile", "threecol", "twocol"],
    },
  },
  {
    from: "src/other.js",
    values: { mfactMin: 0.1, mfactMax: 0.9, clocks: [{ zone: "Europe/London", label: "LON" }], standing: ["in", "re"] },
  },
];

test("tide's layout defaults read as written, in JavaScript's names", () => {
  assert.deepEqual(camel(luaTable(LAYOUT_LUA, "M.defaults")), {
    ultrawideAspect: 2.1,
    defaultMode: { normal: "tile", ultrawide: "threecol" },
    single: [
      { minAspect: 2.1, width: 0.8 },
      { minAspect: 3.2, width: 0.6 },
    ],
    modes: { tile: { mfact: 0.55, nmaster: 1 }, monocle: {} },
    cycle: ["tile", "threecol", "twocol"],
    newWindow: "end",
    mfactStep: 0.025,
  });
});

test("a default that isn't a literal is an error, not a wrong value", () => {
  assert.throws(() => luaTable("M.defaults = { mfact = 0.5 * 1.1 }", "M.defaults"), /M\.defaults, line 1: expected "," or "}"/);
  assert.throws(() => luaTable("M.defaults = { mfact = half }", "M.defaults"), /expected a number, string, boolean or table/);
  assert.throws(() => luaTable("M.other = {}", "M.defaults"), /no "M\.defaults = \{" found/);
});

test("a port whose defaults match passes", async () => {
  await withTide(LAYOUT_LUA, async (dir) => {
    assert.deepEqual(compare("tide for Chrome", SAME, await readTide(dir)), []);
    const errors = [];
    assert.equal(await main("tide for Chrome", SAME, dir, {}, (s) => errors.push(s)), 0);
    assert.deepEqual(errors, []);
  });
});

test("a default that drifts fails, naming the setting and both values", async () => {
  await withTide(LAYOUT_LUA.replace("tile = { mfact = 0.55", "tile = { mfact = 0.6"), async (dir) => {
    const errors = [];
    assert.equal(await main("tide for Chrome", SAME, dir, {}, (s) => errors.push(s)), 1);
    assert.deepEqual(errors, ["check-tide-defaults: modes.tile.mfact: tide for Chrome 0.55 (src/settings.js), tide for Linux 0.6\n"]);
  });
});

test("a list that drifts fails whole", async () => {
  await withTide(LAYOUT_LUA, async (dir) => {
    const sources = [{ from: "src/clocks.js", values: { clocks: [{ zone: "Europe/London", label: "LDN" }] } }];
    assert.deepEqual(compare("tide for Chrome", sources, await readTide(dir)), [
      'clocks: tide for Chrome [{"zone":"Europe/London","label":"LDN"}] (src/clocks.js), tide for Linux [{"zone":"Europe/London","label":"LON"}]',
    ]);
  });
});

test("a default tide doesn't have fails, so a rename in tide is seen", async () => {
  await withTide(LAYOUT_LUA, async (dir) => {
    assert.deepEqual(compare("tide for Chrome", [{ from: "src/x.js", values: { mfactStpe: 0.025 } }], await readTide(dir)), [
      "mfactStpe: tide for Chrome 0.025 (src/x.js), but tide for Linux has no such default",
    ]);
  });
});

test("an exception allows the difference it names, and fails once either side moves", () => {
  const tide = { cycle: ["tile", "twocol"] };
  const exceptions = { cycle: { ours: ["tile", "twocol", "monocle"], tide: ["tile", "twocol"] } };
  const ours = (cycle) => [{ from: "src/geometry.js", values: { cycle } }];
  assert.deepEqual(compare("tide for Chrome", ours(["tile", "twocol", "monocle"]), tide, exceptions), []);
  assert.match(compare("tide for Chrome", ours(["tile", "twocol"]), tide, exceptions)[0], /now matches tide for Linux's: take it out of the exceptions/);
  assert.match(compare("tide for Chrome", ours(["monocle"]), tide, exceptions)[0], /but the exception allows/);
  assert.match(compare("tide for Chrome", ours(["tile", "twocol", "monocle"]), { cycle: ["tile"] }, exceptions)[0], /but the exception allows/);
  assert.deepEqual(compare("tide for Chrome", [], tide, exceptions), ["cycle: an exception for a setting tide for Chrome doesn't compare"]);
});

test("a checkout missing a file fails, naming it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-"));
  try {
    const errors = [];
    assert.equal(await main("tide for Chrome", SAME, dir, {}, (s) => errors.push(s)), 1);
    assert.match(errors[0], /hypr\/tide\/layout\.lua: can't read tide for Linux's hypr\/tide\/layout\.lua/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
