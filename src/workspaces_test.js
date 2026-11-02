// Tests for workspaces.js: the cases SPEC.md §6.1 and its reviews named.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ws from "./workspaces.js";

// Two displays, "a" and "b", both showing home ("in"): windows 10 and 11
// in a's part and 20 in b's.
function twoDisplays() {
  let s = ws.create(["a", "b"]);
  s = ws.addWindow(s, 10, "a");
  s = ws.addWindow(s, 11, "a");
  s = ws.addWindow(s, 20, "b");
  return s;
}

const none = new Set();
const shown = (s) => [10, 11, 20, 30].filter((id) => ws.isShown(s, id));

test("home is made at once, and shows on every display", () => {
  const s = ws.create(["a", "b"]);
  assert.equal(ws.showing(s, "a"), "in");
  assert.equal(ws.showing(s, "b"), "in");
  assert.equal(ws.showing(s, "gone"), null, "nothing on a display that isn't there");
  assert.deepEqual(s.made, ["in"], "no other workspace is made for a second display");
  assert.deepEqual(ws.create([]).made, ["in"], "home even with no display");
});

test("the first standing name is home, whatever it is", () => {
  const s = ws.create(["a"], ["mail", "code"]);
  assert.equal(ws.home(s), "mail");
  assert.equal(ws.showing(s, "a"), "mail");
  assert.deepEqual(ws.barOrder(s), ["mail", "code"]);
});

test("a new window joins the end of the stack of the workspace showing, in its display's part", () => {
  const s = twoDisplays();
  assert.deepEqual(s.workspaces.in.windows, [10, 11, 20]);
  assert.deepEqual(ws.part(s, "a"), [10, 11]);
  assert.deepEqual(ws.part(s, "b"), [20]);
  assert.equal(s.windows[20].display, "b");
});

test("a new window joins home when nothing shows on its display", () => {
  const s = ws.addWindow(ws.create([]), 1, "gone");
  assert.equal(s.windows[1].ws, "in");
});

test("a new window can join a named workspace wherever it opened, hidden there", () => {
  let s = twoDisplays();
  s = ws.show(s, "oc");
  s = ws.addWindow(s, 31, "b", { to: "in" });
  assert.equal(s.windows[31].ws, "in", "home, not the oc showing");
  assert.equal(s.windows[31].display, "b", "on the display it opened on");
  assert.equal(ws.isShown(s, 31), false, "hidden, as a send to a hidden workspace is");
  assert.deepEqual(ws.plan(s, none).minimize.includes(31), true);
  s = ws.show(s, "in");
  assert.deepEqual(ws.part(s, "b"), [20, 31]);
  // A standing workspace not made yet is made.
  s = ws.addWindow(s, 32, "a", { to: "me" });
  assert.ok(s.made.includes("me"));
});

test("a short name is a title's first word, as tide's without patterns", () => {
  assert.equal(ws.shortName("ABC-123: Fix login - Tracker"), "ABC-123");
  assert.equal(ws.shortName("Inbox  (3) - you@example.com - Gmail"), "Inbox");
  assert.equal(ws.shortName("notes, draft | Docs"), "notes");
  // A word left with no letter or digit is passed over.
  assert.equal(ws.shortName("— | Docs"), "Docs");
  assert.equal(ws.shortName("  Café: menu"), "Café");
  assert.equal(ws.shortName("v1.2."), "v1.2");
  assert.equal(ws.shortName("Really?! Yes"), "Really");
  assert.equal(ws.shortName("Loading…"), "Loading");
  // Punctuation inside a word stays.
  assert.equal(ws.shortName("PR-12/login"), "PR-12/login");
  // What a name can't hold goes, and a long word is cut, so it's a name.
  assert.equal(ws.shortName('"Quoted" title'), "Quoted");
  assert.equal(ws.shortName("it's"), "its");
  assert.deepEqual(ws.checkName(ws.shortName("x".repeat(40))), { name: "x".repeat(32) });
  // Nothing to name it from gives an empty name, so the prompt starts empty.
  assert.equal(ws.shortName(""), "");
  assert.equal(ws.shortName(undefined), "");
  assert.equal(ws.shortName("— | …"), "");
});

test("the bar lists the standing ones, made or not, then the rest as made", () => {
  let s = ws.create(["a"]);
  assert.deepEqual(ws.barOrder(s), ["in", "re", "oc", "me"]);
  assert.deepEqual(s.made, ["in"], "only home is made");
  s = ws.addWindow(s, 1, "a");
  s = ws.addWindow(s, 2, "a");
  s = ws.send(s, 1, "web");
  s = ws.send(s, 2, "chat");
  s = ws.show(s, "me");
  assert.deepEqual(ws.barOrder(s), ["in", "re", "oc", "me", "web", "chat"]);
});

test("standing workspaces are made on first use and never removed", () => {
  let s = ws.addWindow(ws.create(["a"]), 1, "a");
  s = ws.show(s, "oc");
  assert.ok("oc" in s.workspaces, "showing makes it");
  s = ws.send(s, 1, "me");
  assert.ok("me" in s.workspaces, "sending makes it");
  s = ws.show(s, "in");
  s = ws.removeWindow(s, 1);
  assert.deepEqual(s.made, ["in", "oc", "me"], "left empty and hidden, they stay");
});

test("a made workspace goes once it's empty and hidden", () => {
  let s = ws.addWindow(ws.create(["a"]), 1, "a");
  s = ws.show(s, "web");
  assert.ok("web" in s.workspaces, "showing a new name makes it, empty");
  s = ws.show(s, "in");
  assert.equal("web" in s.workspaces, false, "left empty, it goes");
  s = ws.send(s, 1, "web");
  s = ws.show(s, "web");
  s = ws.send(s, 1, "in");
  assert.ok("web" in s.workspaces, "empty but showing, it stays");
  s = ws.show(s, "in");
  assert.equal("web" in s.workspaces, false);
  assert.deepEqual(ws.barOrder(s), ["in", "re", "oc", "me"]);
});

test("a made workspace holding only a window you minimized stays", () => {
  let s = ws.addWindow(ws.create(["a"]), 1, "a");
  s = ws.show(s, "web");
  s = ws.addWindow(s, 2, "a");
  s = ws.userMinimized(s, 2);
  s = ws.show(s, "in");
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
  s = ws.show(s, "web");
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
  s = ws.show(s, "oc");
  s = ws.show(s, "re");
  s = ws.show(s, "in");
  assert.equal(ws.last(s, "in"), "re", "from home, the last one");
  assert.equal(ws.last(s, "re"), "oc", "from it, the one before");
  s = ws.show(s, "web");
  s = ws.show(s, "in");
  assert.equal(ws.last(s, "in"), "re", "one that's gone is skipped");
});

test("a name is one trimmed line of at most 32 characters, with nothing to quote", () => {
  assert.deepEqual(ws.checkName("  web "), { name: "web" });
  assert.deepEqual(ws.checkName("x".repeat(32)), { name: "x".repeat(32) });
  assert.deepEqual(ws.checkName("ñ".repeat(32)), { name: "ñ".repeat(32) }, "characters, not bytes");
  for (const bad of ["", "   ", "x".repeat(33), 'a"b', "a'b", "a`b", "a\\b", "a\nb", "a\tb", "a\u0007b", "a b", "re@DP-2"]) {
    assert.ok(ws.checkName(bad).error, JSON.stringify(bad));
  }
  assert.throws(() => ws.show(ws.create(["a"]), 'a"b'), /quotes/);
  assert.match(ws.checkName("re@DP-2").error, /@/, "tide keeps @ for a monitor's part");
  assert.equal(ws.shortName("mail@example.com - Inbox"), "mailexample.com", "a short name drops it");
});

test("switching hides the old workspace's windows and shows the new one's", () => {
  let s = twoDisplays();
  s = ws.addWindow(ws.show(s, "oc"), 30, "a");
  s = ws.show(s, "in");
  assert.deepEqual(shown(s), [10, 11, 20]);
  assert.deepEqual(ws.plan(s, new Set([10, 11])), { restore: [10, 11], minimize: [30] });
});

test("showing a workspace shows it on every display, each its own part", () => {
  let s = twoDisplays();
  s = ws.send(s, 11, "re");
  s = ws.send(s, 20, "re");
  s = ws.show(s, "re");
  assert.equal(ws.showing(s, "a"), "re");
  assert.equal(ws.showing(s, "b"), "re");
  assert.deepEqual(ws.part(s, "a"), [11]);
  assert.deepEqual(ws.part(s, "b"), [20], "a sent window keeps its display");
  assert.deepEqual(shown(s), [11, 20]);
  assert.deepEqual(ws.plan(s, none), { restore: [], minimize: [10] });
});

test("a window you minimized stays minimized across a switch", () => {
  let s = ws.userMinimized(twoDisplays(), 11);
  s = ws.show(s, "oc");
  s = ws.show(s, "in");
  assert.deepEqual(ws.plan(s, new Set([10, 11])), { restore: [10], minimize: [] });
});

test("minimize then restore on the same workspace keeps the window up", () => {
  let s = ws.userMinimized(twoDisplays(), 11);
  s = ws.userRestored(s, 11);
  assert.equal(ws.isShown(s, 11), true);
  assert.deepEqual(ws.plan(s, none), { restore: [], minimize: [] });
});

test("restoring a window on a hidden workspace brings the workspace", () => {
  let s = ws.show(twoDisplays(), "oc");
  s = ws.userRestored(s, 10);
  assert.equal(ws.showing(s, "a"), "in");
  assert.equal(s.workspaces.in.focused, 10);
});

test("sending to the workspace showing keeps the window shown on its display", () => {
  let s = ws.send(twoDisplays(), 10, "re");
  s = ws.show(s, "re");
  s = ws.send(s, 20, "re");
  assert.deepEqual(s.workspaces.re.windows, [10, 20]);
  assert.equal(ws.isShown(s, 20), true);
  assert.deepEqual(ws.part(s, "b"), [20]);
});

test("a focused window stays focused on the workspace it moves to", () => {
  let s = ws.send(twoDisplays(), 20, "re");
  s = ws.focused(s, 20);
  s = ws.focused(s, 10);
  s = ws.send(s, 10, "re");
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

test("activating a window on a hidden workspace shows that workspace", () => {
  let s = ws.send(twoDisplays(), 10, "web");
  s = ws.activate(s, 10);
  assert.equal(ws.showing(s, "a"), "web");
  assert.equal(ws.showing(s, "b"), "web");
  assert.equal(ws.isShown(s, 10), true);
  assert.equal(ws.isShown(s, 20), false);
});

test("activating a window on the workspace showing switches nothing", () => {
  const before = twoDisplays();
  const s = ws.activate(before, 20);
  assert.equal(s.current, before.current);
  assert.deepEqual(s.recent, before.recent);
  assert.equal(s.workspaces.in.focused, 20);
});

test("moving a window to another display keeps its workspace, at the end of that display's part", () => {
  let s = ws.addWindow(twoDisplays(), 21, "b");
  s = ws.movedToDisplay(s, 10, "b");
  assert.equal(s.windows[10].ws, "in");
  assert.deepEqual(ws.part(s, "a"), [11]);
  assert.deepEqual(ws.part(s, "b"), [20, 21, 10]);
  assert.equal(ws.isShown(s, 10), true);
  assert.equal(ws.movedToDisplay(s, 10, "gone"), s, "not to a display that isn't there");
});

test("a removed display hands its windows to the first left, and gets them back", () => {
  let s = ws.send(twoDisplays(), 11, "re");
  s = ws.addWindow(s, 21, "b");
  s = ws.send(s, 21, "re");
  s = ws.setDisplays(s, ["a"]);
  assert.deepEqual(ws.part(s, "a"), [10, 20], "in the same workspace, on the first display");
  assert.equal(s.windows[21].display, "a", "a hidden workspace's windows too");
  assert.deepEqual(shown(s), [10, 20]);
  s = ws.setDisplays(s, ["a", "b"]);
  assert.deepEqual(ws.part(s, "a"), [10]);
  assert.deepEqual(ws.part(s, "b"), [20]);
  assert.equal(s.windows[21].display, "b");
  assert.equal(s.windows[11].display, "a", "one that never left stays");
  assert.equal("from" in s.windows[20], false, "nothing left to go back to");
});

test("a window you moved while its display was away stays where you put it", () => {
  let s = ws.setDisplays(ws.setDisplays(twoDisplays(), ["a"]), ["a", "c"]);
  s = ws.movedToDisplay(s, 20, "c");
  s = ws.setDisplays(s, ["a", "b", "c"]);
  assert.equal(s.windows[20].display, "c");
});

test("a window you put on the display it was handed to stays there", () => {
  let s = ws.setDisplays(twoDisplays(), ["a"]);
  s = ws.movedToDisplay(s, 20, "a");
  s = ws.setDisplays(s, ["a", "b"]);
  assert.equal(s.windows[20].display, "a", "you put it there, so it stays");
});

test("more displays than standing workspaces make no new workspace", () => {
  const s = ws.create(["a", "b", "c"], ["in", "re"]);
  assert.deepEqual(["a", "b", "c"].map((d) => ws.showing(s, d)), ["in", "in", "in"]);
  assert.deepEqual(ws.barOrder(s), ["in", "re"]);
});

test("a workspace no longer standing goes once it's empty", () => {
  let s = ws.show(ws.create(["a"]), "oc");
  s = ws.show(s, "in");
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
  ws.show(s, "oc");
  ws.send(s, 10, "me");
  ws.userMinimized(s, 11);
  ws.removeWindow(s, 20);
  assert.deepEqual(s, copy);
});

test("removing a window drops it from its workspace", () => {
  const s = ws.removeWindow(twoDisplays(), 10);
  assert.deepEqual(s.workspaces.in.windows, [11, 20]);
  assert.equal(10 in s.windows, false);
});

test("stack moves wrap within a display's part, and swapMaster swaps with its master", () => {
  let s = ws.addWindow(twoDisplays(), 12, "a");
  assert.equal(ws.neighbor(s, 12, 1), 10);
  assert.equal(ws.neighbor(s, 10, -1), 12);
  assert.equal(ws.neighbor(s, 20, 1), 20, "b's part holds only 20");
  s = ws.swapMaster(s, 12);
  assert.deepEqual(s.workspaces.in.windows, [12, 11, 20, 10]);
  s = ws.swapMaster(s, 12);
  assert.deepEqual(s.workspaces.in.windows, [11, 12, 20, 10]);
  s = ws.moveInStack(s, 11, -1);
  assert.deepEqual(s.workspaces.in.windows, [10, 12, 20, 11], "20, on b, keeps its place");
  assert.deepEqual(ws.swapMaster(s, 20).workspaces.in.windows, s.workspaces.in.windows, "alone in its part");
});

test("tiled lists the showing workspace's windows you haven't minimized", () => {
  const s = ws.userMinimized(twoDisplays(), 10);
  assert.deepEqual(ws.tiled(s, "a"), [11]);
});

test("a floating window shows and hides with its workspace but takes no tile", () => {
  let s = ws.toggleFloating(twoDisplays(), 11);
  assert.deepEqual(ws.tiled(s, "a"), [10]);
  assert.equal(ws.neighbor(s, 10, 1), 10, "the stack skips it");
  s = ws.show(s, "oc");
  assert.equal(ws.isShown(s, 11), false);
  s = ws.toggleFloating(ws.show(s, "in"), 11);
  assert.deepEqual(ws.tiled(s, "a"), [10, 11]);
});

test("stack moves on a window that isn't tiled change nothing", () => {
  const s = ws.toggleFloating(twoDisplays(), 11);
  assert.deepEqual(ws.moveInStack(s, 11, 1).workspaces.in.windows, [10, 11, 20]);
  assert.deepEqual(ws.swapMaster(s, 11).workspaces.in.windows, [10, 11, 20]);
});

test("monocle toggles back to the layout before it", () => {
  let s = ws.setLayout(ws.create(["a"]), "in", "a", "twocol");
  s = ws.toggleMonocle(s, "in", "a", "twocol");
  assert.equal(ws.layoutOf(s, "in", "a").layout, "monocle");
  s = ws.toggleMonocle(s, "in", "a", "monocle");
  assert.equal(ws.layoutOf(s, "in", "a").layout, "twocol");
  s = ws.toggleMonocle(ws.create(["a"]), "in", "a", "tile");
  s = ws.toggleMonocle(s, "in", "a", "monocle");
  assert.equal(ws.layoutOf(s, "in", "a").layout, null, "back to the display's default");
});

test("each display's part of a workspace keeps its own layout, share and count", () => {
  let s = ws.create(["a", "b"]);
  s = ws.setLayout(s, "in", "a", "twocol");
  s = ws.adjust(s, "in", "b", "tile", { mfact: 0.1, nmaster: 1 });
  s = ws.toggleMonocle(s, "in", "b", "tile", "tile");
  assert.equal(ws.layoutOf(s, "in", "a").layout, "twocol");
  assert.equal(ws.layoutOf(s, "in", "b").layout, "monocle");
  assert.equal(ws.layoutOf(s, "in", "a").modes.tile.mfact, 0.55);
  assert.deepEqual(ws.layoutOf(s, "in", "b").modes.tile, { mfact: 0.65, nmaster: 2 });
  s = ws.setDisplays(s, ["a"]);
  s = ws.setDisplays(s, ["a", "b"]);
  assert.equal(ws.layoutOf(s, "in", "b").layout, "monocle", "a display that comes back finds its part as it left it");
  assert.equal(ws.layoutOf(ws.show(s, "re"), "re", "a").layout, null, "another workspace's parts are its own");
});

test("a part starts from the layout its workspace kept before parts had their own", () => {
  const s = ws.create(["a", "b"]);
  s.workspaces.in.layout = "threecol";
  s.workspaces.in.modes = { ...structuredClone(ws.DEFAULT_MODE_SETTINGS), tile: { mfact: 0.6, nmaster: 1 } };
  delete s.workspaces.in.parts;
  assert.equal(ws.layoutOf(s, "in", "b").layout, "threecol");
  const t = ws.adjust(s, "in", "a", "tile", { mfact: 0.1 });
  assert.equal(ws.layoutOf(t, "in", "a").modes.tile.mfact, 0.7);
  assert.equal(ws.layoutOf(t, "in", "b").modes.tile.mfact, 0.6, "the other display's part is untouched");
});

test("a part keeps the layout its workspace had before monocle, from before parts", () => {
  const s = ws.create(["a"]);
  Object.assign(s.workspaces.in, { layout: "monocle", beforeMonocle: "twocol" });
  delete s.workspaces.in.parts;
  const t = ws.toggleMonocle(s, "in", "a", "monocle", "tile");
  assert.equal(ws.layoutOf(t, "in", "a").layout, "twocol");
});

test("stack moves leave minimized and floating windows in their places", () => {
  let s = ws.removeWindow(twoDisplays(), 20);
  s = ws.addWindow(s, 12, "a");
  s = ws.userMinimized(s, 10);
  s = ws.swapMaster(s, 12);
  assert.deepEqual(s.workspaces.in.windows, [10, 12, 11], "10 keeps the master slot");
  s = ws.userRestored(s, 10);
  assert.deepEqual(ws.tiled(s, "a"), [10, 12, 11]);
  s = ws.toggleFloating(s, 12);
  s = ws.moveInStack(s, 11, -1);
  assert.deepEqual(s.workspaces.in.windows, [11, 12, 10]);
});

test("mfact and the master count stay in range", () => {
  let s = ws.show(ws.show(ws.create(["a", "b"]), "re"), "in");
  for (let i = 0; i < 40; i++) s = ws.adjust(s, "in", "a", "tile", { mfact: 0.025, nmaster: -1 });
  assert.equal(ws.layoutOf(s, "in", "a").modes.tile.mfact, 0.95);
  assert.equal(ws.layoutOf(s, "in", "a").modes.tile.nmaster, 0, "tile can have no main window");
  for (let i = 0; i < 5; i++) s = ws.adjust(s, "in", "a", "threecol", { nmaster: -1 });
  assert.equal(ws.layoutOf(s, "in", "a").modes.threecol.nmaster, 1, "the columns keep one");
  assert.equal(ws.layoutOf(s, "re", "a").modes.tile.mfact, 0.55, "other workspaces untouched");
});

test("a part made after the layout settings changed starts with them, and a change reaches every part", () => {
  const modes = { ...ws.DEFAULT_MODE_SETTINGS, tile: { mfact: 0.6, nmaster: 2 } };
  let s = ws.adjust(ws.create(["a", "b"]), "in", "a", "tile", { mfact: 0.1 });
  s = ws.show(ws.setModes(s, modes), "web");
  assert.deepEqual(ws.layoutOf(s, "web", "a").modes, modes);
  assert.deepEqual(ws.layoutOf(s, "in", "a").modes, modes, "what the keys gave it is dropped");
  assert.deepEqual(ws.layoutOf(s, "in", "b").modes, modes);
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
  assert.deepEqual(s.made, ["in", "2", "5", "9"], "the empty hidden ones go, b's empty 7 too");
  assert.deepEqual(ws.barOrder(s), ["in", "re", "oc", "me", "2", "5", "9"]);
  assert.equal(s.current, "in", "the first display's shows on them all");
  assert.deepEqual(s.workspaces.in.windows, [10]);
  assert.equal(ws.layoutOf(s, "in", "a").layout, "monocle", "a workspace keeps its layout");
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
  s = ws.show(s, "5");
  assert.deepEqual(ws.plan(s, new Set([20, 50, 51])), { restore: [50, 51], minimize: [10] });
  s = ws.removeWindow(ws.removeWindow(ws.show(s, "in"), 50), 51);
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
  assert.throws(() => ws.show(ws.create(["a"]), "__proto__"));
});

test("Search+End never goes to home, even one the standing list just made home", () => {
  let s = ws.create(["a"]);
  s = ws.show(s, "oc");
  s = ws.show(s, "re");
  s = ws.show(s, "in");
  s = ws.setStanding(s, ["re", "in", "oc", "me"]);
  assert.equal(ws.home(s), "re");
  assert.equal(ws.last(s, "in"), "oc");
});

test("migration from a workspace per display puts each window on its display", () => {
  const stored = ws.create([]);
  delete stored.current;
  delete stored.present;
  stored.made = ["in", "re", "web"];
  stored.workspaces.re = { ...structuredClone(stored.workspaces.in), windows: [20] };
  stored.workspaces.web = { ...structuredClone(stored.workspaces.in), windows: [30] };
  stored.workspaces.in.windows = [10];
  stored.displays = { b: "re", a: "in" };
  stored.windows = {
    10: { ws: "in", minimizedByYou: false, floating: false },
    20: { ws: "re", minimizedByYou: false, floating: false },
    30: { ws: "web", minimizedByYou: false, floating: false },
  };
  const s = ws.migrate(stored);
  assert.equal("displays" in s, false);
  assert.equal(s.current, "re", "the first display's workspace shows on them all");
  assert.deepEqual(s.present, ["b", "a"]);
  assert.deepEqual([10, 20, 30].map((id) => s.windows[id].display), ["a", "b", null], "a hidden one's is found where it is");
  assert.equal(ws.migrate(s), s, "and only once");
});
