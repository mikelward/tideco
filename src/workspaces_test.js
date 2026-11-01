// Tests for workspaces.js: the cases SPEC.md §6.1 and its reviews named.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ws from "./workspaces.js";

// Two displays, "a" showing home ("in") and "b" showing "re", with windows
// 10 and 11 on home and 20 on "re".
function twoDisplays() {
  let s = ws.create(["a", "b"]);
  s = ws.addWindow(s, 10, "a");
  s = ws.addWindow(s, 11, "a");
  s = ws.addWindow(s, 20, "b");
  return s;
}

const none = new Set();
const shown = (s) => [10, 11, 20, 30].filter((id) => ws.isShown(s, id));

test("home is made at once, and each display starts on its own workspace", () => {
  const s = ws.create(["a", "b"]);
  assert.equal(ws.showing(s, "a"), "in");
  assert.equal(ws.showing(s, "b"), "re");
  assert.deepEqual(ws.create([]).made, ["in"], "home even with no display");
});

test("the first standing name is home, whatever it is", () => {
  const s = ws.create(["a"], ["mail", "code"]);
  assert.equal(ws.home(s), "mail");
  assert.equal(ws.showing(s, "a"), "mail");
  assert.deepEqual(ws.barOrder(s), ["mail", "code"]);
});

test("a new window joins the end of the stack on its display's workspace", () => {
  const s = twoDisplays();
  assert.deepEqual(s.workspaces.in.windows, [10, 11]);
  assert.deepEqual(s.workspaces.re.windows, [20]);
});

test("a new window joins home when nothing shows on its display", () => {
  const s = ws.addWindow(ws.create([]), 1, "gone");
  assert.equal(s.windows[1].ws, "in");
});

test("the bar lists the standing ones, made or not, then the rest as made", () => {
  let s = ws.create(["a"]);
  assert.deepEqual(ws.barOrder(s), ["in", "re", "oc", "me"]);
  assert.deepEqual(s.made, ["in"], "only home is made");
  s = ws.addWindow(s, 1, "a");
  s = ws.addWindow(s, 2, "a");
  s = ws.send(s, 1, "web");
  s = ws.send(s, 2, "chat");
  s = ws.show(s, "a", "me");
  assert.deepEqual(ws.barOrder(s), ["in", "re", "oc", "me", "web", "chat"]);
});

test("standing workspaces are made on first use and never removed", () => {
  let s = ws.addWindow(ws.create(["a"]), 1, "a");
  s = ws.show(s, "a", "oc");
  assert.ok("oc" in s.workspaces, "showing makes it");
  s = ws.send(s, 1, "me");
  assert.ok("me" in s.workspaces, "sending makes it");
  s = ws.show(s, "a", "in");
  s = ws.removeWindow(s, 1);
  assert.deepEqual(s.made, ["in", "oc", "me"], "left empty and hidden, they stay");
});

test("a made workspace goes once it's empty and hidden", () => {
  let s = ws.addWindow(ws.create(["a"]), 1, "a");
  s = ws.show(s, "a", "web");
  assert.ok("web" in s.workspaces, "showing a new name makes it, empty");
  s = ws.show(s, "a", "in");
  assert.equal("web" in s.workspaces, false, "left empty, it goes");
  s = ws.send(s, 1, "web");
  s = ws.show(s, "a", "web");
  s = ws.send(s, 1, "in");
  assert.ok("web" in s.workspaces, "empty but showing, it stays");
  s = ws.show(s, "a", "in");
  assert.equal("web" in s.workspaces, false);
  assert.deepEqual(ws.barOrder(s), ["in", "re", "oc", "me"]);
});

test("a made workspace holding only a window you minimized stays", () => {
  let s = ws.addWindow(ws.create(["a"]), 1, "a");
  s = ws.show(s, "a", "web");
  s = ws.addWindow(s, 2, "a");
  s = ws.userMinimized(s, 2);
  s = ws.show(s, "a", "in");
  assert.deepEqual(s.workspaces.web.windows, [2]);
  s = ws.removeWindow(s, 2);
  assert.equal("web" in s.workspaces, false, "closing it empties it");
});

test("names match ignoring case and keep the case they were made with", () => {
  let s = ws.addWindow(ws.create(["a"]), 1, "a");
  s = ws.send(s, 1, "Web");
  assert.equal(ws.lookup(s, "WEB"), "Web");
  assert.equal(ws.lookup(s, "RE"), "re", "a standing one not made yet");
  assert.equal(ws.lookup(s, "new"), null);
  s = ws.show(s, "a", "web");
  assert.equal(ws.showing(s, "a"), "Web");
  s = ws.send(s, 1, "RE");
  assert.equal(s.windows[1].ws, "re", "RE is the standing re");
  assert.deepEqual(s.made, ["in", "Web", "re"]);
});

test("the Nth in bar order, and the steps stop at either end", () => {
  let s = ws.addWindow(ws.create(["a"]), 1, "a");
  s = ws.send(s, 1, "web");
  assert.equal(ws.nth(s, 1), "in");
  assert.equal(ws.nth(s, 4), "me");
  assert.equal(ws.nth(s, 5), "web");
  assert.equal(ws.nth(s, 6), null, "past the last is none");
  assert.equal(ws.step(s, "in", 1), "re");
  assert.equal(ws.step(s, "in", -1), null, "no wrap before the first");
  assert.equal(ws.step(s, "me", 1), "web");
  assert.equal(ws.step(s, "web", 1), null, "no wrap after the last");
});

test("the last workspace other than home toggles between the last two", () => {
  let s = ws.create(["a"]);
  assert.equal(ws.last(s, "in"), null, "none shown yet");
  s = ws.show(s, "a", "oc");
  s = ws.show(s, "a", "re");
  s = ws.show(s, "a", "in");
  assert.equal(ws.last(s, "in"), "re", "from home, the last one");
  assert.equal(ws.last(s, "re"), "oc", "from it, the one before");
  s = ws.show(s, "a", "web");
  s = ws.show(s, "a", "in");
  assert.equal(ws.last(s, "in"), "re", "one that's gone is skipped");
});

test("a name is one trimmed line of at most 32 characters, with nothing to quote", () => {
  assert.deepEqual(ws.checkName("  web "), { name: "web" });
  assert.deepEqual(ws.checkName("x".repeat(32)), { name: "x".repeat(32) });
  assert.deepEqual(ws.checkName("ñ".repeat(32)), { name: "ñ".repeat(32) }, "characters, not bytes");
  for (const bad of ["", "   ", "x".repeat(33), 'a"b', "a'b", "a`b", "a\\b", "a\nb", "a\tb", "a\u0007b", "a b"]) {
    assert.ok(ws.checkName(bad).error, JSON.stringify(bad));
  }
  assert.throws(() => ws.show(ws.create(["a"]), "a", 'a"b'), /quotes/);
});

test("switching hides the old workspace's windows and shows the new one's", () => {
  let s = twoDisplays();
  s = ws.addWindow(ws.show(s, "a", "oc"), 30, "a");
  s = ws.show(s, "a", "in");
  assert.deepEqual(shown(s), [10, 11, 20]);
  assert.deepEqual(ws.plan(s, new Set([10, 11])), { restore: [10, 11], minimize: [30] });
});

test("showing a workspace that's on the other display swaps them", () => {
  const s = ws.show(twoDisplays(), "a", "re");
  assert.equal(ws.showing(s, "a"), "re");
  assert.equal(ws.showing(s, "b"), "in");
  assert.deepEqual(shown(s), [10, 11, 20]);
});

test("a window you minimized stays minimized across a switch", () => {
  let s = ws.userMinimized(twoDisplays(), 11);
  s = ws.show(s, "a", "oc");
  s = ws.show(s, "a", "in");
  assert.deepEqual(ws.plan(s, new Set([10, 11])), { restore: [10], minimize: [] });
});

test("minimize then restore on the same workspace keeps the window up", () => {
  let s = ws.userMinimized(twoDisplays(), 11);
  s = ws.userRestored(s, 11, "a");
  assert.equal(ws.isShown(s, 11), true);
  assert.deepEqual(ws.plan(s, none), { restore: [], minimize: [] });
});

test("restoring a window on a hidden workspace brings the workspace", () => {
  let s = ws.show(twoDisplays(), "a", "oc");
  s = ws.userRestored(s, 10, "a");
  assert.equal(ws.showing(s, "a"), "in");
  assert.equal(s.workspaces.in.focused, 10);
});

test("sending to a workspace showing on another display shows it there", () => {
  const s = ws.send(twoDisplays(), 10, "re");
  assert.deepEqual(s.workspaces.re.windows, [20, 10]);
  assert.equal(ws.isShown(s, 10), true);
  assert.deepEqual(ws.plan(s, none), { restore: [], minimize: [] });
});

test("a focused window stays focused on the workspace it moves to", () => {
  let s = ws.focused(twoDisplays(), 20);
  s = ws.focused(s, 10);
  s = ws.movedToDisplay(s, 10, "b");
  assert.equal(s.workspaces.re.focused, 10);
  assert.equal(s.workspaces.in.focused, null);
  s = ws.send(s, 11, "re");
  assert.equal(s.workspaces.re.focused, 10, "an unfocused window doesn't take focus");
});

test("sending to a hidden workspace hides the window", () => {
  const s = ws.send(twoDisplays(), 10, "web");
  assert.equal(ws.isShown(s, 10), false);
  assert.deepEqual(ws.plan(s, none), { restore: [], minimize: [10] });
});

test("activating a window on a hidden workspace shows that workspace on the focused display", () => {
  let s = ws.send(twoDisplays(), 10, "web");
  s = ws.activate(s, 10, "b");
  assert.equal(ws.showing(s, "b"), "web");
  assert.equal(ws.showing(s, "a"), "in");
  assert.equal(ws.isShown(s, 10), true);
});

test("activating a window on a showing workspace changes no display", () => {
  const before = twoDisplays();
  const s = ws.activate(before, 20, "a");
  assert.deepEqual(s.displays, before.displays);
  assert.equal(s.workspaces.re.focused, 20);
});

test("moving a window to another display moves it to the workspace there", () => {
  const s = ws.movedToDisplay(twoDisplays(), 11, "b");
  assert.deepEqual(s.workspaces.in.windows, [10]);
  assert.deepEqual(s.workspaces.re.windows, [20, 11]);
  assert.equal(ws.isShown(s, 11), true);
});

test("a removed display's workspace hides, and a new one takes the first not showing", () => {
  let s = ws.setDisplays(twoDisplays(), ["a"]);
  assert.equal(ws.isShown(s, 20), false);
  s = ws.setDisplays(s, ["a", "c"]);
  assert.equal(ws.showing(s, "c"), "re");
});

test("a display beyond the standing ones shows a new workspace", () => {
  const s = ws.create(["a", "b", "c"], ["in", "re"]);
  assert.deepEqual(Object.values(s.displays), ["in", "re", "1"]);
  assert.deepEqual(ws.barOrder(s), ["in", "re", "1"]);
});

test("a workspace no longer standing goes once it's empty", () => {
  let s = ws.show(ws.create(["a"]), "a", "oc");
  s = ws.show(s, "a", "in");
  s = ws.setStanding(s, ["in", "re"]);
  assert.equal("oc" in s.workspaces, false);
  s = ws.setStanding(s, ["home", "re"]);
  assert.equal(ws.home(s), "home");
  assert.ok("home" in s.workspaces, "a new home is made at once");
  assert.deepEqual(ws.barOrder(s), ["home", "re", "in"], "the old home stays while it shows");
});

test("operations don't change the state they were given", () => {
  const s = twoDisplays();
  const copy = structuredClone(s);
  ws.show(s, "a", "oc");
  ws.send(s, 10, "me");
  ws.userMinimized(s, 11);
  ws.removeWindow(s, 20);
  assert.deepEqual(s, copy);
});

test("removing a window drops it from its workspace", () => {
  const s = ws.removeWindow(twoDisplays(), 10);
  assert.deepEqual(s.workspaces.in.windows, [11]);
  assert.equal(10 in s.windows, false);
});

test("stack moves wrap and swapMaster swaps with the master", () => {
  let s = ws.addWindow(twoDisplays(), 12, "a");
  assert.equal(ws.neighbor(s, 12, 1), 10);
  assert.equal(ws.neighbor(s, 10, -1), 12);
  s = ws.swapMaster(s, 12);
  assert.deepEqual(s.workspaces.in.windows, [12, 11, 10]);
  s = ws.swapMaster(s, 12);
  assert.deepEqual(s.workspaces.in.windows, [11, 12, 10]);
  s = ws.moveInStack(s, 11, -1);
  assert.deepEqual(s.workspaces.in.windows, [10, 12, 11]);
});

test("tiled lists the showing workspace's windows you haven't minimized", () => {
  const s = ws.userMinimized(twoDisplays(), 10);
  assert.deepEqual(ws.tiled(s, "a"), [11]);
});

test("a floating window shows and hides with its workspace but takes no tile", () => {
  let s = ws.toggleFloating(twoDisplays(), 11);
  assert.deepEqual(ws.tiled(s, "a"), [10]);
  assert.equal(ws.neighbor(s, 10, 1), 10, "the stack skips it");
  s = ws.show(s, "a", "oc");
  assert.equal(ws.isShown(s, 11), false);
  s = ws.toggleFloating(ws.show(s, "a", "in"), 11);
  assert.deepEqual(ws.tiled(s, "a"), [10, 11]);
});

test("stack moves on a window that isn't tiled change nothing", () => {
  const s = ws.toggleFloating(twoDisplays(), 11);
  assert.deepEqual(ws.moveInStack(s, 11, 1).workspaces.in.windows, [10, 11]);
  assert.deepEqual(ws.swapMaster(s, 11).workspaces.in.windows, [10, 11]);
});

test("monocle toggles back to the layout before it", () => {
  let s = ws.setLayout(ws.create(["a"]), "in", "twocol");
  s = ws.toggleMonocle(s, "in", "twocol");
  assert.equal(s.workspaces.in.layout, "monocle");
  s = ws.toggleMonocle(s, "in", "monocle");
  assert.equal(s.workspaces.in.layout, "twocol");
  s = ws.toggleMonocle(ws.create(["a"]), "in", "tile");
  s = ws.toggleMonocle(s, "in", "monocle");
  assert.equal(s.workspaces.in.layout, null, "back to the display's default");
});

test("stack moves leave minimized and floating windows in their places", () => {
  let s = ws.addWindow(twoDisplays(), 12, "a");
  s = ws.userMinimized(s, 10);
  s = ws.swapMaster(s, 12);
  assert.deepEqual(s.workspaces.in.windows, [10, 12, 11], "10 keeps the master slot");
  s = ws.userRestored(s, 10, "a");
  assert.deepEqual(ws.tiled(s, "a"), [10, 12, 11]);
  s = ws.toggleFloating(s, 12);
  s = ws.moveInStack(s, 11, -1);
  assert.deepEqual(s.workspaces.in.windows, [11, 12, 10]);
});

test("mfact and the master count stay in range", () => {
  let s = ws.create(["a", "b"]);
  for (let i = 0; i < 40; i++) s = ws.adjust(s, "in", "tile", { mfact: 0.025, nmaster: -1 });
  assert.equal(s.workspaces.in.modes.tile.mfact, 0.95);
  assert.equal(s.workspaces.in.modes.tile.nmaster, 0, "tile can have no main window");
  for (let i = 0; i < 5; i++) s = ws.adjust(s, "in", "threecol", { nmaster: -1 });
  assert.equal(s.workspaces.in.modes.threecol.nmaster, 1, "the columns keep one");
  assert.equal(s.workspaces.re.modes.tile.mfact, 0.55, "other workspaces untouched");
});

test("a workspace made after the layout settings changed starts with them", () => {
  const modes = { ...ws.DEFAULT_MODE_SETTINGS, tile: { mfact: 0.6, nmaster: 2 } };
  const s = ws.show(ws.setModes(ws.create(["a"]), modes), "a", "web");
  assert.deepEqual(s.workspaces.web.modes, modes);
});

test("a renamed window keeps its workspace, place and settings", () => {
  let s = ws.create(["hd"]);
  s = ws.addWindow(s, 1, "hd");
  s = ws.addWindow(s, 2, "hd");
  s = ws.send(s, 2, "oc");
  s = ws.toggleFloating(s, 1);
  s = ws.focused(s, 1);
  const r = ws.renameWindows(s, new Map([[1, 11], [2, 12]]));
  assert.deepEqual(r.workspaces.in.windows, [11]);
  assert.deepEqual(r.workspaces.oc.windows, [12]);
  assert.equal(r.workspaces.in.focused, 11);
  assert.equal(r.windows[11].floating, true);
  assert.equal(1 in r.windows, false);
});

test("a workspace a restart's waiting window names stays until the wait ends", () => {
  let s = ws.addWindow(ws.create(["a"]), 1, "a");
  s = ws.send(s, 1, "web");
  s.restoring = { 1: s.windows[1] };
  s = ws.removeWindow(s, 1);
  assert.ok("web" in s.workspaces);
  delete s.restoring;
  assert.equal("web" in ws.prune(s).workspaces, false);
});

// The shape stored before names: nine workspaces keyed 1 to 9.
function numbered() {
  const empty = () => ({ windows: [], layout: null, modes: structuredClone(ws.DEFAULT_MODE_SETTINGS), focused: null });
  const workspaces = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [n, empty()]));
  workspaces[1].windows = [10];
  workspaces[1].layout = "monocle";
  workspaces[5].windows = [50, 51];
  workspaces[5].focused = 51;
  workspaces[2].windows = [20];
  return {
    displays: { a: 1, b: 7 },
    workspaces,
    windows: {
      10: { ws: 1, minimizedByYou: false, floating: false },
      20: { ws: 2, minimizedByYou: true, floating: false },
      50: { ws: 5, minimizedByYou: false, floating: false },
      51: { ws: 5, minimizedByYou: false, floating: true },
    },
    restoring: { 90: { ws: 9, urls: [] } },
    homeShownFor: { b: 7 },
    marks: [50],
  };
}

test("a numbered state takes names: 1 is home, the rest in use keep their numbers", () => {
  const s = ws.migrate(numbered());
  assert.equal(ws.home(s), "in");
  assert.deepEqual(s.made, ["in", "2", "5", "7", "9"], "the empty hidden ones go");
  assert.deepEqual(ws.barOrder(s), ["in", "re", "oc", "me", "2", "5", "7", "9"]);
  assert.deepEqual(s.displays, { a: "in", b: "7" });
  assert.deepEqual(s.workspaces.in.windows, [10]);
  assert.equal(s.workspaces.in.layout, "monocle", "a workspace keeps its layout");
  assert.deepEqual(s.workspaces["5"].windows, [50, 51]);
  assert.equal(s.workspaces["5"].focused, 51);
  assert.deepEqual([10, 20, 50, 51].map((id) => s.windows[id].ws), ["in", "2", "5", "5"]);
  assert.equal(s.windows[20].minimizedByYou, true, "the rest of a window is kept");
  assert.equal(s.restoring[90].ws, "9", "a window a restart waits for too");
  assert.deepEqual(s.homeShownFor, { b: "7" });
  assert.deepEqual(s.marks, [50]);
});

test("a named state, or none, isn't migrated", () => {
  const s = ws.create(["a"]);
  assert.equal(ws.migrate(s), s);
  assert.equal(ws.migrate(null), null);
});

test("a migrated state works by name", () => {
  let s = ws.migrate(numbered());
  s = ws.show(s, "a", "5");
  assert.deepEqual(ws.plan(s, new Set([20, 50, 51])), { restore: [50, 51], minimize: [10] });
  s = ws.removeWindow(ws.removeWindow(ws.show(s, "a", "in"), 50), 51);
  assert.equal("5" in s.workspaces, false, "an emptied numbered one goes like any made one");
});

test("names like constructor and toString are workspaces like any other", () => {
  let s = ws.create(["a"], ["constructor", "toString"]);
  assert.equal(ws.showing(s, "a"), "constructor");
  s = ws.addWindow(s, 10, "a");
  assert.deepEqual(s.workspaces.constructor.windows, [10]);
  s = ws.send(s, 10, "toString");
  assert.deepEqual(s.workspaces.toString.windows, [10]);
  assert.deepEqual(ws.barOrder(s), ["constructor", "toString"]);
});

test("__proto__ can't name a workspace, since it can't be stored as one", () => {
  assert.ok(ws.checkName("__proto__").error);
  assert.ok(ws.checkName("__Proto__").error, "ignoring case, as names are");
  assert.throws(() => ws.show(ws.create(["a"]), "a", "__proto__"));
});

test("Search+End never goes to home, even one the standing list just made home", () => {
  let s = ws.create(["a"]);
  s = ws.show(s, "a", "oc");
  s = ws.show(s, "a", "re");
  s = ws.show(s, "a", "in");
  s = ws.setStanding(s, ["re", "in", "oc", "me"]);
  assert.equal(ws.home(s), "re");
  assert.equal(ws.last(s, "in"), "oc");
});

test("two displays never share a workspace when migration merges names", () => {
  // A standing "2" as home takes old 1 and 2, which two displays showed.
  const stored = numbered();
  stored.displays = { a: 1, b: 2 };
  const s = ws.migrate(stored, ["2", "re"]);
  assert.equal(ws.home(s), "2");
  assert.deepEqual(s.workspaces["2"].windows, [10, 20], "the merged workspace keeps both stacks");
  assert.equal(s.displays.a, "2");
  assert.notEqual(s.displays.b, "2");
  assert.equal(s.displays.b, "re", "the other takes the next free one in bar order");
});
