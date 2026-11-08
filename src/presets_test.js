import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checklist } from "./keys.js";
import { chromeKey, COMMANDS, loadPreset, PRESET_KEY, PRESET_NAMES, savePreset, suggestions } from "./presets.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url))).commands;

function fakeArea(stored = {}) {
  return {
    stored,
    async get(key) { return key in stored ? { [key]: stored[key] } : {}; },
    async set(items) { Object.assign(stored, items); },
    async remove(key) { delete stored[key]; },
  };
}

test("Super is Search, and keys are written as the manifest writes them", () => {
  assert.deepEqual(chromeKey("SUPER + P"), { key: "Search+P", why: "" });
  assert.deepEqual(chromeKey("SUPER + SHIFT + comma"), { key: "Search+Shift+,", why: "" });
  assert.deepEqual(chromeKey("SUPER + Page_Down"), { key: "Search+PageDown", why: "" });
  assert.deepEqual(chromeKey("SUPER + ALT + Q"), { key: "Search+Alt+Q", why: "" });
  assert.deepEqual(chromeKey("SUPER + space"), { key: "Search+Space", why: "" });
});

test("keys Chrome can't bind, or chromeOS keeps, are marked", () => {
  assert.deepEqual(chromeKey("SUPER + SHIFT + Return"), { key: "Search+Shift+Enter", why: "chrome" });
  for (const k of ["backslash", "equal", "grave", "semicolon", "bracketleft"]) {
    assert.equal(chromeKey(`SUPER + ${k}`).why, "chrome", k);
  }
  assert.equal(chromeKey("SHIFT + J").why, "chrome", "Shift alone isn't a modifier Chrome takes");
  assert.deepEqual(chromeKey("SUPER + Left"), { key: "Search+Left", why: "chromeos" });
  assert.equal(chromeKey("SUPER + SHIFT + Down").why, "chromeos");
});

test("tide's preset suggests the spec's keys", () => {
  const rows = checklist(manifest, [], suggestions("tide", manifest));
  assert.deepEqual(rows, checklist(manifest, []));
  assert.equal(rows.find((r) => r.name === "popup").intended, "Search+Space");
});

test("every command a binding maps to is in the manifest", () => {
  for (const [binding, name] of Object.entries(COMMANDS)) assert.ok(name in manifest, `${binding}: ${name}`);
});

test("a preset suggests its keys for the commands that do the same", () => {
  const s = suggestions("dwm", manifest);
  assert.deepEqual(s.popup, { key: "Search+P", why: "preset" });
  assert.deepEqual(s.monocle, { key: "Search+M", why: "preset" });
  assert.deepEqual(s.float, { key: "Search+Shift+Space", why: "preset" });
  assert.deepEqual(s["workspace-1"], { key: "Search+1", why: "spec" }, "what it doesn't name keeps the spec's key");
});

test("bindings with no command here are dropped", () => {
  // dwm's terminal (Super+Shift+Return), close (Super+Shift+C), quit,
  // Super+Tab and focus and move left and right (Super+, and .) do
  // nothing here, so no command takes their keys.
  const s = suggestions("dwm", manifest);
  const fromPreset = Object.keys(s).filter((n) => s[n].why === "preset").sort();
  assert.deepEqual(fromPreset, ["float", "focus-next", "focus-prev", "grow", "layout-next", "master-add", "master-remove", "monocle", "popup", "shrink"]);
  assert.equal(s["layout-prev"].key, "Search+,", "dwm's Super+, takes nothing from it");
  assert.equal(s["app-chat"].key, "Search+Shift+C", "nor its Super+Shift+C");
  assert.equal(Object.keys(s).length, Object.keys(manifest).length, "a suggestion for each command, nothing else");
});

test("a key Chrome can't bind keeps the spec's, saying why", () => {
  assert.deepEqual(suggestions("dwm", manifest)["swap-master"], { key: "Search+Shift+M", why: "chrome", wanted: "Search+Enter" });
  assert.deepEqual(suggestions("bspwm", manifest)["workspace-next"], { key: "Search+PageDown", why: "chrome", wanted: "Search+]" });
  const arrows = { only: { keys: { focus_down: ["SUPER + Down"] } } };
  assert.deepEqual(suggestions("only", manifest, arrows)["focus-next"], { key: "Search+J", why: "chromeos", wanted: "Search+Down" });
});

test("of a binding's keys, the first Chrome can bind is suggested", () => {
  const p = { p: { keys: { focus_down: ["SUPER + Down", "SUPER + SHIFT + Return", "SUPER + U"] } } };
  assert.deepEqual(suggestions("p", manifest, p)["focus-next"], { key: "Search+U", why: "preset" });
});

test("a key the preset gives another command leaves that one yours to choose", () => {
  const s = suggestions("i3", manifest);
  assert.deepEqual(s.popup, { key: "Search+D", why: "preset" });
  assert.deepEqual(s["master-remove"], { key: "", why: "taken", by: "popup", wanted: "Search+D" });
  // A kept key goes too, if the preset gives it away.
  const p = { p: { keys: { swap_master: ["SUPER + Return"], monocle: ["SUPER + SHIFT + M"] } } };
  assert.deepEqual(suggestions("p", manifest, p)["swap-master"], { key: "", why: "taken", by: "monocle", wanted: "Search+Shift+M" });
  // A key the preset gives twice goes to the first.
  const twice = { p: { keys: { monocle: ["SUPER + Q"], float: ["SUPER + Q"] } } };
  assert.deepEqual(suggestions("p", manifest, twice).float, { key: "", why: "taken", by: "monocle", wanted: "Search+Q" });
});

test("no two commands are suggested the same key, in any preset", () => {
  for (const preset of PRESET_NAMES) {
    const keys = Object.values(suggestions(preset, manifest)).map((s) => s.key.toLowerCase()).filter(Boolean);
    assert.equal(new Set(keys).size, keys.length, preset);
  }
});

test("under a preset, the checklist suggests its keys and counts them bound", () => {
  const bound = [
    { name: "popup", shortcut: "Search+Space" },
    { name: "monocle", shortcut: "Search+M" },
    { name: "app-meet", shortcut: "Search+Shift+Y" },
  ];
  const by = Object.fromEntries(checklist(manifest, bound, suggestions("dwm", manifest)).map((r) => [r.name, r]));
  assert.equal(by.popup.intended, "Search+P");
  assert.equal(by.popup.state, "other", "still on the spec's key");
  assert.equal(by.monocle.state, "bound");
  assert.equal(by["app-meet"].intended, "");
  assert.equal(by["app-meet"].state, "other", "on a key of your choosing");
  assert.equal(by["layout-prev"].state, "unbound");
  assert.equal(by["swap-master"].suggestion.why, "chrome");
});

test("the choice is kept per Chromebook, and tide's is the default", async () => {
  const area = fakeArea();
  assert.equal(await loadPreset(area), "tide");
  await savePreset(area, "sway");
  assert.equal(area.stored[PRESET_KEY], "sway");
  assert.equal(await loadPreset(area), "sway");
  await savePreset(area, "tide");
  assert.deepEqual(area.stored, {});
  await assert.rejects(savePreset(area, "awesome"), /isn't a preset/);
  assert.equal(await loadPreset(fakeArea({ [PRESET_KEY]: "awesome" })), "tide", "an unknown one is ignored");
});
