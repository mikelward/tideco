// tide for Linux's defaults, read from a tide checkout, and a comparison
// with a port's own, so a default that drifts fails CI rather than waiting
// for a review (make check-tide-defaults). tide for Chrome's; tide on KDE
// copies it unchanged (its make check-tideco).
//
// tide's layout defaults are Lua (hypr/tide/layout.lua's M.defaults, the
// mfact bounds in hypr/tide/geometry.lua), read here by a parser for table
// literals alone; its clocks and standing workspaces are ES modules,
// imported as they are.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const TIDE = "tide for Linux";

// The Lua table literal assigned to `name` (as `M.defaults`) at the start
// of a line in `text`, as plain values: a table with keys is an object, one
// without a list. Only literals are read (numbers, strings, booleans,
// tables, `--` comments): anything else is an error, so a default that
// becomes an expression fails here instead of reading wrong.
export function luaTable(text, name) {
  const start = new RegExp(`^${name.replace(/[.]/g, "\\.")}\\s*=\\s*\\{`, "m").exec(text);
  if (!start) throw new Error(`no "${name} = {" found`);
  let i = start.index + start[0].length - 1;

  const fail = (what) => {
    const line = text.slice(0, i).split("\n").length;
    throw new Error(`${name}, line ${line}: ${what}`);
  };
  const match = (re) => {
    re.lastIndex = i;
    const m = re.exec(text);
    if (m) i = re.lastIndex;
    return m;
  };
  const skip = () => match(/(?:\s+|--[^\n]*)*/y);

  const value = () => {
    skip();
    let m;
    if (text[i] === "{") return table();
    if ((m = match(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/y))) {
      return (m[1] ?? m[2]).replace(/\\(.)/g, (_, c) => ({ n: "\n", t: "\t" })[c] ?? c);
    }
    if ((m = match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y))) return Number(m[0]);
    if ((m = match(/(?:true|false)\b/y))) return m[0] === "true";
    fail(`expected a number, string, boolean or table at ${JSON.stringify(text.slice(i, i + 20))}`);
  };

  const table = () => {
    i++; // {
    const keyed = {};
    const listed = [];
    for (;;) {
      skip();
      if (text[i] === "}") {
        i++;
        break;
      }
      const key = match(/([A-Za-z_]\w*)\s*=(?!=)/y);
      if (key) keyed[key[1]] = value();
      else listed.push(value());
      skip();
      if (text[i] === "," || text[i] === ";") i++;
      else if (text[i] !== "}") fail(`expected "," or "}" at ${JSON.stringify(text.slice(i, i + 20))}`);
    }
    if (listed.length > 0 && Object.keys(keyed).length > 0) fail("a table with both keys and a list");
    return listed.length > 0 ? listed : keyed;
  };

  return table();
}

// `v` with every key from Lua's snake_case in JavaScript's camelCase, the
// rule tide's own layouts.json follows (min_aspect is minAspect).
export function camel(v) {
  if (Array.isArray(v)) return v.map(camel);
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), camel(x)]));
}

function read(dir, path) {
  try {
    return readFileSync(join(dir, path), "utf8");
  } catch (e) {
    throw new Error(`can't read ${TIDE}'s ${path} in ${dir}: ${e.message}`);
  }
}

async function load(dir, path) {
  try {
    return await import(pathToFileURL(join(dir, path)).href);
  } catch (e) {
    throw new Error(`can't import ${TIDE}'s ${path} in ${dir}: ${e.message}`);
  }
}

// tide for Linux's defaults in the checkout at `dir`, in JavaScript's
// names: layout.lua's M.defaults (ultrawideAspect, defaultMode, single,
// modes, cycle, newWindow, mfactStep and the rest), geometry.lua's mfact
// bounds as mfactMin and mfactMax, and the default clocks' zones and labels
// and the standing workspaces.
export async function readTide(dir) {
  const where = (path, f) => {
    try {
      return f(read(dir, path));
    } catch (e) {
      throw new Error(`${path}: ${e.message}`);
    }
  };
  const layout = where("hypr/tide/layout.lua", (text) => camel(luaTable(text, "M.defaults")));
  const [mfactMin, mfactMax] = where("hypr/tide/geometry.lua", (text) => {
    const m = /^M\.mfact_min,\s*M\.mfact_max\s*=\s*([\d.]+),\s*([\d.]+)\s*$/m.exec(text);
    if (!m) throw new Error('no "M.mfact_min, M.mfact_max = <min>, <max>" found');
    return [Number(m[1]), Number(m[2])];
  });
  const clocks = (await load(dir, "shell/lib/clocks.mjs")).DEFAULT_CLOCKS;
  const standing = (await load(dir, "shell/lib/workspacenames.mjs")).DEFAULT_STANDING;
  if (!Array.isArray(clocks)) throw new Error("shell/lib/clocks.mjs: no DEFAULT_CLOCKS list");
  if (!Array.isArray(standing)) throw new Error("shell/lib/workspacenames.mjs: no DEFAULT_STANDING list");
  return {
    ...layout,
    mfactMin,
    mfactMax,
    clocks: clocks.map(({ zone, label }) => ({ zone, label })),
    standing: [...standing],
  };
}

// Each setting in `v` by its dotted path ("modes.tile.mfact"); a list is
// one setting, compared whole.
export function flatten(v, prefix = "", out = {}) {
  for (const [k, x] of Object.entries(v)) {
    const path = prefix + k;
    if (x !== null && typeof x === "object" && !Array.isArray(x)) flatten(x, `${path}.`, out);
    else out[path] = x;
  }
  return out;
}

const show = (v) => JSON.stringify(v);

// v with each table's fields sorted, so tables compare in any field
// order while lists keep theirs.
const canon = (v) =>
  Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  : v;
const same = (a, b) => show(canon(a)) === show(canon(b));

// Where `name`'s defaults differ from tide for Linux's `tide`, as messages
// naming the setting and both values. `sources` is the port's defaults as
// [{ from, values }], `from` saying where they're kept; every setting in
// `values` must be one of tide's. `exceptions` allows a deliberate
// difference by path, as { ours, tide }: it passes while both sides
// hold those values, and fails once either moves, including to agree.
export function compare(name, sources, tide, exceptions = {}) {
  const theirs = flatten(tide);
  const problems = [];
  const seen = new Set();
  for (const { from, values } of sources) {
    for (const [path, value] of Object.entries(flatten(values))) {
      seen.add(path);
      const at = `${path}: ${name} ${show(value)} (${from})`;
      if (!Object.hasOwn(theirs, path)) {
        problems.push(`${at}, but ${TIDE} has no such default`);
        continue;
      }
      const want = theirs[path];
      const ex = exceptions[path];
      if (!ex) {
        if (!same(value, want)) problems.push(`${at}, ${TIDE} ${show(want)}`);
      } else if (same(value, want)) {
        problems.push(`${at} now matches ${TIDE}'s: take it out of the exceptions`);
      } else if (!same(value, ex.ours) || !same(want, ex.tide)) {
        problems.push(`${at}, ${TIDE} ${show(want)}, but the exception allows ${name} ${show(ex.ours)} and ${TIDE} ${show(ex.tide)}`);
      }
    }
  }
  for (const path of Object.keys(exceptions)) {
    if (!seen.has(path)) problems.push(`${path}: an exception for a setting ${name} doesn't compare`);
  }
  return problems;
}

// The comparison with the checkout at `dir`, printed: 0 if nothing
// differs, 1 otherwise, each difference on a line of its own.
export async function main(name, sources, dir, exceptions = {}, err = (s) => process.stderr.write(s)) {
  let problems;
  try {
    problems = compare(name, sources, await readTide(dir), exceptions);
  } catch (e) {
    err(`check-tide-defaults: ${e.message}\n`);
    return 1;
  }
  for (const p of problems) err(`check-tide-defaults: ${p}\n`);
  return problems.length > 0 ? 1 : 0;
}
