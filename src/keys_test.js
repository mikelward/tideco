import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checklist, intendedKey } from "./keys.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url))).commands;

test("the intended key is the one in a description's closing parentheses", () => {
  assert.equal(intendedKey("Focus the next window in the stack (Search+J)"), "Search+J");
  assert.equal(intendedKey("Grow the master (Search+Shift+.)"), "Search+Shift+.");
  assert.equal(intendedKey("No key here"), "");
});

test("each command is bound, bound to another key, or still to bind", () => {
  const rows = checklist(manifest, [
    { name: "focus-next", shortcut: "Search+J" },
    { name: "focus-prev", shortcut: "Search+Shift+K" },
    { name: "float", shortcut: "" },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by["focus-next"].state, "bound");
  assert.equal(by["focus-prev"].state, "other");
  assert.equal(by["focus-prev"].bound, "Search+Shift+K");
  assert.equal(by["float"].state, "unbound");
  assert.equal(by["workspace-1"].state, "unbound", "a command Chrome didn't list is unbound");
  assert.equal(by["float"].title, "Toggle floating");
  assert.equal(by["float"].intended, "Search+Shift+F");
  assert.equal(rows.length, Object.keys(manifest).length, "every command, once");
});

test("keys match whatever order Chrome lists the modifiers in", () => {
  const [row] = checklist({ x: { description: "X (Search+Shift+M)" } }, [{ name: "x", shortcut: "Shift+Search+M" }]);
  assert.equal(row.state, "bound");
});

test("a key is bound under the name Chrome gives it", () => {
  // commands.getAll() names a key as Chrome's menus do, not as the manifest
  // writes it: these are Chromium 153's, on Linux.
  const state = (intended, shortcut) => checklist({ x: { description: `X (${intended})` } }, [{ name: "x", shortcut }])[0].state;
  assert.equal(state("Search+PageUp", "Search+Page Up"), "bound");
  assert.equal(state("Search+Shift+PageDown", "Search+Shift+Page Down"), "bound");
  assert.equal(state("Search+.", "Search+Period"), "bound");
  assert.equal(state("Search+,", "Search+Comma"), "bound");
  assert.equal(state("Ctrl+Alt+Left", "Ctrl+Alt+Left Arrow"), "bound");
  assert.equal(state("Ctrl+Alt+Down", "Ctrl+Alt+Down Arrow"), "bound");
  assert.equal(state("Alt+Insert", "Alt+Ins"), "bound");
  assert.equal(state("Alt+Delete", "Alt+Del"), "bound");
  assert.equal(state("Search+Home", "Search+Home"), "bound");
  // Another key is still another key.
  assert.equal(state("Search+PageUp", "Search+Page Down"), "other");
  assert.equal(state("Search+.", "Search+Comma"), "other");
  assert.equal(state("Ctrl+Alt+Left", "Ctrl+Alt+Up Arrow"), "other");
});

test("the manifest's Page Up, Page Down, period and comma keys show as bound", () => {
  const names = { PageUp: "Page Up", PageDown: "Page Down", ".": "Period", ",": "Comma" };
  const asChrome = (key) => key.split("+").map((p) => names[p] ?? p).join("+");
  const uses = Object.entries(manifest).filter(([, c]) => intendedKey(c.description).split("+").some((p) => p in names));
  assert.deepEqual(uses.map(([name]) => name).sort(), ["layout-next", "layout-prev", "send-next", "send-prev", "workspace-next", "workspace-prev"]);
  const rows = checklist(manifest, uses.map(([name, c]) => ({ name, shortcut: asChrome(intendedKey(c.description)) })));
  for (const [name] of uses) assert.equal(rows.find((r) => r.name === name).state, "bound", name);
});
