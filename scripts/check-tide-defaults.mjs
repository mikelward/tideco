// make check-tide-defaults: tide for Chrome's defaults that restate tide for
// Linux's are still tide for Linux's, read from a tide checkout (the path
// given, ../tide by default). Usage: node scripts/check-tide-defaults.mjs DIR
import { pathToFileURL } from "node:url";
import { DEFAULT_CLOCKS } from "../src/clocks.js";
import * as geometry from "../src/geometry.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { DEFAULT_MODE_SETTINGS, DEFAULT_STANDING } from "../src/workspaces.js";
import { main } from "./tidedefaults.mjs";

export const NAME = "tide for Chrome";

// Deliberate differences, by setting, each saying why: they pass while both
// sides keep these values, and fail once either moves.
export const EXCEPTIONS = {
  // Search+. and Search+, step through monocle too (layout-next in
  // src/tide.js), where tide for Linux's cycle leaves it to its own toggle.
  // Not settled: TODO.md's Decisions needing review.
  cycle: { ours: ["tile", "threecol", "twocol", "monocle"], tide: ["tile", "threecol", "twocol"] },
};

const { tile, threecol, twocol } = DEFAULT_MODE_SETTINGS;

// Where tide for Chrome keeps each default that is tide for Linux's. The
// workspaces' own copy of the mfact bounds is held to geometry.js's by
// workspaces_test.js.
export const SOURCES = [
  {
    from: "src/settings.js",
    values: {
      ultrawideAspect: DEFAULT_SETTINGS.ultrawideAspect,
      defaultMode: DEFAULT_SETTINGS.defaultMode,
      modes: DEFAULT_SETTINGS.modes,
      single: DEFAULT_SETTINGS.singleRules,
    },
  },
  { from: "src/workspaces.js", values: { modes: { tile, threecol, twocol }, standing: DEFAULT_STANDING } },
  { from: "src/geometry.js", values: { mfactMin: geometry.MFACT_MIN, mfactMax: geometry.MFACT_MAX, cycle: geometry.modes } },
  { from: "src/clocks.js", values: { clocks: DEFAULT_CLOCKS.map(({ zone, label }) => ({ zone, label })) } },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(NAME, SOURCES, process.argv[2] ?? "../tide", EXCEPTIONS);
}
