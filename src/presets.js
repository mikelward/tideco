// The keys checklist's Start from (SPEC.md §7.4): another tiling window
// manager's keys, from tide for Linux's presets (src/keymaps.mjs), as
// suggestions. Chrome lets no extension set its keys, so a preset only
// changes what the checklist suggests; you bind them by hand at
// chrome://extensions/shortcuts.

import { PRESETS, PRESET_NAMES } from "./keymaps.mjs";
import { intendedKey } from "./keys.js";

export { PRESETS, PRESET_NAMES };

// This Chromebook's choice, in storage.local beside the setup checklist's
// ticks: Chrome's keys are each machine's too.
export const PRESET_KEY = "keysPreset";

// tide for Linux's binding names, as conf names them, and the command here
// that does the same. A name with none here (the terminal, close, quit,
// fullscreen, focus left and right, resize mode) is left out.
export const COMMANDS = Object.freeze({
  launcher: "popup",
  focus_down: "focus-next",
  focus_up: "focus-prev",
  move_down: "move-next",
  move_up: "move-prev",
  swap_master: "swap-master",
  grow_master: "grow",
  shrink_master: "shrink",
  add_master: "master-add",
  remove_master: "master-remove",
  next_layout: "layout-next",
  previous_layout: "layout-prev",
  monocle: "monocle",
  float: "float",
  next_workspace: "workspace-next",
  previous_workspace: "workspace-prev",
  move_to_next_workspace: "send-next",
  move_to_previous_workspace: "send-prev",
  home: "workspace-home",
  last_other_workspace: "workspace-last",
  go_to_workspace: "workspace-go",
  move_to_workspace: "workspace-move",
  attention: "attention",
  keep_awake: "keep-awake",
  browser: "app-browser",
});

const MODIFIERS = { SUPER: "Search", CTRL: "Ctrl", CONTROL: "Ctrl", ALT: "Alt", SHIFT: "Shift" };
const ORDER = ["Search", "Ctrl", "Alt", "Shift"];

// The keys Chrome binds (§7.3), by Hyprland's name, written as the
// manifest writes them.
const BINDABLE = {
  comma: ",", period: ".", Space: "Space", space: "Space", Tab: "Tab",
  Left: "Left", Right: "Right", Up: "Up", Down: "Down",
  Insert: "Insert", Delete: "Delete", Home: "Home", End: "End",
  Page_Up: "PageUp", Prior: "PageUp", Page_Down: "PageDown", Next: "PageDown",
};
// The rest, named as a person would.
const NAMES = {
  Return: "Enter", backslash: "\\", slash: "/", equal: "=", minus: "-", grave: "`",
  semicolon: ";", apostrophe: "'", bracketleft: "[", bracketright: "]",
  BackSpace: "Backspace", Escape: "Esc",
};
// chromeOS takes Search with an arrow, with or without Shift, before Chrome
// sees it, and the Shortcuts app can't free it (§7.2).
const ARROWS = new Set(["Left", "Right", "Up", "Down"]);

// A Hyprland key string ("SUPER + SHIFT + Return") as {key, why}: key in
// Chrome's terms ("Search+Shift+Enter"), and why "" when Chrome can bind it,
// "chrome" when Chrome can't, "chromeos" when chromeOS keeps it.
export function chromeKey(hypr) {
  const parts = hypr.split("+").map((p) => p.trim()).filter(Boolean);
  const last = parts.pop() ?? "";
  const mods = parts.map((p) => MODIFIERS[p.toUpperCase()] ?? p);
  const known = mods.every((m) => ORDER.includes(m)) && mods.some((m) => m !== "Shift");
  let name = BINDABLE[last];
  if (!name && /^[A-Za-z0-9]$/.test(last)) name = last.toUpperCase();
  const key = [...ORDER.filter((m) => mods.includes(m)), name ?? NAMES[last] ?? last].join("+");
  if (!name || !known) return { key, why: "chrome" };
  if (mods.includes("Search") && ARROWS.has(name)) return { key, why: "chromeos" };
  return { key, why: "" };
}

// What the checklist suggests for each command in `manifest` (the
// manifest's `commands`) under `preset`, by name: {key, why, wanted}.
// why is "spec" for the spec's key; "preset" for the preset's; "chrome" or
// "chromeos" when the preset's key, `wanted`, can't be bound, so the spec's
// stays; or "taken" when the preset gives the spec's key to `by`, another
// command, so key is "" and the key is yours to choose. Of a preset's keys
// for one binding, the first Chrome can bind is used. Two commands are
// never suggested the same key: the preset's wins, the first it lists if
// it gives one key twice. `presets` is for tests.
export function suggestions(preset, manifest, presets = PRESETS) {
  const keys = presets[preset]?.keys ?? {};
  const out = {};
  const owner = new Map();
  const norm = (k) => k.toLowerCase().split("+").sort().join("+");
  for (const [binding, list] of Object.entries(keys)) {
    const name = COMMANDS[binding];
    if (!name || !(name in manifest) || out[name]) continue;
    const tried = list.map(chromeKey);
    const usable = tried.find((t) => t.why === "" && !owner.has(norm(t.key)));
    if (usable) {
      out[name] = { key: usable.key, why: "preset" };
      owner.set(norm(usable.key), name);
    } else {
      const first = tried.find((t) => t.why === "") ?? tried[0];
      out[name] = first.why === ""
        ? { key: "", why: "taken", by: owner.get(norm(first.key)), wanted: first.key }
        : { key: "", why: first.why, wanted: first.key };
    }
  }
  for (const [name, c] of Object.entries(manifest)) {
    const spec = intendedKey(c.description);
    const got = out[name];
    if (got?.why === "preset" || got?.why === "taken") continue;
    const by = spec && owner.get(norm(spec));
    if (by) out[name] = { key: "", why: "taken", by, wanted: spec };
    else if (got) got.key = spec;
    else out[name] = { key: spec, why: "spec" };
  }
  return out;
}

// The preset stored in `area`, "tide" when there's none or it isn't one.
export async function loadPreset(area) {
  const stored = (await area.get(PRESET_KEY))[PRESET_KEY];
  if (stored === undefined || PRESET_NAMES.includes(stored)) return stored ?? "tide";
  console.warn(`tide: ${PRESET_KEY} ${JSON.stringify(stored)} isn't a preset; using tide's keys`);
  return "tide";
}

export async function savePreset(area, name) {
  if (!PRESET_NAMES.includes(name)) throw new Error(`${name} isn't a preset`);
  if (name === "tide") await area.remove(PRESET_KEY);
  else await area.set({ [PRESET_KEY]: name });
}
