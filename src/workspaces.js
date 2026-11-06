// The workspace state machine (SPEC.md §6.1), free of any chrome.* API.
//
// One rule decides what's on screen: a window is shown if and only if its
// workspace is showing on some display and you haven't minimized it. Every
// operation here changes only the state and returns a new one; plan() then
// says which windows to restore and minimize to make the screen match.
//
// Workspaces have names. `standing` is the setting's list as last given, the
// first being home; `made` lists every workspace there is, in the order it
// was made, since an object's keys would put a name like "2" first.

export const DEFAULT_STANDING = ["in", "re", "oc", "me"];

// The longest a name may be, in characters, as on tide.
export const MAX_NAME = 32;

// What a name can't hold, as on tide: quotes, backslashes, `@` and control
// characters, so it needs no quoting in storage, the badge, pages or logs.
// tide keeps `@` for a monitor's part of a workspace (tide SPEC.md §6.5),
// and the standing list is shared with it.
const UNSAFE = /["'`\\@\p{Cc}]/u;

// A name as typed, made one: trimmed, and refused if it's empty, runs over
// more than one line, holds an unsafe character or is too long. Returns
// {name} or {error}, as tide's checkName does.
export function checkName(text) {
  const name = String(text ?? "").trim();
  if (name === "") return { error: "a workspace needs a name" };
  if (/[\n\r\u2028\u2029]/.test(name)) return { error: "a workspace's name is one line" };
  if (UNSAFE.test(name)) return { error: "a workspace's name can't have quotes, backslashes, @ or control characters" };
  if ([...name].length > MAX_NAME) return { error: `a workspace's name is at most ${MAX_NAME} characters` };
  // Workspaces are kept in an object, where this one key sets the
  // prototype instead of making an entry.
  if (sameName(name, "__proto__")) return { error: "a workspace can't be named __proto__" };
  return { name };
}

// Punctuation that clings to a word's end, as in `ABC-123:` or `Docs,`.
const TRAILING_PUNCT = /[.,:;!?|\u2026\-\u2013\u2014]+$/u;

// A window's short name, which a new window's name prompt starts with
// (§6.1): the first word of `title`, its tab's, with the punctuation
// clinging to its end dropped, passing over words left with no letter or
// digit, as tide's short name is without `namePatterns`. Characters a name
// can't hold go first, and a word too long is cut, so it's always a name,
// or "" when the title has no word to give.
export function shortName(title) {
  const text = [...String(title ?? "")].filter((c) => !UNSAFE.test(c)).join("");
  for (const word of text.split(/\s+/u)) {
    const w = word.replace(TRAILING_PUNCT, "");
    if (/[\p{L}\p{N}]/u.test(w)) return [...w].slice(0, MAX_NAME).join("");
  }
  return "";
}

// Whether two names are the same workspace's: case doesn't count.
export function sameName(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

export const DEFAULT_MODE_SETTINGS = {
  tile: { mfact: 0.55, nmaster: 1 },
  threecol: { mfact: 0.5, nmaster: 1 },
  twocol: { mfact: 0.72, nmaster: 2 },
  monocle: { mfact: 0.5, nmaster: 1 },
};

function clone(state) {
  return structuredClone(state);
}

// The name `name` means, ignoring case: a workspace's, in the case it was
// made with, else a standing one's not made yet. Null for a new name.
export function lookup(state, name) {
  return state.made.find((n) => sameName(n, name)) ?? state.standing.find((n) => sameName(n, name)) ?? null;
}

// The home workspace's name. Home always exists.
export function home(state) {
  return lookup(state, state.standing[0]);
}

function isStanding(state, name) {
  return state.standing.some((n) => sameName(n, name));
}

// The workspaces as the bar lists them: the standing ones, made or not, then
// the rest in the order they were made.
export function barOrder(state) {
  const standing = state.standing.map((n) => lookup(state, n));
  return [...standing, ...state.made.filter((n) => !standing.includes(n))];
}

// The `n`th workspace in bar order, from 1, or null past the last. 0 is
// the last, as Search+0 is.
export function nth(state, n) {
  const order = barOrder(state);
  return order[n === 0 ? order.length - 1 : n - 1] ?? null;
}

// Whether workspace `name` has a window you haven't minimized: what
// Search+Page Up and Page Down stop at.
export function hasWindows(state, name) {
  // Its own: a standing name such as "constructor", not made yet, would
  // otherwise find the object's inherited property.
  if (!Object.hasOwn(state.workspaces, name)) return false;
  return state.workspaces[name].windows.some((id) => Object.hasOwn(state.windows, id) && !state.windows[id].minimizedByYou);
}

// The workspace `by` places from `name` in bar order, or null past either
// end: the steps stop there. With `withWindows`, the nearest that way with a
// window (hasWindows), so the plain steps pass over empty ones; sending a
// window takes the very next, empty or not.
export function step(state, name, by, { withWindows = false } = {}) {
  const bar = barOrder(state);
  const i = bar.indexOf(name);
  if (i < 0) return null;
  for (let j = i + by; j >= 0 && j < bar.length; j += by) {
    if (!withWindows || hasWindows(state, bar[j])) return bar[j];
  }
  return null;
}

// The last workspace other than home you showed, other than `current`: from
// home the last one, from any other the one before it, so presses toggle
// between two, as tide's Super+End does. Null if there's none.
export function last(state, current) {
  // Home is never one: a changed standing list can make a workspace you
  // used home.
  const h = home(state);
  return state.recent.find((n) => n !== current && n !== h) ?? null;
}

// Make workspace `name` if there isn't one, in place, and return its name as
// stored. A new name must be valid.
function make(s, name) {
  const known = lookup(s, name);
  if (known !== null && Object.hasOwn(s.workspaces, known)) return known;
  let made = known;
  if (made === null) {
    const checked = checkName(name);
    if (checked.error) throw new Error(`${JSON.stringify(String(name))}: ${checked.error}`);
    made = checked.name;
  }
  // Each display's part gets its layout settings when they're first set
  // (layoutOf), from the settings then.
  s.workspaces[made] = { windows: [], parts: {}, focused: null };
  s.made.push(made);
  return made;
}

// Drop, in place, every workspace that's empty, not showing, and neither
// home nor standing. A window you minimized still counts, and so does one a
// restart hasn't brought back yet (§14.2).
function tidy(s) {
  make(s, s.standing[0]);
  if (s.current === null || !Object.hasOwn(s.workspaces, s.current)) s.current = lookup(s, s.standing[0]);
  const keep = new Set([
    s.current,
    ...Object.values(s.restoring ?? {}).map((info) => info.ws),
  ]);
  for (const n of s.made) {
    if (!keep.has(n) && !isStanding(s, n) && s.workspaces[n].windows.length === 0) delete s.workspaces[n];
  }
  s.made = s.made.filter((n) => Object.hasOwn(s.workspaces, n));
  s.recent = s.recent.filter((n) => Object.hasOwn(s.workspaces, n));
  return s;
}

// The state with its empty workspaces removed, for a caller that changed
// what keeps one: the windows waiting for a restart.
export function prune(state) {
  return tidy(clone(state));
}

// A fresh state for `displayIds`, with `standing` the setting's list: home
// is made now, and shows on every display.
export function create(displayIds, standing = DEFAULT_STANDING) {
  const s = { standing: [...standing], made: [], workspaces: {}, current: null, present: [], windows: {}, recent: [] };
  s.current = make(s, standing[0]);
  return setDisplays(s, displayIds);
}

// The standing list, given again on each step: a new home is made, and a
// workspace no longer standing goes once it's empty.
export function setStanding(state, standing) {
  if (JSON.stringify(state.standing) === JSON.stringify(standing)) return state;
  const s = clone(state);
  s.standing = [...standing];
  return tidy(s);
}

// The workspace showing on `displayId`, or null if there's no such display.
// One workspace shows on every display at once, each display with its own
// part of it: the workspace's windows that belong to that display (§6.1).
export function showing(state, displayId) {
  return state.present.includes(displayId) ? state.current : null;
}

// Displays came or went (§6.1, as tide's span.lua and tilemo's wm.lua). A
// window whose display went goes to the first display left, in the same
// workspace, remembering where it was; one whose display came back returns
// there, unless you've moved it since. A window whose display isn't known
// yet (null, from a state stored before workspaces spanned displays) is
// left for the next sync to place where it is.
export function setDisplays(state, displayIds) {
  const s = clone(state);
  s.present = [...displayIds];
  const first = displayIds[0];
  for (const w of Object.values(s.windows)) {
    if (w.from !== undefined && displayIds.includes(w.from)) {
      w.display = w.from;
      delete w.from;
    } else if (w.display != null && !displayIds.includes(w.display) && first !== undefined) {
      w.from ??= w.display;
      w.display = first;
    }
  }
  return tidy(s);
}

function detach(s, winId) {
  const w = s.windows[winId];
  if (!w) return;
  const ws = s.workspaces[w.ws];
  ws.windows = ws.windows.filter((id) => id !== winId);
  if (ws.focused === winId) ws.focused = null;
}

function attach(s, winId, name) {
  s.workspaces[name].windows.push(winId);
  s.windows[winId] = { ...(s.windows[winId] || { minimizedByYou: false, floating: false, display: null }), ws: name };
}

// A new window joins the end of the stack of the workspace showing, on the
// display it opened on. `to` names the workspace it joins instead, as one of
// home's apps always joins home (§6.1); like a send, it's hidden if that
// isn't showing.
export function addWindow(state, winId, displayId, { floating = false, to = null } = {}) {
  if (winId in state.windows) return state;
  const s = clone(state);
  attach(s, winId, to !== null ? make(s, to) : s.current);
  s.windows[winId].floating = floating;
  s.windows[winId].display = displayId ?? null;
  return s;
}

// A floating window belongs to its workspace, showing and hiding with it,
// but never takes a tile.
export function toggleFloating(state, winId) {
  if (!(winId in state.windows)) return state;
  const s = clone(state);
  s.windows[winId].floating = !s.windows[winId].floating;
  return s;
}

export function removeWindow(state, winId) {
  if (!(winId in state.windows)) return state;
  const s = clone(state);
  detach(s, winId);
  delete s.windows[winId];
  return tidy(s);
}

// Show workspace `name`, making it if it's new: every display shows its
// part of it, as tide's switch does.
export function show(state, name) {
  const s = clone(state);
  const n = make(s, name);
  s.current = n;
  if (n !== home(s)) s.recent = [n, ...s.recent.filter((r) => r !== n)];
  return tidy(s);
}

// Send a window to the end of workspace `name`'s stack, making it if it's
// new. It keeps its display. Whether it's then shown depends only on whether
// that's showing.
export function send(state, winId, name) {
  if (!(winId in state.windows) || state.windows[winId].ws === lookup(state, name)) return state;
  const s = clone(state);
  const n = make(s, name);
  // The focused window stays the one focused where it lands: moving it
  // need not bring another focus event.
  const wasFocused = s.workspaces[s.windows[winId].ws].focused === winId;
  detach(s, winId);
  attach(s, winId, n);
  if (wasFocused) s.workspaces[n].focused = winId;
  return tidy(s);
}

// Bring a window up: show its workspace if it isn't showing, clear its
// minimized-by-you flag, and focus it.
export function activate(state, winId) {
  if (!(winId in state.windows)) return state;
  let s = clone(state);
  const n = s.windows[winId].ws;
  if (s.current !== n) s = show(s, n);
  s.windows[winId].minimizedByYou = false;
  s.workspaces[n].focused = winId;
  return s;
}

export function userMinimized(state, winId) {
  if (!(winId in state.windows)) return state;
  const s = clone(state);
  s.windows[winId].minimizedByYou = true;
  return s;
}

// Any un-minimize tileco didn't cause. On a hidden workspace this is Activate.
export function userRestored(state, winId) {
  return activate(state, winId);
}

// You moved a window to another display (the native shortcut, or a drag): it
// belongs there from now on, in the same workspace, at the end of that
// display's part of the stack.
export function movedToDisplay(state, winId, displayId) {
  const w = state.windows[winId];
  if (!w || !state.present.includes(displayId) || (w.display === displayId && w.from === undefined)) return state;
  const s = clone(state);
  const ws = s.workspaces[w.ws];
  ws.windows = [...ws.windows.filter((id) => id !== winId), winId];
  s.windows[winId].display = displayId;
  delete s.windows[winId].from;
  return s;
}

export function focused(state, winId) {
  if (!(winId in state.windows)) return state;
  const s = clone(state);
  s.workspaces[s.windows[winId].ws].focused = winId;
  // A focus counter, so keys can pick the most recently focused of a kind
  // (§9.1); a repeat sync of the same focus doesn't count.
  s.focusSeq ??= 0;
  if (s.windows[winId].lastFocused !== s.focusSeq) s.windows[winId].lastFocused = ++s.focusSeq;
  return s;
}

// Whether `winId` should be on screen, by the one rule.
export function isShown(state, winId) {
  const w = state.windows[winId];
  return !!w && !w.minimizedByYou && w.ws === state.current && state.present.length > 0;
}

// What to do to make the screen match the rule, given which windows are
// minimized now. Restore first, in tile order, then minimize, so the screen
// never goes empty in between.
export function plan(state, minimizedNow) {
  const restore = [];
  const minimize = [];
  for (const n of state.made) {
    for (const id of state.workspaces[n].windows) {
      const shown = isShown(state, id);
      const isMin = minimizedNow.has(id);
      if (shown && isMin) restore.push(id);
      if (!shown && !isMin) minimize.push(id);
    }
  }
  return { restore, minimize };
}

function tileable(state, id) {
  const w = state.windows[id];
  return !w.minimizedByYou && !w.floating;
}

// The windows of the workspace showing that belong on `displayId`: its
// part there, in tile order. A window whose display isn't known yet is the
// first display's.
export function part(state, displayId) {
  const n = showing(state, displayId);
  if (n === null) return [];
  return state.workspaces[n].windows.filter((id) => (state.windows[id].display ?? state.present[0]) === displayId);
}

// The tiled windows of `displayId`'s part, in tile order.
export function tiled(state, displayId) {
  return part(state, displayId).filter((id) => tileable(state, id));
}

// Whether two windows are in the same part: the same display.
function samePart(state, a, b) {
  const da = state.windows[a].display ?? state.present[0];
  const db = state.windows[b].display ?? state.present[0];
  return da === db;
}

// Stack operations on the part holding `winId`: its workspace's windows on
// its display.

function withStack(state, winId, fn) {
  if (!(winId in state.windows) || !tileable(state, winId)) return state;
  const s = clone(state);
  const ws = s.workspaces[s.windows[winId].ws];
  // Reorder only the tiled windows, each into a slot a tiled window held,
  // so minimized and floating windows keep their places in the stack.
  const slots = [];
  ws.windows.forEach((id, i) => tileable(s, id) && samePart(s, id, winId) && slots.push(i));
  const list = slots.map((i) => ws.windows[i]);
  fn(list, list.indexOf(winId)).forEach((id, k) => (ws.windows[slots[k]] = id));
  return s;
}

// The window `step` places from `winId` in its part's stack, wrapping.
export function neighbor(state, winId, step) {
  const w = state.windows[winId];
  if (!w) return null;
  const list = state.workspaces[w.ws].windows.filter((id) => tileable(state, id) && samePart(state, id, winId));
  const i = list.indexOf(winId);
  if (i < 0 || list.length === 0) return null;
  return list[(i + step + list.length) % list.length];
}

// Move `winId` `step` places along its stack, wrapping.
export function moveInStack(state, winId, step) {
  return withStack(state, winId, (list, i) => {
    const j = (i + step + list.length) % list.length;
    [list[i], list[j]] = [list[j], list[i]];
    return list;
  });
}

// Swap `winId` with the master; the master swaps with the next window.
export function swapMaster(state, winId) {
  return withStack(state, winId, (list, i) => {
    const j = i === 0 ? 1 : 0;
    if (j >= list.length) return list;
    [list[i], list[j]] = [list[j], list[i]];
    return list;
  });
}

// Layout settings, per display's part of a workspace that exists, as tide's
// and tilemo's (§6.1): its layout (`null` means the display's default), its
// layout before monocle, and each mode's main share and count. A part not
// set yet starts from what the workspace kept before parts had their own,
// else from the settings; a display that goes keeps its parts for when it's
// back.

// The settings of workspace `name`'s part on `displayId`, read only.
export function layoutOf(state, name, displayId) {
  const w = state.workspaces[name];
  return w.parts?.[displayId] ?? { layout: w.layout ?? null, modes: w.modes ?? state.modesFrom ?? DEFAULT_MODE_SETTINGS };
}

// The same, made in place if it's new, to change.
function settingsOf(s, name, displayId) {
  const w = s.workspaces[name];
  w.parts ??= {};
  if (!Object.hasOwn(w.parts, displayId)) {
    w.parts[displayId] = structuredClone({ layout: w.layout ?? null, modes: w.modes ?? s.modesFrom ?? DEFAULT_MODE_SETTINGS });
    if (w.beforeMonocle !== undefined) w.parts[displayId].beforeMonocle = w.beforeMonocle;
  }
  return w.parts[displayId];
}

export function setLayout(state, name, displayId, mode) {
  const s = clone(state);
  settingsOf(s, name, displayId).layout = mode;
  return s;
}

// Toggle monocle on workspace `name`'s part on `displayId`, whose layout is
// `current` now (resolved from the display's default, `fallback`, when
// unset). Leaving monocle goes back to the layout before it, or to tile when
// that was a monocle default, as tide does.
export function toggleMonocle(state, name, displayId, current, fallback) {
  const s = clone(state);
  const p = settingsOf(s, name, displayId);
  if (current === "monocle") {
    p.layout = p.beforeMonocle ?? (fallback === "monocle" ? "tile" : null);
    delete p.beforeMonocle;
  } else {
    p.beforeMonocle = p.layout;
    p.layout = "monocle";
  }
  return s;
}

// Every part of every workspace takes `modes`, each mode's main share and
// count from the settings, dropping what the keys gave it (§5.2, tide's §6).
// `modesFrom` remembers them, so tileco applies a change once rather than on
// every step, and a part made later starts with them.
export function setModes(state, modes) {
  const s = clone(state);
  for (const n of s.made) {
    const w = s.workspaces[n];
    delete w.modes;
    for (const p of Object.values(w.parts ?? {})) p.modes = structuredClone(modes);
  }
  s.modesFrom = structuredClone(modes);
  return s;
}

export function adjust(state, name, displayId, mode, change) {
  const s = clone(state);
  const m = settingsOf(s, name, displayId).modes[mode];
  if ("mfact" in change) m.mfact = Math.min(0.95, Math.max(0.05, m.mfact + change.mfact));
  // Tile alone works with no main window, as in tide.
  if ("nmaster" in change) m.nmaster = Math.max(mode === "tile" ? 0 : 1, m.nmaster + change.nmaster);
  return s;
}

// A main share you set by dragging a window's edge (§5.3), within the
// bounds the keys keep to.
export function setMfact(state, name, displayId, mode, mfact) {
  const s = clone(state);
  settingsOf(s, name, displayId).modes[mode].mfact = Math.min(0.95, Math.max(0.05, mfact));
  return s;
}

// A lone window's width you set by dragging its edge (§5.3), between 10%
// and the whole area. It holds for this part whenever one window tiles there.
export function setSingleWidth(state, name, displayId, width) {
  const s = clone(state);
  settingsOf(s, name, displayId).singleWidth = Math.min(1.0, Math.max(0.1, width));
  return s;
}

// After a browser restart (§14.2), each window in `renames` (old ID to new)
// keeps its workspace, place in the stack, and everything else tileco knows.
export function renameWindows(state, renames) {
  const s = clone(state);
  for (const [from, to] of renames) {
    if (!(from in s.windows) || to in s.windows) continue;
    s.windows[to] = s.windows[from];
    delete s.windows[from];
    for (const w of Object.values(s.workspaces)) {
      w.windows = w.windows.map((id) => (id === from ? to : id));
      if (w.focused === from) w.focused = to;
    }
  }
  return s;
}

// A state stored before workspaces had names, or before they spanned
// displays, in today's shape; any other state as it is.
export function migrate(stored, standing = DEFAULT_STANDING) {
  if (!stored) return stored;
  const named = Array.isArray(stored.made) ? stored : nameNumbered(stored, standing);
  return Object.hasOwn(named, "current") ? named : span(named);
}

// A state from when each display showed its own workspace (§6.1). The first
// display's workspace shows on them all; each window belongs to the display
// that showed its workspace, and the rest to wherever the next sync finds
// them. `spanned` tells that sync the other displays' windows are still on
// screen from before, not restored by you.
function span(stored) {
  const s = clone(stored);
  s.spanned = true;
  const displays = s.displays ?? {};
  delete s.displays;
  s.present = Object.keys(displays);
  s.current = Object.values(displays)[0] ?? lookup(s, s.standing[0]);
  const where = {};
  for (const [id, n] of Object.entries(displays)) where[n] ??= id;
  for (const w of [...Object.values(s.windows ?? {}), ...Object.values(s.restoring ?? {})]) w.display = where[w.ws] ?? null;
  return tidy(s);
}

// A state stored before workspaces had names, numbered 1 to 9 with no `made`
// list, in the named shape, still showing a workspace per display. Workspace
// 1 becomes home, and each other one holding a window or showing keeps its
// number as its name, in number order; the empty hidden ones go.
function nameNumbered(stored, standing) {
  const s = clone(stored);
  const old = s.workspaces ?? {};
  s.displays ??= {};
  s.windows ??= {};
  const waiting = Object.values(s.restoring ?? {});
  const used = new Set([...Object.values(s.displays), ...[...Object.values(s.windows), ...waiting].map((w) => w.ws)].map(Number));
  s.standing = [...standing];
  s.made = [];
  s.workspaces = {};
  s.recent = [];
  const names = {};
  for (let n = 1; n <= 9; n++) {
    if (!(n in old) || (n !== 1 && !used.has(n))) continue;
    // A number a standing name holds already is that standing workspace.
    const name = n === 1 ? standing[0] : (lookup(s, String(n)) ?? String(n));
    names[n] = name;
    if (Object.hasOwn(s.workspaces, name)) s.workspaces[name].windows.push(...old[n].windows);
    else {
      s.workspaces[name] = old[n];
      s.made.push(name);
    }
  }
  const rename = (n) => names[Number(n)] ?? standing[0];
  s.displays = Object.fromEntries(Object.entries(s.displays).map(([id, n]) => [id, rename(n)]));
  for (const w of [...Object.values(s.windows), ...waiting]) w.ws = rename(w.ws);
  if (s.homeShownFor) s.homeShownFor = Object.fromEntries(Object.entries(s.homeShownFor).map(([id, n]) => [id, rename(n)]));
  return s;
}
