// Tests for tide.js against a fake chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Tide } from "./tide.js";
import { FakeChrome, HD, UW } from "./fake_chrome.js";
import * as ws from "./workspaces.js";
import { DEFAULT_MODE_SETTINGS } from "./workspaces.js";

const HOME = "chrome-extension://tide/src/launcher.html?mode=home";
const DASHBOARD = "chrome-extension://tide/src/launcher.html?mode=dashboard";
const homes = (chrome) => chrome.wins.filter((w) => w.url === HOME);
// The windows tide opened, other than home windows.
const opened = (chrome) => chrome.created.filter((c) => c.url !== HOME && c.url !== DASHBOARD).map(({ id, ...c }) => c);

function on(display, id, extra = {}) {
  const a = display.workArea;
  return { id, left: a.left + 10 * id, top: a.top + 10, width: 400, height: 300, ...extra };
}

// Float window `id` with Search+Shift+F, then drag it to (x, y) at 400x300.
async function floatAt(chrome, tide, id, x, y) {
  chrome.focus(id);
  await tide.event();
  await tide.command("float");
  Object.assign(chrome.win(id), { left: x, top: y, width: 400, height: 300 });
  await tide.event();
}

async function setup(displays, windows) {
  const chrome = new FakeChrome({ displays, windows });
  const tide = new Tide(chrome);
  await tide.event();
  return { chrome, tide };
}

test("two windows on a 16:9 display tile master and stack", async () => {
  const { chrome } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1056, h: 1032 });
  assert.deepEqual(chrome.box(2), { x: 1056, y: 0, w: 864, h: 1032 });
});

test("a lone window on an ultrawide is centered at 80%", async () => {
  const { chrome } = await setup([UW], [on(UW, 1)]);
  assert.deepEqual(chrome.box(1), { x: 1920 + 344, y: 0, w: 2752, h: 1392 });
});

test("an ultrawide starts in three columns", async () => {
  const { chrome } = await setup([UW], [on(UW, 1), on(UW, 2), on(UW, 3)]);
  assert.equal(chrome.box(1).x, 1920 + 860, "master in the middle");
});

test("this Chromebook's layouts come from its own settings", async () => {
  const { chrome, tide } = await setup([UW], [on(UW, 1, { focused: true })]);
  chrome.store.settings = { singleRules: [{ minAspect: 2, width: 0.5 }], ultrawideAspect: 3 };
  await tide.event();
  assert.deepEqual(chrome.box(1), { x: 1920 + 860, y: 0, w: 1720, h: 1392 }, "half the width");
  chrome.open(on(UW, 2));
  chrome.open(on(UW, 3));
  await tide.event();
  assert.equal(chrome.box(1).x, 1920, "2.47 is under 3, so it tiles rather than three columns");
});

test("the layout settings reach every workspace, once", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  assert.equal(chrome.box(1).w, 1056, "tile's main window starts at 55%");
  chrome.syncStore.settings = { modes: { tile: { mfact: 0.6 } } };
  await tide.event();
  assert.equal(chrome.box(1).w, 1152, "60% from the settings");
  await tide.command("grow");
  assert.equal(chrome.box(1).w, 1200, "the keys still adjust it");
  await tide.event();
  assert.equal(chrome.box(1).w, 1200, "and an unchanged setting doesn't undo them");
  chrome.syncStore.settings = { modes: { tile: { mfact: 0.5 } } };
  await tide.event();
  assert.equal(chrome.box(1).w, 960, "a changed one does");
});

test("a new workspace starts in the layout the settings give its display", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  chrome.syncStore.settings = { defaultMode: { normal: "monocle" } };
  await tide.event();
  assert.deepEqual(chrome.box(2), { x: 0, y: 0, w: 1920, h: 1032 }, "monocle fills the display");
  await tide.command("monocle");
  assert.equal(chrome.box(1).w, 1056, "the monocle key leaves a monocle default for tile");
  await tide.command("monocle");
  assert.equal(chrome.box(1).w, 1920, "and comes back");
});

test("switching workspaces minimizes the old windows and restores them on return", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("workspace-2");
  assert.equal(chrome.win(1).state, "minimized");
  assert.equal(chrome.win(2).state, "minimized");
  chrome.open(on(HD, 9, { focused: true }));
  await tide.event();
  assert.deepEqual(chrome.box(9), { x: 0, y: 0, w: 1920, h: 1032 }, "a new window joins re");
  await tide.command("workspace-1");
  assert.equal(chrome.win(1).state, "normal");
  assert.equal(chrome.win(2).state, "normal");
  assert.equal(chrome.win(9).state, "minimized");
});

test("sending a window to a hidden workspace hides it and retiles the rest", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("send-3");
  assert.equal(chrome.win(1).state, "minimized");
  assert.deepEqual(chrome.box(2), { x: 0, y: 0, w: 1920, h: 1032 });
});

test("a window you minimize stays minimized across a switch", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  chrome.win(2).state = "minimized";
  await tide.event();
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 }, "the rest retile");
  await tide.command("workspace-2");
  await tide.command("workspace-1");
  assert.equal(chrome.win(2).state, "minimized");
  assert.equal(chrome.win(1).state, "normal");
});

test("restoring a window from a hidden workspace brings its workspace", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("send-4");
  // You pick window 1 from the shelf.
  chrome.win(1).state = "normal";
  chrome.focus(1);
  await tide.event();
  assert.equal(tide.state.current, "me");
  assert.equal(chrome.win(2).state, "minimized");
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
});

test("dragging a window to the other display keeps its workspace, tiled there", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(HD, 2), on(UW, 3)]);
  Object.assign(chrome.win(2), { left: 3000, top: 100 });
  await tide.event();
  assert.equal(tide.state.windows[2].ws, "in");
  assert.deepEqual(ws.part(tide.state, "uw"), [3, 2]);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
  assert.equal(chrome.box(2).x >= 1920, true);
  await tide.command("workspace-2");
  await tide.command("workspace-1");
  assert.equal(chrome.box(2).x >= 1920, true, "it comes back on the ultrawide");
});

test("a switch shows every display's part, focus staying on the display you're on", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2), on(UW, 3)]);
  chrome.focus(3);
  await tide.event();
  await tide.command("send-2");
  chrome.focus(1);
  await tide.event();
  await tide.command("send-2");
  // On re now, with 1 on the HD and 3 on the ultrawide; 2 stayed on in.
  chrome.focus(2);
  await tide.event();
  await tide.command("workspace-2");
  assert.equal(tide.state.current, "re");
  assert.deepEqual(["normal", "minimized", "normal"], [1, 2, 3].map((id) => chrome.win(id).state));
  assert.equal(chrome.box(1).x < 1920, true);
  assert.equal(chrome.box(3).x >= 1920, true);
  assert.equal(chrome.win(3).focused, true, "re's window on the ultrawide, where you were");
  assert.deepEqual(homes(chrome), [], "neither display's part is empty");
});

test("popups aren't tiled or hidden", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "popup" })]);
  const before = chrome.box(2);
  await tide.command("workspace-2");
  assert.deepEqual(chrome.box(2), before);
  assert.equal(chrome.win(2).state, "normal");
});

test("an always-on-top window is left alone on every workspace", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { alwaysOnTop: true })]);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
  assert.deepEqual(chrome.box(2), { x: 20, y: 10, w: 400, h: 300 });
  assert.equal(2 in tide.state.windows, false);
  await tide.command("workspace-2");
  assert.equal(chrome.win(2).state, "normal", "picture-in-picture refuses minimizing, so tide never asks");
});

test("a window that refuses to minimize doesn't stop the switch", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  chrome.refuse.add(1);
  await tide.command("workspace-2");
  assert.equal(chrome.win(1).state, "normal", "it refused");
  assert.equal(chrome.win(2).state, "minimized", "the others still hid");
  assert.equal(chrome.win(3).state, "minimized");
  assert.equal(1 in tide.state.windows, false, "tide leaves it alone from now on");
  await tide.event();
  assert.equal(tide.state.current, "re", "the next sync doesn't read it as a restore");
  assert.equal(chrome.win(2).state, "minimized");
});

test("a dimmed window that refuses to minimize is undimmed", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
    on(HD, 3, { url: "https://example.net/" }),
  ]);
  chrome.granted = true;
  await tide.setDim(true);
  assert.deepEqual([...chrome.dimmed].sort(), [20, 30]);
  chrome.refuse.add(2);
  await tide.command("workspace-2");
  assert.equal(chrome.win(2).state, "normal", "it refused");
  assert.deepEqual([...chrome.dimmed], [30], "still showing, it isn't left dimmed");
  await tide.event();
  assert.deepEqual([...chrome.dimmed], [30]);
});

test("Secure Shell's popup windows tile; other popups float", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true }),
    on(HD, 2, { type: "popup", url: "chrome-extension://iodihamcpbpeioajjeobimgagajmlibd/html/nassh.html" }),
    on(HD, 3, { type: "popup", url: "https://accounts.example.com/signin" }),
  ]);
  assert.deepEqual(tide.state.workspaces.in.windows, [1, 2]);
  assert.deepEqual(chrome.box(2), { x: 1056, y: 0, w: 864, h: 1032 });
  assert.equal(3 in tide.state.windows, false);
});

test("focus-next and swap-master follow the stack", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  await tide.command("focus-next");
  assert.equal(chrome.win(2).focused, true);
  await tide.command("swap-master");
  assert.deepEqual(tide.state.workspaces.in.windows, [2, 1, 3]);
  assert.equal(chrome.box(2).x, 0, "window 2 is the master now");
});

test("monocle gives every window the area, and toggles back", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("monocle");
  assert.deepEqual(chrome.box(1), chrome.box(2));
  await tide.command("monocle");
  assert.equal(chrome.box(2).x, 1056);
});

test("grow widens the master by 0.025", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("grow");
  assert.equal(chrome.box(1).w, Math.floor(1920 * 0.575 + 0.5));
});

test("state survives the worker stopping", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("send-4");
  const fresh = new Tide(chrome);
  await fresh.event();
  assert.equal(fresh.state.windows[1].ws, "me");
  assert.equal(chrome.win(1).state, "minimized");
});

test("a closed window leaves its workspace", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  chrome.wins = chrome.wins.filter((w) => w.id !== 2);
  await tide.event();
  assert.deepEqual(tide.state.workspaces.in.windows, [1]);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
});

test("maximized windows are left alone", async () => {
  const { chrome } = await setup([HD], [on(HD, 1, { state: "maximized" }), on(HD, 2)]);
  assert.deepEqual(chrome.box(2), { x: 0, y: 0, w: 1920, h: 1032 });
  assert.equal(chrome.win(1).width, 400);
});

test("a window already minimized when tide starts stays minimized", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { state: "minimized" })]);
  assert.equal(chrome.win(2).state, "minimized");
  assert.equal(tide.state.windows[2].minimizedByYou, true);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
});

test("an ordinary event never focuses a window on another display", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(HD, 2), on(UW, 3), on(UW, 4)]);
  await tide.command("monocle");
  chrome.focus(3);
  chrome.updates.length = 0;
  await tide.event();
  assert.equal(chrome.win(3).focused, true);
  assert.deepEqual(chrome.updates.filter((u) => u.focused), []);
});

test("returning to a workspace doesn't restore a window you minimized there", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1), on(HD, 2, { focused: true })]);
  chrome.win(2).state = "minimized";
  chrome.win(2).focused = false;
  await tide.event();
  await tide.command("workspace-3");
  await tide.command("workspace-1");
  assert.equal(chrome.win(2).state, "minimized");
  assert.equal(chrome.win(1).focused, true);
});

test("a floating window goes back to its display when that returns", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2)]);
  await floatAt(chrome, tide, 2, 1920 + 100, 50);
  chrome.displaysList = [HD];
  // chromeOS moves the ultrawide's window onto the remaining display.
  Object.assign(chrome.win(2), { left: 100, top: 50 });
  await tide.event();
  assert.equal(tide.state.windows[2].display, "hd");
  chrome.displaysList = [HD, UW];
  await tide.event();
  assert.deepEqual(chrome.box(2), { x: 1920 + 100, y: 50, w: 400, h: 300 });
  await tide.event();
  assert.equal(tide.state.windows[2].display, "uw", "the next sync doesn't read it as a drag");
});

test("connecting a display shows the workspace there too, empty at first", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("workspace-2");
  chrome.displaysList = [HD, UW];
  await tide.event();
  assert.equal(ws.showing(tide.state, "uw"), "re");
  assert.deepEqual(["minimized", "minimized"], [1, 2].map((id) => chrome.win(id).state));
  assert.equal(homes(chrome).length, 2, "the new display's empty part gets a home too");
  assert.ok(homes(chrome).some((w) => w.left >= 1920));
});

test("disconnecting a display hands its windows to the first left, and back on return", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2)]);
  chrome.displaysList = [HD];
  // chromeOS moves the ultrawide's window onto the remaining display.
  Object.assign(chrome.win(2), { left: 100, top: 100 });
  await tide.event();
  assert.equal(tide.state.windows[2].ws, "in", "it keeps its workspace");
  assert.equal(chrome.win(2).state, "normal");
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1056, h: 1032 });
  assert.deepEqual(chrome.box(2), { x: 1056, y: 0, w: 864, h: 1032 });
  chrome.displaysList = [HD, UW];
  await tide.event();
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
  assert.equal(chrome.box(2).x >= 1920, true, "back on the ultrawide");
  await tide.event();
  assert.equal(tide.state.windows[2].display, "uw", "the next sync doesn't read it as a drag");
});

test("a key on an empty display's home acts on no other display's window", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true })]);
  const [home] = homes(chrome);
  assert.ok(home.left >= 1920, "the ultrawide's empty part has a home");
  chrome.focus(home.id);
  await tide.event();
  await tide.command("send-2");
  assert.equal(tide.state.windows[1].ws, "in", "the HD's window stays");
  assert.equal(chrome.win(1).state, "normal");
});

test("a maximized window handed back follows once it's unmaximized", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2)]);
  chrome.win(2).state = "maximized";
  await tide.event();
  chrome.displaysList = [HD];
  Object.assign(chrome.win(2), { left: 100, top: 100 });
  await tide.event();
  chrome.displaysList = [HD, UW];
  await tide.event();
  assert.equal(tide.state.windows[2].display, "uw");
  // Still maximized on the HD, where chromeOS put it; then you unmaximize it.
  chrome.win(2).state = "normal";
  await tide.event();
  assert.equal(tide.state.windows[2].display, "uw", "not read as a drag");
  assert.equal(chrome.box(2).x >= 1920, true, "tiled back on the ultrawide");
});

test("a maximized window you move to another display stays there", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2)]);
  chrome.win(2).state = "maximized";
  await tide.event();
  // Search+Alt+M while it's maximized.
  Object.assign(chrome.win(2), { left: 0, top: 0 });
  await tide.event();
  assert.equal(tide.state.windows[2].display, "hd");
  chrome.win(2).state = "normal";
  await tide.event();
  assert.equal(tide.state.windows[2].display, "hd", "still where you put it");
  assert.equal(chrome.box(2).x < 1920, true);
});

test("a layout key changes only your display's part of the workspace", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(HD, 2), on(UW, 3), on(UW, 4)]);
  await tide.command("monocle");
  await tide.command("grow");
  assert.equal(chrome.store.view.displays.hd.mode, "monocle");
  assert.equal(chrome.store.view.displays.uw.mode, "threecol", "the ultrawide keeps its own");
  assert.equal(ws.layoutOf(tide.state, "in", "uw").modes.monocle.mfact, 0.5);
  chrome.focus(3);
  await tide.event();
  await tide.command("layout-next");
  assert.equal(chrome.store.view.displays.hd.mode, "monocle");
  assert.notEqual(chrome.store.view.displays.uw.mode, "threecol");
});

test("a focused popup on the other display makes commands act there", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1), on(UW, 2), on(UW, 3, { type: "popup", focused: true })]);
  await tide.command("workspace-3");
  await tide.command("workspace-1");
  assert.equal(chrome.win(2).focused, true, "the ultrawide's window, not the HD's");
});

test("a floating window on a hidden workspace comes back where it was", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(HD, 2), on(UW, 3)]);
  await floatAt(chrome, tide, 2, 100, 50);
  await tide.command("send-4");
  assert.equal(chrome.win(2).state, "minimized");
  chrome.focus(3);
  await tide.event();
  await tide.command("workspace-4");
  assert.equal(chrome.win(2).state, "normal");
  assert.deepEqual(chrome.box(2), { x: 100, y: 50, w: 400, h: 300 }, "on its own display");
  await tide.event();
  assert.equal(tide.state.windows[2].ws, "me", "the next sync leaves it on me");
});

test("an app key opens a new window even when the app has one", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true }),
    on(HD, 2, { type: "app", url: "https://calendar.google.com/calendar/u/0/r" }),
  ]);
  await tide.command("send-3");
  chrome.focus(2);
  await tide.event();
  await tide.command("send-4");
  // The open Calendar window is on hidden workspace me.
  chrome.focus(1);
  await tide.event();
  await tide.command("app-calendar");
  assert.equal(tide.state.current, "in", "it stays on this workspace");
  assert.deepEqual(opened(chrome), [{ url: "https://calendar.google.com/", type: "popup" }]);
  const [{ id }] = chrome.created.filter((c) => c.url === "https://calendar.google.com/");
  assert.equal(chrome.win(id).focused, true, "the new window, not the old one");
  assert.deepEqual(tide.state.workspaces.in.windows, [id]);
});

test("an app key's popup tiles like an app, and each press opens another", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("app-chat");
  assert.deepEqual(opened(chrome), [{ url: "https://chat.google.com/", type: "popup" }]);
  assert.deepEqual(tide.state.workspaces.in.windows, [1, 2], "the popup tiles like an app");
  assert.equal(chrome.box(2).x, 1056);
  await tide.command("app-chat");
  assert.equal(opened(chrome).length, 2, "the second press opens another");
  assert.equal(chrome.win(3).focused, true);
});

test("an app key opens the app settings give it, and a key with none does nothing", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  chrome.syncStore.settings = { apps: [{ command: "app-chat", name: "Linear", url: "https://linear.app/" }] };
  await tide.command("app-chat");
  assert.deepEqual(opened(chrome), [{ url: "https://linear.app/", type: "popup" }]);
  await tide.command("app-meet");
  assert.equal(opened(chrome).length, 1, "Meet's key has no app now");
});

test("the browser key opens a new browser window even with one open", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { type: "app", url: "https://music.youtube.com/", focused: true }),
    on(HD, 2, { url: "https://example.com/" }),
  ]);
  await tide.command("app-browser");
  assert.deepEqual(opened(chrome), [{ url: undefined, type: "normal" }]);
  assert.equal(chrome.win(3).focused, true);
  assert.deepEqual(tide.state.workspaces.in.windows, [1, 2, 3]);
});

test("other popups stay untracked", async () => {
  const { tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "popup", url: "https://chat.google.com/" })]);
  assert.equal(2 in tide.state.windows, false);
});

test("an empty workspace gets a focused home window, and loses it when a window arrives", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  assert.equal(homes(chrome).length, 0);
  await tide.command("workspace-2");
  const [home] = homes(chrome);
  assert.ok(home, "a home window opened");
  assert.equal(home.focused, true);
  assert.equal(home.type, "popup");
  assert.equal(home.state, "fullscreen");
  assert.deepEqual(chrome.box(home.id), { x: 0, y: 0, w: 1920, h: 1080 }, "it covers its display");
  assert.equal(2 in tide.state.windows, false, "it isn't tracked or tiled");
  // A key pressed in the home window acts on its display.
  await tide.command("app-browser");
  assert.equal(homes(chrome).length, 0, "it closed when the browser window arrived");
  assert.deepEqual(chrome.removed, [home.id]);
});

test("switching between empty workspaces keeps one home window", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("workspace-2");
  await tide.command("workspace-3");
  assert.equal(homes(chrome).length, 1);
  await tide.command("workspace-1");
  assert.equal(homes(chrome).length, 0);
  assert.equal(chrome.win(1).focused, true);
});

test("a home window you close stays closed until another empty workspace", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("workspace-2");
  chrome.wins = chrome.wins.filter((w) => w.url !== HOME);
  await tide.event();
  assert.equal(homes(chrome).length, 0);
  await tide.command("workspace-3");
  assert.equal(homes(chrome).length, 1);
});

test("a home window you close stays closed when the worker restarts", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("workspace-2");
  chrome.wins = chrome.wins.filter((w) => w.url !== HOME);
  // Chrome stops the idle worker; storage.session outlives it.
  const woken = new Tide(chrome);
  await woken.event();
  assert.equal(homes(chrome).length, 0);
});

test("after a browser restart on an empty workspace, its home window is back", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true, url: "https://mail.google.com/" })]);
  await tide.command("workspace-2");
  assert.equal(homes(chrome).length, 1);
  // The browser restarts: tide's home page went with it, the window is
  // back with a new ID, and storage.session is empty.
  chrome.wins = [];
  chrome.sessionStore = {};
  chrome.open(on(HD, 11, { url: "https://mail.google.com/" }));
  const after = new Tide(chrome);
  await after.event();
  assert.equal(after.state.current, "re", "the empty workspace still shows");
  assert.equal(chrome.win(11).state, "minimized", "its one window is back on home, hidden");
  const [home] = homes(chrome);
  assert.ok(home, "so the empty workspace has a home window again, for the keys");
  assert.equal(home.focused, true);
  // In the new session, that one stays closed once you close it.
  chrome.wins = chrome.wins.filter((w) => w.url !== HOME);
  await after.event();
  assert.equal(homes(chrome).length, 0);
});

test("after tide reloads on an empty workspace, its home window is back", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("workspace-2");
  assert.equal(homes(chrome).length, 1);
  // Reloading or updating tide closes its pages and empties
  // storage.session; Chrome's windows stay as they were.
  chrome.wins = chrome.wins.filter((w) => w.url !== HOME);
  chrome.sessionStore = {};
  const reloaded = new Tide(chrome);
  await reloaded.event();
  assert.equal(chrome.win(1).state, "minimized");
  assert.equal(homes(chrome).length, 1, "the home window you didn't close is back");
});

test("switching to an empty workspace focuses only your display's home", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1), on(UW, 2, { focused: true })]);
  await tide.command("workspace-3");
  assert.equal(tide.state.current, "oc");
  assert.equal(homes(chrome).length, 2, "each display's part is empty");
  const uwHome = homes(chrome).find((w) => w.left >= 1920);
  assert.equal(uwHome.focused, true, "focus stays on the display you switched from");
});

test("a disconnected display's home window closes", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2)]);
  chrome.focus(2);
  await tide.event();
  await tide.command("send-4");
  const [home] = homes(chrome);
  assert.ok(home.left >= 1920, "the ultrawide got a home");
  chrome.displaysList = [HD];
  Object.assign(home, { left: 100, top: 100 });
  await tide.event();
  assert.equal(homes(chrome).length, 0);
  assert.deepEqual(tide.state.homes, {});
});

test("a display that comes back with nothing to show gets its home window again", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true })]);
  const [home] = homes(chrome);
  assert.ok(home.left >= 1920, "the empty ultrawide has a home");
  // Unplugged: chromeOS moves its home onto the display left, and tide
  // closes it there.
  chrome.displaysList = [HD];
  Object.assign(home, { left: 100, top: 100 });
  await tide.event();
  assert.equal(homes(chrome).length, 0);
  // Plugged back in, with the same workspace showing.
  chrome.displaysList = [HD, UW];
  await tide.event();
  const [back] = homes(chrome);
  assert.ok(back, "the ultrawide's part is still empty, so it has a home again");
  assert.ok(back.left >= 1920, "on the ultrawide");
  assert.equal(chrome.win(1).focused, true, "and focus stays where you are");
});

test("the last window leaving a workspace brings the home window", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("send-2");
  assert.equal(homes(chrome).length, 1);
});

test("the badge shows the focused display's workspace, cut to four characters", async () => {
  const chrome = new FakeChrome({ displays: [HD], windows: [on(HD, 1, { focused: true })] });
  chrome.syncStore.settings = { standing: ["in", "reading", "ñandúes"] };
  const tide = new Tide(chrome);
  await tide.event();
  assert.equal(chrome.badge, "in");
  await tide.command("workspace-2");
  assert.equal(chrome.badge, "read");
  await tide.command("workspace-3");
  assert.equal(chrome.badge, "ñand", "characters, not bytes");
});

test("the dashboard opens full screen on the focused display, and its key closes it", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1), on(UW, 2, { focused: true })]);
  await tide.command("popup");
  const [d] = chrome.wins.filter((w) => w.url === DASHBOARD);
  assert.ok(d, "the dashboard opened");
  assert.equal(d.state, "fullscreen");
  assert.equal(d.focused, true);
  assert.deepEqual(chrome.box(d.id), { x: 1920, y: 0, w: 3440, h: 1440 }, "on the ultrawide, where the focus was");
  assert.equal(d.id in tide.state.windows, false, "it isn't tiled or tracked");
  await tide.command("popup");
  assert.equal(chrome.wins.some((w) => w.url === DASHBOARD), false, "the key again closes it");
});

test("a command from the dashboard acts on the window you were last in", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1), on(HD, 2, { focused: true })]);
  await tide.command("popup");
  assert.ok(chrome.wins.find((w) => w.url === DASHBOARD).focused, "the dashboard has focus");
  await tide.command("send-3");
  assert.equal(tide.state.windows[2].ws, "oc", "the window behind the dashboard moved");
  assert.equal(tide.state.windows[1].ws, "in");
});

test("a dashboard that closed itself is forgotten", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("popup");
  chrome.wins = chrome.wins.filter((w) => w.url !== DASHBOARD);
  await tide.event();
  assert.equal(tide.state.dashboard, undefined);
  await tide.command("popup");
  assert.equal(chrome.wins.filter((w) => w.url === DASHBOARD).length, 1, "the next press opens a new one");
});

// The overview (§6.5): its own page, full screen, on its key alone.
const OVERVIEW = "chrome-extension://tide/src/overview.html";
const SITE = "https://example.com/";

test("the overview opens full screen on the focused display, and its key closes it", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1), on(UW, 2, { focused: true })]);
  await tide.command("overview");
  const [o] = chrome.wins.filter((w) => w.url === OVERVIEW);
  assert.ok(o, "the overview opened");
  assert.equal(o.state, "fullscreen");
  assert.equal(o.focused, true);
  assert.deepEqual(chrome.box(o.id), { x: 1920, y: 0, w: 3440, h: 1440 }, "on the ultrawide, where the focus was");
  assert.equal(o.id in tide.state.windows, false, "it isn't tiled or tracked");
  await tide.command("overview");
  assert.equal(chrome.wins.some((w) => w.url === OVERVIEW), false, "the key again closes it");
  // The dashboard's key swaps it for the dashboard, and back.
  await tide.command("overview");
  await tide.command("popup");
  assert.deepEqual(chrome.wins.filter((w) => w.url === OVERVIEW || w.url === DASHBOARD).map((w) => w.url), [DASHBOARD]);
  await tide.command("overview");
  assert.deepEqual(chrome.wins.filter((w) => w.url === OVERVIEW || w.url === DASHBOARD).map((w) => w.url), [OVERVIEW]);
});

test("a window chosen in the overview comes with its workspace, restored", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("send-2");
  await tide.command("overview");
  await tide.activateWindow(1);
  assert.equal(tide.state.current, "re", "its workspace shows");
  assert.equal(chrome.win(1).state, "normal");
  assert.equal(chrome.win(1).focused, true);
  assert.equal(chrome.win(2).state, "minimized", "and the one you were in goes");
  // One you minimized comes back too.
  chrome.win(1).state = "minimized";
  chrome.focus(2);
  await tide.command("workspace-1");
  await tide.activateWindow(1);
  assert.equal(chrome.win(1).state, "normal");
  assert.equal(tide.state.windows[1].minimizedByYou, false);
  // One that closed meanwhile changes nothing.
  const before = tide.state.current;
  await tide.activateWindow(99);
  assert.equal(tide.state.current, before);
});

// Pictures (§6.5) need all-sites access, the dim's; tide's clock and the
// pictures' timer are the test's.
function pictured(tide) {
  const pending = [];
  let t = 1_000_000;
  tide.now = () => t;
  tide.pictures.later = (f) => pending.push(f);
  return {
    pending,
    fire: async (ms) => {
      t += ms;
      for (const f of pending.splice(0)) await f();
    },
  };
}

test("a window's picture is taken before a switch hides it", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { url: SITE, focused: true }), on(HD, 2, { url: SITE })]);
  chrome.granted = true;
  const clock = pictured(tide);
  tide.pictures.shrink = async (raw) => raw;
  // Only the switch takes pictures here, none in the background.
  tide.pictures.refresh = () => {};
  await tide.command("send-2");
  chrome.focus(2);
  await tide.event();
  await clock.fire(1000);
  chrome.captures.length = 0;
  await tide.command("workspace-2");
  assert.deepEqual(chrome.captures, [2], "the window you were in, while it showed");
  assert.match(chrome.sessionStore["picture:2"].url, /^data:2,/);
});

test("the windows showing have their pictures taken in turn, and none behind tide's pages", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { url: SITE, focused: true }), on(HD, 2, { url: SITE })]);
  chrome.granted = true;
  const clock = pictured(tide);
  tide.pictures.shrink = async (raw) => raw;
  await tide.event();
  await clock.fire(1000);
  await clock.fire(1000);
  assert.deepEqual(chrome.captures, [1, 2]);
  assert.deepEqual(Object.keys(chrome.sessionStore).filter((k) => k.startsWith("picture:")).sort(), ["picture:1", "picture:2"]);
  // Behind the dashboard there's nothing to capture.
  await clock.fire(60_000);
  await tide.command("popup");
  await clock.fire(1000);
  assert.deepEqual(chrome.captures, [1, 2]);
  // A closed window's picture goes.
  await tide.command("popup");
  chrome.wins = chrome.wins.filter((w) => w.id !== 2);
  await tide.event();
  assert.equal(chrome.sessionStore["picture:2"], undefined);
});

test("the overview takes the picture of the window you're in as it opens", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { url: SITE, focused: true })]);
  chrome.granted = true;
  pictured(tide);
  tide.pictures.shrink = async (raw) => raw;
  await tide.command("overview");
  assert.deepEqual(chrome.captures, [1]);
});

test("without all-sites access tide takes no pictures", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { url: SITE, focused: true }), on(HD, 2, { url: SITE })]);
  const clock = pictured(tide);
  await tide.command("send-2");
  await tide.command("workspace-2");
  await tide.command("overview");
  await clock.fire(1000);
  assert.deepEqual(chrome.captures, []);
  assert.deepEqual(clock.pending, []);
});

// The name prompt (§6.1) is the dashboard on its Workspaces scope.
const PROMPT = `${DASHBOARD}&scope=workspaces`;
const MOVE_PROMPT = `${PROMPT}&move=1`;

test("Search+W opens the dashboard on its workspaces, and the key again closes it", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("workspace-go");
  const [d] = chrome.wins.filter((w) => w.url === PROMPT);
  assert.ok(d, "the prompt opened");
  assert.equal(d.state, "fullscreen");
  assert.equal(tide.state.moving, undefined, "it moves no window");
  await tide.command("workspace-go");
  assert.equal(chrome.wins.some((w) => w.url?.startsWith(DASHBOARD)), false);
  // Another key's dashboard takes its place.
  await tide.command("workspace-go");
  await tide.command("popup");
  assert.deepEqual(chrome.wins.filter((w) => w.url?.startsWith(DASHBOARD)).map((w) => w.url), [DASHBOARD]);
});

test("Enter in Search+W's prompt shows a new name, made", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("workspace-go");
  await tide.workspace("notes");
  assert.equal(tide.state.current, "notes");
  assert.deepEqual(chrome.store.view.bar, ["in", "re", "oc", "me", "notes"]);
  assert.equal(tide.state.windows[1].ws, "in", "no window moved");
});

test("Search+Shift+W's prompt moves the window it opened over, which focus follows", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1), on(HD, 2, { focused: true })]);
  await tide.command("workspace-move");
  assert.ok(chrome.wins.find((w) => w.url === MOVE_PROMPT)?.focused, "the prompt has focus");
  assert.equal(tide.state.moving, 2);
  await tide.moveTo("notes");
  assert.equal(tide.state.windows[2].ws, "notes", "made and moved there");
  assert.equal(tide.state.current, "notes", "and shown");
  assert.equal(chrome.win(2).focused, true);
  assert.equal(chrome.win(1).state, "minimized", "home went with the switch");
  // Once the prompt closes, nothing is left to move.
  chrome.wins = chrome.wins.filter((w) => !w.url?.startsWith(DASHBOARD));
  await tide.event();
  assert.equal(tide.state.moving, undefined);
  await assert.rejects(tide.moveTo("re"), /no window to move/);
  assert.equal(tide.state.windows[2].ws, "notes");
});

test("Search+Shift+W's prompt takes an existing workspace by name", async () => {
  const { tide } = await setup([HD], [on(HD, 1), on(HD, 2, { focused: true })]);
  await tide.command("workspace-move");
  await tide.moveTo("oc");
  assert.equal(tide.state.windows[2].ws, "oc");
  assert.equal(tide.state.current, "oc");
  assert.deepEqual(tide.state.workspaces.oc.windows, [2]);
});

test("a new window on home named home stays there, and asks no more", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await opens(chrome, tide, 2, { url: "https://mail.example.com/", title: "Inbox" });
  const [p] = prompts(chrome);
  await tide.moveTo("IN");
  assert.equal(tide.state.windows[2].ws, "in");
  assert.equal(tide.state.current, "in");
  assert.equal(chrome.win(2).focused, true);
  chrome.wins = chrome.wins.filter((w) => w !== p);
  await tide.event();
  assert.deepEqual(prompts(chrome), []);
});

test("Search+W's prompt can't move a window, and Search+Shift+W needs one", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("workspace-go");
  await assert.rejects(tide.moveTo("re"), /no window to move/);
  assert.equal(tide.state.windows[1].ws, "in");
  await tide.command("workspace-go");
  // An empty workspace has only its home page, and nothing to move.
  await tide.command("workspace-3");
  await tide.command("workspace-move");
  assert.equal(chrome.wins.some((w) => w.url === MOVE_PROMPT), false);
});

// Home's apps (§6.1): Calendar, Chat and YouTube Music by default, by their
// tabs' sites.
const CALENDAR = "https://calendar.google.com/calendar/r";
const prompts = (chrome) => chrome.wins.filter((w) => w.url?.startsWith(DASHBOARD));
// A window opens, focused as a window you open is, and tide hears of it.
async function opens(chrome, tide, id, extra = {}) {
  chrome.open(on(HD, id, extra));
  if (extra.focused !== false) chrome.focus(id);
  await tide.event();
}

test("a home app's new window joins home from another workspace, hidden there", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("send-2");
  await tide.command("workspace-2");
  await opens(chrome, tide, 2, { type: "app", url: CALENDAR });
  assert.equal(tide.state.windows[2].ws, "in", "home, not re");
  assert.equal(tide.state.current, "re", "your display stays on re");
  assert.equal(chrome.win(2).state, "minimized", "hidden, as a send to a hidden home is");
  assert.deepEqual(prompts(chrome), [], "a home app never asks");
  // Any other window joins the workspace showing.
  await opens(chrome, tide, 3, { url: "https://example.com/" });
  assert.equal(tide.state.windows[3].ws, "re");
  assert.deepEqual(prompts(chrome), [], "nor does a window off home");
});

test("home's apps come from the settings, by their app keys", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  chrome.syncStore.settings = { homeApps: ["app-meet"] };
  await tide.command("send-2");
  await tide.command("workspace-2");
  await opens(chrome, tide, 2, { type: "app", url: CALENDAR });
  assert.equal(tide.state.windows[2].ws, "re", "Calendar is no longer one of them");
  await opens(chrome, tide, 3, { type: "app", url: "https://meet.google.com/abc" });
  assert.equal(tide.state.windows[3].ws, "in", "Meet is");
});

test("a home app's key opens it on home, which comes with it", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("send-2");
  await tide.command("workspace-2");
  await tide.command("app-music");
  const [{ id }] = chrome.created.filter((c) => c.url === "https://music.youtube.com/");
  assert.equal(tide.state.windows[id].ws, "in");
  assert.equal(tide.state.current, "in", "home shows, with the window you asked for");
  assert.equal(chrome.win(id).focused, true);
  // Meet isn't one of home's apps, so it opens where you are.
  await tide.command("workspace-2");
  await tide.command("app-meet");
  const [meet] = chrome.created.filter((c) => c.url === "https://meet.google.com/");
  assert.equal(tide.state.windows[meet.id].ws, "re");
});

test("Search+Shift+W moves a home app's window home", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "app", url: CALENDAR })]);
  chrome.focus(2);
  await tide.event();
  await tide.command("send-2");
  await tide.command("workspace-2");
  chrome.focus(2);
  await tide.event();
  await tide.command("workspace-move");
  assert.deepEqual(prompts(chrome).map((w) => w.url), [MOVE_PROMPT]);
  await tide.moveTo("in");
  assert.equal(tide.state.windows[2].ws, "in");
  assert.equal(tide.state.current, "in", "and shown");
  assert.equal(chrome.win(2).focused, true);
});

test("Search+Shift+W moves any other window home too", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true, url: "https://example.com/" })]);
  await tide.command("send-2");
  await tide.command("workspace-2");
  await tide.command("workspace-move");
  assert.deepEqual(prompts(chrome).map((w) => w.url), [MOVE_PROMPT]);
  await tide.moveTo("in");
  assert.equal(tide.state.windows[1].ws, "in");
  assert.equal(tide.state.current, "in", "and shown");
  assert.equal(chrome.win(1).focused, true);
});

test("a new window on home asks for a workspace, starting with its short name", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  assert.deepEqual(prompts(chrome), [], "windows open before tide started don't ask");
  await opens(chrome, tide, 2, { url: "https://example.com/", title: "ABC-123: Fix login & more" });
  const [p] = prompts(chrome);
  assert.equal(p?.url, `${MOVE_PROMPT}&name=ABC-123`);
  assert.equal(p.focused, true, "the prompt takes the keys");
  assert.equal(p.state, "fullscreen");
  assert.equal(tide.state.moving, 2, "Enter moves the new window");
  await tide.moveTo("ABC-123");
  assert.equal(tide.state.windows[2].ws, "ABC-123", "made, and moved there");
  assert.equal(tide.state.current, "ABC-123", "and shown");
  assert.equal(chrome.win(2).focused, true);
  chrome.wins = chrome.wins.filter((w) => w !== p);
  await tide.event();
  assert.deepEqual(prompts(chrome), []);
});

test("a short name is sent encoded, and no title or a new tab page starts it empty", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await opens(chrome, tide, 2, { url: "https://example.com/", title: "Café&co? menu" });
  assert.equal(prompts(chrome)[0]?.url, `${MOVE_PROMPT}&name=Caf%C3%A9%26co`);
  chrome.wins = chrome.wins.filter((w) => !w.url?.startsWith(DASHBOARD));
  await tide.event();
  await opens(chrome, tide, 30, { url: "https://example.com/", title: "" });
  assert.equal(prompts(chrome)[0]?.url, MOVE_PROMPT);
  chrome.wins = chrome.wins.filter((w) => !w.url?.startsWith(DASHBOARD));
  await tide.event();
  // A new tab page's "New Tab" names nothing.
  await opens(chrome, tide, 40, { title: "New Tab" });
  assert.equal(prompts(chrome)[0]?.url, MOVE_PROMPT);
});

test("Esc on a new window's prompt leaves it on home, and it doesn't ask again", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await opens(chrome, tide, 2, { url: "https://example.com/", title: "Notes" });
  assert.equal(prompts(chrome).length, 1);
  // The page closes itself on Esc, or on a click away.
  chrome.wins = chrome.wins.filter((w) => !w.url?.startsWith(DASHBOARD));
  chrome.focus(2);
  await tide.event();
  assert.equal(tide.state.windows[2].ws, "in", "it stays on home");
  assert.deepEqual(prompts(chrome), [], "nothing asks again");
  chrome.focus(1);
  await tide.event();
  chrome.focus(2);
  await tide.event();
  assert.deepEqual(prompts(chrome), [], "not on its next focus either");
});

test("a second new window's prompt waits until the first's closes", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await opens(chrome, tide, 20, { url: "https://example.com/", title: "First" });
  await opens(chrome, tide, 30, { url: "https://example.com/", title: "Second" });
  assert.deepEqual(prompts(chrome).map((w) => w.url), [`${MOVE_PROMPT}&name=First`], "one prompt at a time");
  assert.equal(tide.state.moving, 20);
  await tide.moveTo("First");
  chrome.wins = chrome.wins.filter((w) => !w.url?.startsWith(DASHBOARD));
  await tide.event();
  assert.deepEqual(prompts(chrome).map((w) => w.url), [`${MOVE_PROMPT}&name=Second`], "then the next");
  assert.equal(tide.state.moving, 30);
  assert.equal(tide.state.current, "First", "over the workspace you went to, the window waiting on home");
  assert.equal(tide.state.windows[30].ws, "in");
});

test("a waiting prompt whose window closed or left home goes unasked", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await opens(chrome, tide, 20, { url: "https://example.com/", title: "First" });
  await opens(chrome, tide, 30, { url: "https://example.com/", title: "Second" });
  await opens(chrome, tide, 40, { url: "https://example.com/", title: "Third" });
  chrome.wins = chrome.wins.filter((w) => w.id !== 30);
  await tide.event();
  // Search+Shift+2 from the first's dashboard sends the window behind it.
  chrome.focus(40);
  await tide.event();
  await tide.command("send-2");
  chrome.wins = chrome.wins.filter((w) => !w.url?.startsWith(DASHBOARD));
  await tide.event();
  assert.deepEqual(prompts(chrome), [], "neither is left to ask");
  assert.deepEqual(tide.state.asking, []);
});

test("a window that opens on home unfocused asks when it's first focused", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await opens(chrome, tide, 2, { url: "https://example.com/", title: "Later", focused: false });
  assert.deepEqual(prompts(chrome), [], "it doesn't take focus to ask");
  chrome.focus(2);
  await tide.event();
  assert.deepEqual(prompts(chrome).map((w) => w.url), [`${MOVE_PROMPT}&name=Later`]);
});

test("a new window that left home before it was focused doesn't ask", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 3)]);
  await opens(chrome, tide, 20, { focused: false });
  await tide.run(async () => {
    tide.state = ws.send(tide.state, 20, "re");
  });
  chrome.focus(20);
  await tide.event();
  assert.deepEqual(prompts(chrome), []);
});

test("a new window dragged to another display still asks there", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 3)]);
  await opens(chrome, tide, 20, { focused: false });
  Object.assign(chrome.win(20), { left: 3000, top: 100 });
  await tide.event();
  assert.equal(tide.state.windows[20].ws, "in", "a drag keeps it on home");
  chrome.focus(20);
  await tide.event();
  const [prompt] = prompts(chrome);
  assert.ok(prompt.left >= 1920, "on the window's display");
});

test("windows a restart brings back don't ask, even one that matches nothing", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true, url: "https://github.com/" })]);
  await tide.event();
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://github.com/" }));
  chrome.open(on(HD, 12, { url: "https://example.com/", focused: true }));
  const after = new Tide(chrome);
  await after.event();
  assert.equal(after.state.windows[12].ws, "in");
  chrome.focus(11);
  await after.event();
  chrome.focus(12);
  await after.event();
  assert.deepEqual(prompts(chrome), []);
});

test("popups, dialogs and app popups on home never ask, nor home's apps", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await opens(chrome, tide, 2, { type: "popup", url: "https://example.com/" });
  await opens(chrome, tide, 3, { type: "app", url: "https://chat.google.com/" });
  assert.deepEqual(prompts(chrome), []);
  // Meet's key opens an app popup on home, which isn't one of its apps.
  await tide.command("app-meet");
  await tide.event();
  assert.deepEqual(prompts(chrome), []);
  // The browser key's window is a new window like any other.
  await tide.command("app-browser");
  await tide.event();
  assert.equal(prompts(chrome).length, 1);
});

test("chromeOS's system apps on home never ask, but an installed web app does", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await opens(chrome, tide, 2, { type: "app", url: "chrome://os-settings/", title: "Settings" });
  await opens(chrome, tide, 3, { type: "app", url: "chrome://file-manager/", title: "Files" });
  assert.deepEqual(prompts(chrome), [], "Settings and Files are left on home");
  assert.equal(tide.state.windows[2].ws, "in");
  await opens(chrome, tide, 4, { type: "app", url: "https://example.com/", title: "Example" });
  assert.deepEqual(prompts(chrome).map((w) => w.url), [`${MOVE_PROMPT}&name=Example`]);
});

test("a workspace whose askForName is on asks for a new window there, and home's apps still go home", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  chrome.syncStore.settings = { workspaceSettings: { RE: { askForName: true } } };
  await tide.command("send-2");
  await tide.command("workspace-2");
  await opens(chrome, tide, 2, { url: "https://example.com/", title: "Notes" });
  assert.equal(tide.state.windows[2].ws, "re");
  assert.deepEqual(prompts(chrome).map((w) => w.url), [`${MOVE_PROMPT}&name=Notes`], "re asks, matched ignoring case");
  assert.equal(tide.state.moving, 2);
  chrome.wins = chrome.wins.filter((w) => !w.url?.startsWith(DASHBOARD));
  await tide.event();
  await opens(chrome, tide, 3, { type: "app", url: "https://chat.google.com/" });
  assert.equal(tide.state.windows[3].ws, "in", "a home app goes home");
  assert.deepEqual(prompts(chrome), [], "and never asks");
});

test("with askForName off, home included, no new window asks", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  chrome.syncStore.settings = { workspaceSettings: { in: { askForName: false }, re: { pinnedApps: ["app-chat"] } } };
  await opens(chrome, tide, 2, { url: "https://example.com/", title: "Notes" });
  await tide.command("app-browser");
  await tide.event();
  assert.equal(tide.state.windows[2].ws, "in");
  assert.deepEqual(prompts(chrome), [], "home doesn't ask");
  await tide.command("send-2");
  await tide.command("workspace-2");
  await opens(chrome, tide, 4, { url: "https://example.com/", title: "More" });
  assert.deepEqual(prompts(chrome), [], "nor does a workspace whose settings leave it out");
});

test("a window waiting to ask goes unasked once its workspace stops asking", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await opens(chrome, tide, 20, { url: "https://example.com/", title: "First" });
  await opens(chrome, tide, 30, { url: "https://example.com/", title: "Second" });
  assert.deepEqual(tide.state.asking, [30]);
  chrome.syncStore.settings = { workspaceSettings: { in: { askForName: false } } };
  chrome.wins = chrome.wins.filter((w) => !w.url?.startsWith(DASHBOARD));
  await tide.event();
  assert.deepEqual(prompts(chrome), []);
  assert.deepEqual(tide.state.asking, []);
});

test("a web app still loading its first page asks, by where it's going", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await opens(chrome, tide, 2, { type: "app", pendingUrl: "https://example.com/", focused: false });
  chrome.focus(2);
  await tide.event();
  assert.equal(prompts(chrome).length, 1);
});

test("a tab chosen in the launcher comes forward with its window and workspace", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("send-4");
  chrome.focus(2);
  await tide.event();
  await tide.tabLoaded(0);
  await tide.activateTab(10, 1);
  assert.equal(tide.state.current, "me", "its workspace comes up");
  assert.equal(chrome.win(1).focused, true);
  assert.deepEqual(chrome.tabUpdates, [{ id: 10, active: true }]);
});

test("the view lists the workspace showing and each display's layout of it", async () => {
  const { chrome } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2)]);
  assert.deepEqual(chrome.store.view, {
    focusedDisplay: "hd",
    current: "in",
    displays: { hd: { workspace: "in", mode: "tile" }, uw: { workspace: "in", mode: "threecol" } },
    bar: ["in", "re", "oc", "me"],
    made: ["in"],
    counts: { in: 2, re: 0, oc: 0, me: 0 },
    urgent: [],
    dim: false,
  });
});

test("the view lists a made workspace after the standing ones, and drops it once it's empty", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.workspace("web");
  assert.deepEqual(chrome.store.view.bar, ["in", "re", "oc", "me", "web"]);
  assert.deepEqual(chrome.store.view.displays.hd.workspace, "web");
  await tide.workspace("in");
  assert.deepEqual(chrome.store.view.bar, ["in", "re", "oc", "me"]);
  assert.equal("web" in tide.state.workspaces, false);
});

test("Search+1…9 go by bar order, and a number past the last does nothing", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("workspace-5");
  assert.equal(tide.state.current, "in", "four workspaces, so 5 does nothing");
  assert.equal(chrome.win(1).state, "normal");
  await tide.command("send-5");
  assert.equal(tide.state.windows[1].ws, "in");
  await tide.command("send-4");
  assert.equal(tide.state.windows[1].ws, "me", "Search+Shift+4 makes me");
  await tide.command("workspace-4");
  assert.equal(tide.state.current, "me");
});

test("Search+0 goes to the last workspace in the bar, and Search+Shift+0 sends the window there", async () => {
  const { tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("send-0");
  assert.equal(tide.state.windows[1].ws, "me", "with none made, the last standing one");
  assert.equal(tide.state.current, "in", "staying put, as Search+Shift+1…9");
  await tide.command("workspace-0");
  assert.equal(tide.state.current, "me");
});

test("the workspace steps stop at either end of the bar, passing over empty workspaces", async () => {
  const { tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.command("workspace-prev");
  assert.equal(tide.state.current, "in", "no wrap before home");
  await tide.command("send-prev");
  assert.equal(tide.state.windows[1].ws, "in");
  await tide.command("workspace-next");
  assert.equal(tide.state.current, "in", "no other workspace has a window: it stays");
  await tide.command("send-4");
  assert.equal(tide.state.windows[1].ws, "me");
  for (let i = 0; i < 5; i++) await tide.command("workspace-next");
  assert.equal(tide.state.current, "me", "past re and oc, empty, and no wrap after the last");
  await tide.command("workspace-prev");
  assert.equal(tide.state.current, "in", "back past them");
});

test("Search+Home shows home, and Search+End the last other workspace", async () => {
  const { tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("workspace-last");
  assert.equal(tide.state.current, "in", "nothing else shown yet");
  await tide.command("workspace-3");
  await tide.command("workspace-2");
  await tide.command("workspace-home");
  assert.equal(tide.state.current, "in");
  await tide.command("workspace-last");
  assert.equal(tide.state.current, "re", "from home, the last one");
  await tide.command("workspace-last");
  assert.equal(tide.state.current, "oc", "from there, the one before");
  await tide.command("workspace-last");
  assert.equal(tide.state.current, "re", "so presses toggle between two");
});

test("a click on the bar shows a workspace by name, ignoring case", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.workspace("OC");
  assert.equal(tide.state.current, "oc");
  assert.equal(chrome.win(1).state, "minimized");
  assert.deepEqual(chrome.store.view.bar, ["in", "re", "oc", "me"]);
});

test("a state stored with numbered workspaces loads with names", async () => {
  const chrome = new FakeChrome({ displays: [HD], windows: [on(HD, 1, { focused: true }), on(HD, 2, { state: "minimized" })] });
  const empty = () => ({ windows: [], layout: null, modes: structuredClone(DEFAULT_MODE_SETTINGS), focused: null });
  const workspaces = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [n, empty()]));
  workspaces[1].windows = [1];
  workspaces[6].windows = [2];
  chrome.store.state = {
    displays: { hd: 1 },
    workspaces,
    windows: { 1: { ws: 1, minimizedByYou: false, floating: false }, 2: { ws: 6, minimizedByYou: false, floating: false } },
    marks: [],
    unread: {},
    homes: {},
  };
  const tide = new Tide(chrome);
  await tide.event();
  assert.equal(tide.state.current, "in");
  assert.equal(tide.state.windows[2].ws, "6");
  assert.equal(chrome.win(2).state, "minimized", "6 stays hidden");
  assert.deepEqual(chrome.store.view.bar, ["in", "re", "oc", "me", "6"]);
  await tide.command("workspace-5");
  assert.equal(tide.state.current, "6");
  assert.equal(chrome.win(2).state, "normal");
});

test("a state stored with a workspace per display keeps the first's showing", async () => {
  const chrome = new FakeChrome({ displays: [HD, UW], windows: [on(HD, 1, { focused: true }), on(UW, 2)] });
  const stored = ws.create([]);
  delete stored.current;
  delete stored.present;
  stored.made = ["in", "re"];
  stored.workspaces.re = { ...structuredClone(stored.workspaces.in), windows: [2] };
  stored.workspaces.in.windows = [1];
  stored.displays = { hd: "in", uw: "re" };
  stored.windows = { 1: { ws: "in", minimizedByYou: false, floating: false }, 2: { ws: "re", minimizedByYou: false, floating: false } };
  Object.assign(stored, { marks: [], unread: {}, homes: {} });
  chrome.store.state = stored;
  const tide = new Tide(chrome);
  await tide.event();
  assert.equal(tide.state.current, "in", "the other display's window on screen isn't a restore");
  assert.equal(chrome.win(1).state, "normal");
  assert.equal(chrome.win(2).state, "minimized");
  assert.equal(tide.state.windows[2].display, "uw");
  assert.equal(tide.state.windows[2].minimizedByYou, false);
  await tide.command("workspace-2");
  assert.equal(chrome.win(2).state, "normal");
  assert.equal(chrome.box(2).x >= 1920, true, "on its own display");
});

test("a rising unread count marks its window, and Search+Tab goes there", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true }),
    on(HD, 2, { type: "app", url: "https://chat.google.com/" }),
  ]);
  await tide.command("send-3");
  chrome.focus(2);
  await tide.event();
  await tide.command("send-4");
  chrome.focus(1);
  await tide.event();
  // Chat sits alone on hidden workspace me.
  await tide.title(20, 2, "Chat");
  assert.deepEqual(tide.state.marks, [], "a first title with no count marks nothing");
  await tide.title(20, 2, "Chat (1)");
  assert.deepEqual(tide.state.marks, [2]);
  assert.ok(chrome.updates.some((u) => u.id === 2 && u.drawAttention), "its shelf icon flashes");
  assert.equal(chrome.badgeColor, "#e5a50a", "the badge turns amber");
  assert.deepEqual(chrome.store.view.urgent, ["me"]);
  await tide.command("attention");
  assert.equal(tide.state.current, "me", "its workspace comes up");
  assert.equal(chrome.win(2).focused, true);
  assert.deepEqual(tide.state.marks, []);
  assert.equal(chrome.badgeColor, "#3584e4");
});

test("a count that falls or holds, or rises in the window you're in, marks nothing", async () => {
  const { tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.title(20, 2, "Inbox (5) - Gmail");
  assert.deepEqual(tide.state.marks, [], "a page loading with unread mail sets the baseline");
  await tide.title(20, 2, "Inbox (5) - Gmail");
  await tide.title(20, 2, "Inbox (4) - Gmail");
  await tide.title(10, 1, "Inbox (0) - Gmail");
  await tide.title(10, 1, "Inbox (9) - Gmail");
  assert.deepEqual(tide.state.marks, []);
});

test("a tab loading another page sets a new baseline", async () => {
  const { tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.title(20, 2, "Inbox (2) - Gmail", true);
  // The tab moves to another account with more old mail.
  await tide.title(20, 2, "Inbox (30) - Gmail", true);
  assert.deepEqual(tide.state.marks, []);
  await tide.title(20, 2, "Inbox (31) - Gmail");
  assert.deepEqual(tide.state.marks, [2], "a rise after that still marks");
});

test("Search+Tab goes to the newest mark, then the next", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  await tide.title(20, 2, "Chat");
  await tide.title(30, 3, "Inbox - Gmail");
  await tide.title(20, 2, "Chat (1)");
  await tide.title(30, 3, "Inbox (1) - Gmail");
  await tide.command("attention");
  assert.equal(chrome.win(3).focused, true);
  await tide.command("attention");
  assert.equal(chrome.win(2).focused, true);
  assert.deepEqual(tide.state.marks, []);
});

test("going to a marked window yourself clears its mark", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.title(20, 2, "Chat");
  await tide.title(20, 2, "Chat (2)");
  assert.deepEqual(tide.state.marks, [2]);
  chrome.focus(2);
  await tide.event();
  assert.deepEqual(tide.state.marks, []);
});

test("with nothing marked, Search+Tab goes back to the last window", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  chrome.focus(2);
  await tide.event();
  chrome.focus(3);
  await tide.event();
  await tide.command("attention");
  assert.equal(chrome.win(2).focused, true);
  await tide.command("attention");
  assert.equal(chrome.win(3).focused, true, "again goes back");
});

test("a closed window's mark and counts go with it", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tide.title(20, 2, "Chat");
  await tide.title(20, 2, "Chat (2)");
  assert.deepEqual(tide.state.marks, [2]);
  chrome.wins = chrome.wins.filter((w) => w.id !== 2);
  await tide.event();
  assert.deepEqual(tide.state.marks, []);
  assert.deepEqual(tide.state.unread, {});
});

test("the dim is off until you grant all-sites access", async () => {
  const { chrome } = await setup([HD], [on(HD, 1, { focused: true, url: "https://example.com/" }), on(HD, 2, { url: "https://example.org/" })]);
  assert.deepEqual([...chrome.dimmed], []);
  assert.equal(chrome.store.view.dim, false);
});

test("with the dim on, every shown window but the focused one is dimmed", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
    on(HD, 3, { url: "https://example.net/" }),
  ]);
  chrome.granted = true;
  await tide.setDim(true);
  assert.deepEqual([...chrome.dimmed].sort(), [20, 30]);
  assert.equal(chrome.store.view.dim, true);
  chrome.focus(2);
  await tide.event();
  assert.deepEqual([...chrome.dimmed].sort(), [10, 30], "focus moves the dim at once");
});

test("the dim's strength comes from settings, and a change repaints what's dimmed", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tide.setDim(true);
  assert.equal(chrome.strength.get(20), 0.1, "10% by default");
  chrome.syncStore.settings = { dimStrength: 0.25 };
  await tide.event();
  assert.equal(chrome.strength.get(20), 0.25, "the dimmed page took the new strength");
  assert.deepEqual([...chrome.dimmed], [20]);
});

test("a dimmed window on a hidden workspace comes back at the new strength", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tide.setDim(true);
  await tide.command("workspace-2");
  assert.deepEqual([...chrome.dimmed], [20], "its overlay waits for its return");
  chrome.syncStore.settings = { dimStrength: 0.25 };
  await tide.event();
  await tide.command("workspace-1");
  assert.equal(chrome.strength.get(20), 0.25);
});

test("a fullscreen window and a chrome:// page aren't dimmed", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "chrome://settings/" }),
    on(HD, 3, { url: "https://example.net/", state: "fullscreen" }),
  ]);
  chrome.granted = true;
  await tide.setDim(true);
  assert.deepEqual([...chrome.dimmed], [], "the chrome:// page fails quietly and the rest goes on");
});

test("a window left alone on its workspace loses the dim", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tide.setDim(true);
  assert.deepEqual([...chrome.dimmed], [20]);
  chrome.wins = chrome.wins.filter((w) => w.id !== 1);
  await tide.event();
  assert.deepEqual([...chrome.dimmed], []);
});

test("a hidden window keeps its dim, and loses it when it comes back focused", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tide.setDim(true);
  assert.deepEqual([...chrome.dimmed], [20]);
  await tide.command("workspace-2");
  assert.deepEqual([...chrome.dimmed], [20], "no churn on a hidden page");
  await tide.command("workspace-1");
  chrome.focus(2);
  await tide.event();
  assert.deepEqual([...chrome.dimmed], [10]);
});

test("a dimmed tab that loads a new page gets the dim back", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tide.setDim(true);
  // The page reloads, and its overlay goes with the old document.
  chrome.dimmed.delete(20);
  await tide.tabLoaded(20);
  assert.deepEqual([...chrome.dimmed], [20]);
  await tide.tabLoaded(10);
  assert.deepEqual([...chrome.dimmed], [20], "the focused tab's load leaves it undimmed");
});

test("a tab that couldn't be dimmed is dimmed once it loads a website", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "chrome://newtab/" }),
  ]);
  chrome.granted = true;
  await tide.setDim(true);
  assert.deepEqual([...chrome.dimmed], []);
  chrome.win(2).url = "https://example.org/";
  await tide.tabLoaded(20);
  assert.deepEqual([...chrome.dimmed], [20]);
});

test("with the dim off, a load does nothing", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  chrome.updates.length = 0;
  await tide.tabLoaded(20);
  assert.deepEqual(chrome.updates, [], "no retile");
});

test("turning the dim off undims every page while tide can still reach them", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tide.setDim(true);
  await tide.setDim(false);
  assert.deepEqual([...chrome.dimmed], []);
  assert.equal(chrome.store.view.dim, false);
  chrome.granted = false;
  await tide.event();
  assert.deepEqual(tide.state.dimmed, []);
});

test("after a browser restart, windows go back to their workspaces by their tabs", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://mail.google.com/" }),
    on(HD, 2, { url: "https://docs.google.com/a" }),
    on(HD, 3, { url: "https://github.com/" }),
  ]);
  await tide.command("send-3");
  chrome.focus(2);
  await tide.event();
  await tide.command("float");
  // The browser restarts: the same windows return with new IDs, all showing,
  // and the service worker starts afresh from storage.
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://github.com/" }));
  chrome.open(on(HD, 12, { url: "https://mail.google.com/" }));
  chrome.open(on(HD, 13, { url: "https://docs.google.com/a" }));
  chrome.open(on(HD, 14, { url: "https://example.com/new" }));
  chrome.focus(13);
  const after = new Tide(chrome);
  await after.event();
  const s = after.state;
  assert.equal(s.windows[12].ws, "oc", "Gmail went back to oc");
  assert.equal(chrome.win(12).state, "minimized", "which isn't showing");
  assert.equal(s.windows[13].floating, true, "the floating window still floats");
  assert.deepEqual(s.workspaces.in.windows, [13, 11, 14], "the stack order holds, and the new window joins the end");
  assert.equal(1 in s.windows, false);
});

test("after a restart, windows Chrome restores one at a time still find their workspaces", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://mail.google.com/" }),
    on(HD, 2, { url: "https://github.com/" }),
  ]);
  await tide.command("send-3");
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://github.com/", focused: true }));
  const after = new Tide(chrome);
  await after.event();
  assert.equal(after.state.windows[11].ws, "in");
  assert.equal(after.state.restoring[1].ws, "oc", "Gmail's window waits for its return");
  chrome.open(on(HD, 12, { url: "https://mail.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[12].ws, "oc", "Gmail went back to oc");
  assert.equal(chrome.win(12).state, "minimized");
  assert.equal(after.state.restoring, undefined, "nothing is left waiting");
});

test("after a restart, a made workspace waits with its window", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://mail.google.com/" }),
    on(HD, 2, { url: "https://github.com/" }),
  ]);
  // Sent there by name, as the name prompt will.
  tide.state = ws.send(tide.state, 1, "mail");
  await tide.apply();
  assert.equal(tide.state.windows[1].ws, "mail");
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://github.com/", focused: true }));
  const after = new Tide(chrome);
  await after.event();
  assert.ok("mail" in after.state.workspaces, "kept for Gmail's window, which isn't back");
  chrome.open(on(HD, 12, { url: "https://mail.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[12].ws, "mail");
  assert.deepEqual(chrome.store.view.bar, ["in", "re", "oc", "me", "mail"]);
});

test("after a restart, a made workspace whose window never came back goes once the wait ends", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://mail.google.com/" }),
    on(HD, 2, { url: "https://github.com/" }),
  ]);
  tide.state = ws.send(tide.state, 1, "mail");
  await tide.apply();
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://github.com/", focused: true }));
  const after = new Tide(chrome);
  await after.event();
  assert.ok("mail" in after.state.workspaces);
  await after.command("focus-next");
  assert.equal("mail" in after.state.workspaces, false);
});

test("after a restart, a window still matches after its page changed with the dim off", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  await tide.command("float");
  chrome.win(1).url = "https://example.net/";
  await tide.tabLoaded(10);
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://example.org/" }));
  chrome.open(on(HD, 12, { url: "https://example.net/", focused: true }));
  const after = new Tide(chrome);
  await after.event();
  assert.equal(after.state.windows[12].floating, true, "it found the floating window by its new page");
});

test("after a restart, a popup tide doesn't manage can't take a window's place", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true, url: "https://mail.google.com/" })]);
  await tide.command("send-3");
  chrome.wins = [];
  chrome.open(on(HD, 11, { type: "popup", url: "https://mail.google.com/" }));
  chrome.open(on(HD, 12, { url: "https://mail.google.com/", focused: true }));
  const after = new Tide(chrome);
  await after.event();
  assert.equal(after.state.windows[12].ws, "oc", "the tab window got Gmail's place");
  assert.equal(11 in after.state.windows, false);
});

test("after a restart, an app popup that comes back late is still the app's", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true, url: "https://github.com/" })]);
  await tide.command("app-calendar");
  await tide.command("send-3");
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://github.com/", focused: true }));
  const after = new Tide(chrome);
  await after.event();
  chrome.open(on(HD, 12, { type: "popup", url: "https://calendar.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[12].ws, "oc", "Calendar went back to oc");
  assert.equal(chrome.win(12).state, "minimized");
  assert.ok(after.state.appPopups.includes(12), "it still tiles as Calendar's");
});

test("after a restart, a first window that matches nothing doesn't end the wait", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true, url: "https://mail.google.com/" })]);
  await tide.command("send-3");
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://example.com/new", focused: true }));
  const after = new Tide(chrome);
  await after.event();
  assert.equal(after.state.windows[11].ws, "in", "the new window joins the showing workspace");
  chrome.open(on(HD, 12, { url: "https://mail.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[12].ws, "oc", "Gmail still went back to oc");
  assert.equal(chrome.win(12).state, "minimized");
});

test("after a restart, a command ends the wait for windows that never came back", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://mail.google.com/" }),
    on(HD, 2, { url: "https://github.com/" }),
  ]);
  await tide.command("send-3");
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://github.com/", focused: true }));
  const after = new Tide(chrome);
  await after.event();
  await after.command("focus-next");
  assert.equal(after.state.restoring, undefined);
  chrome.open(on(HD, 12, { url: "https://mail.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[12].ws, "in", "a window opened later is just new");
});

test("after a restart, a sync before Chrome restores any window keeps them all waiting", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://mail.google.com/" }),
    on(HD, 2, { url: "https://github.com/" }),
  ]);
  await tide.command("send-3");
  // The browser restarts, and the worker wakes before any window is back.
  chrome.wins = [];
  chrome.sessionStore = {};
  const after = new Tide(chrome);
  await after.event();
  assert.equal(after.state.restoring[1].ws, "oc", "Gmail's window waits for its return");
  assert.equal(after.state.restoring[2].ws, "in", "and so does GitHub's");
  chrome.open(on(HD, 21, { url: "https://github.com/", focused: true }));
  chrome.open(on(HD, 22, { url: "https://mail.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[22].ws, "oc", "Gmail went back to oc");
  assert.equal(chrome.win(22).state, "minimized");
  assert.equal(after.state.windows[21].ws, "in");
  assert.equal(after.state.restoring, undefined, "nothing is left waiting");
});

test("closing every window one by one, then opening one, matches nothing", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true, url: "https://mail.google.com/" })]);
  await tide.command("send-3");
  chrome.wins = [];
  await tide.event();
  chrome.open(on(HD, 2, { url: "https://mail.google.com/", focused: true }));
  await tide.event();
  assert.equal(tide.state.windows[2].ws, "in", "a new window joins the workspace showing");
});

test("dragging the master's edge sets the main share, and the stack follows", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  assert.equal(chrome.box(1).w, 1056);
  // You drag the master's right edge to x = 1344, 70% of 1920.
  chrome.win(1).width = 1344;
  await tide.event();
  assert.equal(ws.layoutOf(tide.state, "in", "hd").modes.tile.mfact, 0.7);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1344, h: 1032 });
  assert.deepEqual(chrome.box(2), { x: 1344, y: 0, w: 576, h: 516 });
  assert.deepEqual(chrome.box(3), { x: 1344, y: 516, w: 576, h: 516 });
});

test("dragging a stack window's left edge sets the main share too", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  Object.assign(chrome.win(2), { left: 768, width: 1152 });
  await tide.event();
  assert.equal(ws.layoutOf(tide.state, "in", "hd").modes.tile.mfact, 0.4);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 768, h: 1032 });
});

test("a resize the share can't follow is put back", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  // The master's left edge is the screen's.
  Object.assign(chrome.win(1), { left: 200, width: 856 });
  await tide.event();
  assert.equal(ws.layoutOf(tide.state, "in", "hd").modes.tile.mfact, 0.55);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1056, h: 1032 });
});

test("dragging a lone window's edge keeps its width, centered", async () => {
  const { chrome, tide } = await setup([UW], [on(UW, 1, { focused: true })]);
  // The center is at x = 3640; you drag the right edge to 60% of the width.
  chrome.win(1).width = 4672 - chrome.box(1).x;
  await tide.event();
  assert.deepEqual(chrome.box(1), { x: 1920 + 688, y: 0, w: 2064, h: 1392 });
});

test("dragging a lone window's left edge narrows it about the center", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  Object.assign(chrome.win(1), { left: 192, width: 1728 });
  await tide.event();
  assert.deepEqual(chrome.box(1), { x: 192, y: 0, w: 1536, h: 1032 });
});

test("a lone window's width holds for its workspace whenever it's down to one", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  Object.assign(chrome.win(1), { left: 192, width: 1728 });
  await tide.event();
  chrome.open(on(HD, 2));
  await tide.event();
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1056, h: 1032 }, "a second window tiles as normal");
  chrome.wins = chrome.wins.filter((w) => w.id !== 2);
  await tide.event();
  assert.deepEqual(chrome.box(1), { x: 192, y: 0, w: 1536, h: 1032 }, "alone again, at your width");
  await tide.command("workspace-2");
  chrome.open(on(HD, 9, { focused: true }));
  await tide.event();
  assert.deepEqual(chrome.box(9), { x: 0, y: 0, w: 1920, h: 1032 }, "another workspace keeps the rule");
  // The width outlives the service worker.
  await tide.command("workspace-1");
  const after = new Tide(chrome);
  await after.event();
  assert.deepEqual(chrome.box(1), { x: 192, y: 0, w: 1536, h: 1032 });
});

test("a lone window resized by a change in the work area keeps the rule", async () => {
  const { chrome, tide } = await setup([UW], [on(UW, 1, { focused: true })]);
  chrome.displaysList = [{ ...UW, workArea: { left: 1920, top: 0, width: 3440, height: 1440 } }];
  chrome.win(1).width = 2000;
  await tide.event();
  assert.deepEqual(chrome.box(1), { x: 1920 + 344, y: 0, w: 2752, h: 1440 });
});

test("a floating window's resize leaves the lone window's width", async () => {
  const { chrome, tide } = await setup([UW], [on(UW, 1, { focused: true }), on(UW, 2)]);
  await floatAt(chrome, tide, 2, 2000, 100);
  chrome.win(2).width = 700;
  await tide.event();
  assert.deepEqual(chrome.box(1), { x: 1920 + 344, y: 0, w: 2752, h: 1392 });
});

test("a lone window back from maximized keeps the rule", async () => {
  const { chrome, tide } = await setup([UW], [on(UW, 1, { focused: true })]);
  Object.assign(chrome.win(1), { state: "maximized", left: 1920, width: 3440 });
  await tide.event();
  Object.assign(chrome.win(1), { state: "normal", left: 2000, width: 1500 });
  await tide.event();
  assert.deepEqual(chrome.box(1), { x: 1920 + 344, y: 0, w: 2752, h: 1392 });
});

test("moving a window without resizing it leaves the share", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  Object.assign(chrome.win(2), { left: 900, top: 50 });
  await tide.event();
  assert.equal(ws.layoutOf(tide.state, "in", "hd").modes.tile.mfact, 0.55);
  assert.deepEqual(chrome.box(2), { x: 1056, y: 0, w: 864, h: 1032 });
});

test("a window resized by a change in the work area isn't a drag", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  // The shelf hides, and chromeOS widens the master as it goes.
  chrome.displaysList = [{ ...HD, workArea: { left: 0, top: 0, width: 1920, height: 1080 } }];
  chrome.win(1).width = 1300;
  await tide.event();
  assert.equal(ws.layoutOf(tide.state, "in", "hd").modes.tile.mfact, 0.55);
});

test("a floating window's resize sets nothing", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  await floatAt(chrome, tide, 3, 100, 100);
  chrome.win(3).width = 700;
  await tide.event();
  assert.equal(ws.layoutOf(tide.state, "in", "hd").modes.tile.mfact, 0.55);
});

test("a window back from maximized isn't read as resized", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  Object.assign(chrome.win(1), { state: "maximized", left: 0, width: 1920 });
  await tide.event();
  // chromeOS puts it back somewhere of its own choosing.
  Object.assign(chrome.win(1), { state: "normal", left: 0, width: 1500 });
  await tide.event();
  assert.equal(ws.layoutOf(tide.state, "in", "hd").modes.tile.mfact, 0.55);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1056, h: 1032 });
});

test("without tab search, no tab addresses are kept, even with all sites allowed", async () => {
  const chrome = new FakeChrome({
    displays: [HD],
    windows: [on(HD, 1, { focused: true, url: "https://mail.google.com/" }), on(HD, 2, { url: "https://github.com/" })],
  });
  chrome.grantedPermissions.delete("tabs");
  // All-sites access for dimming lets Chrome show every tab's address.
  chrome.granted = true;
  const tide = new Tide(chrome);
  await tide.event();
  await tide.tabLoaded(20);
  for (const info of Object.values(chrome.store.state.windows)) assert.deepEqual(info.urls, []);
  chrome.grantedPermissions.add("tabs");
  await tide.event();
  assert.deepEqual(chrome.store.state.windows[1].urls, ["https://mail.google.com/"], "kept once tab search is allowed");
});

test("Search+S keeps the display awake until it's pressed again", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  assert.equal(chrome.awake, null, "nothing held at login");
  await tide.command("keep-awake");
  assert.equal(chrome.awake, "display");
  assert.equal(chrome.sessionStore.keepAwake, true, "the dashboard reads it from storage.session");
  assert.equal(chrome.actionTitle, "tide · Keeping awake");
  await tide.command("keep-awake");
  assert.equal(chrome.awake, null);
  assert.equal(chrome.sessionStore.keepAwake, false);
  assert.equal(chrome.actionTitle, "tide · Not keeping awake");
});

test("keep awake starts off in a new browser session", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.command("keep-awake");
  // A restart releases Chrome's request and empties storage.session together.
  chrome.awake = null;
  chrome.sessionStore = {};
  const again = new Tide(chrome);
  await again.command("keep-awake");
  assert.equal(chrome.awake, "display", "the first press turns it on");
});

test("at login, Start at login's addresses open in order, tiled and unfocused", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  chrome.store.settings = { startup: ["https://mail.google.com/", "https://chat.google.com/"] };
  await tide.startAtLogin();
  assert.deepEqual(opened(chrome), [
    { url: "https://mail.google.com/", type: "popup" },
    { url: "https://chat.google.com/", type: "popup" },
  ]);
  const [a, b] = chrome.created.filter((c) => c.url !== HOME).map((c) => c.id);
  assert.deepEqual(tide.state.workspaces.in.windows, [1, a, b], "they join the showing workspace's stack");
  assert.ok(tide.state.appPopups.includes(a) && tide.state.appPopups.includes(b), "they tile as app windows");
  assert.equal(chrome.win(1).focused, true, "none takes focus");
  assert.equal(chrome.box(a).x > 0, true, "tiled beside the window you're in");
});

test("at login with nothing to start, nothing opens", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tide.startAtLogin();
  assert.deepEqual(opened(chrome), []);
});

test("Start at login's windows don't take the places of windows Chrome restores", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true, url: "https://mail.google.com/" })]);
  await tide.command("send-3");
  chrome.store.settings = { startup: ["https://mail.google.com/"] };
  // The browser restarts, and tide starts its list before Chrome restores
  // any window.
  chrome.wins = [];
  chrome.sessionStore = {};
  const after = new Tide(chrome);
  await after.startAtLogin();
  const started = chrome.created.at(-1).id;
  assert.equal(after.state.windows[started].ws, "in", "the started window joins the showing workspace");
  assert.equal(after.state.restoring[1].ws, "oc", "Gmail's old window still waits");
  chrome.open(on(HD, 50, { url: "https://mail.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[50].ws, "oc", "the restored window goes back to oc");
  assert.equal(after.state.windows[started].ws, "in");
});

const CHAT = "https://chat.google.com/room/1";
// Stands in for tide's clock and timer: `fire` runs what's due.
function timed(tide) {
  const pending = [];
  let t = 1_000_000;
  tide.now = () => t;
  tide.later = (f) => pending.push(f);
  return {
    pending,
    tick: (ms) => {
      t += ms;
    },
    fire: async () => {
      for (const f of pending.splice(0)) await f();
    },
  };
}
const close = (chrome, ...ids) => {
  chrome.wins = chrome.wins.filter((w) => !ids.includes(w.id));
};
const pinChat = (chrome, n = "in") => {
  chrome.syncStore.settings = { workspaceSettings: { [n]: { pinnedApps: ["app-chat"] } } };
};

test("a pinned app's window you close reopens on its workspace, taking no focus", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "app", url: CHAT })]);
  const clock = timed(tide);
  pinChat(chrome);
  await tide.event();
  close(chrome, 2);
  await tide.event();
  assert.deepEqual(opened(chrome), [], "not at once, in case the browser is closing");
  await clock.fire();
  assert.deepEqual(opened(chrome), [{ url: "https://chat.google.com/", type: "popup" }], "as its app key opens it");
  const id = chrome.created.at(-1).id;
  assert.equal(tide.state.windows[id].ws, "in");
  assert.deepEqual(tide.state.workspaces.in.windows, [1, id], "tiled at the end of the stack");
  assert.equal(chrome.box(id).x, 1056);
  assert.equal(chrome.win(1).focused, true, "focus stays where it was");
  assert.equal(chrome.win(id).focused, false);
  assert.equal(tide.state.current, "in");
  // The reopened window is the app's, so closing it reopens it again.
  clock.tick(30_000);
  close(chrome, id);
  await tide.event();
  await clock.fire();
  assert.equal(opened(chrome).length, 2);
});

test("a pinned app's window reopens on its hidden workspace without showing it", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "app", url: CHAT })]);
  const clock = timed(tide);
  pinChat(chrome);
  await tide.command("workspace-2");
  close(chrome, 2);
  await tide.event();
  await clock.fire();
  const id = chrome.created.at(-1).id;
  assert.equal(tide.state.windows[id].ws, "in");
  assert.equal(tide.state.current, "re", "your workspace still shows");
  assert.equal(chrome.win(id).state, "minimized", "hidden with its workspace");
});

test("only a pinned app's window reopens", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true }),
    on(HD, 2, { type: "app", url: CALENDAR }),
    on(HD, 3, { type: "app", url: CHAT }),
  ]);
  const clock = timed(tide);
  pinChat(chrome);
  await tide.event();
  chrome.open(on(HD, 4, { focused: true }));
  await tide.event();
  close(chrome, 1, 2);
  await tide.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [], "neither a tab window nor an unpinned app");
  close(chrome, 3);
  await tide.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [{ url: "https://chat.google.com/", type: "popup" }]);
});

test("a pinned app's window closed on another workspace doesn't reopen", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "app", url: CHAT }), on(HD, 3, { type: "app", url: CHAT })]);
  const clock = timed(tide);
  pinChat(chrome);
  chrome.focus(2);
  await tide.event();
  await tide.command("send-2");
  assert.equal(tide.state.windows[2].ws, "re");
  close(chrome, 2);
  await tide.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [], "it was on re, where it isn't pinned");
  close(chrome, 3);
  await tide.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [{ url: "https://chat.google.com/", type: "popup" }], "the one left on in is");
});

test("a pinned app with another window still on its workspace doesn't reopen", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true, type: "app", url: CHAT }), on(HD, 2, { type: "app", url: CHAT })]);
  const clock = timed(tide);
  pinChat(chrome);
  await tide.event();
  close(chrome, 2);
  await tide.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), []);
  chrome.open(on(HD, 5, { focused: true }));
  await tide.event();
  close(chrome, 1);
  await tide.event();
  await clock.fire();
  assert.equal(opened(chrome).length, 1, "the last one does");
});

test("a pinned app's window doesn't reopen as the browser closes", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "app", url: CHAT }), on(HD, 3)]);
  const clock = timed(tide);
  pinChat(chrome);
  await tide.event();
  // Chrome closes its windows one by one.
  close(chrome, 2);
  await tide.event();
  close(chrome, 1);
  await tide.event();
  close(chrome, 3);
  await tide.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [], "every window went before it was due");
  assert.deepEqual(chrome.wins.filter((w) => w.url !== HOME), [], "only a home window is left");
});

test("a pinned app's window closing with every other window doesn't reopen", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "app", url: CHAT })]);
  const clock = timed(tide);
  pinChat(chrome);
  await tide.event();
  close(chrome, 1, 2);
  await tide.event();
  assert.equal(clock.pending.length, 0);
  await clock.fire();
  assert.deepEqual(opened(chrome), []);
});

test("a pinned app's windows don't reopen across a browser restart, and do after", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true, url: "https://github.com/" }), on(HD, 2, { type: "app", url: CHAT }), on(HD, 3, { type: "app", url: CHAT })]);
  pinChat(chrome);
  await tide.event();
  // The browser restarts: Chrome brings back two windows, not the second
  // Chat, which waits.
  chrome.wins = [];
  chrome.sessionStore = {};
  chrome.open(on(HD, 11, { url: "https://github.com/", focused: true }));
  chrome.open(on(HD, 12, { type: "app", url: CHAT }));
  const after = new Tide(chrome);
  const clock = timed(after);
  await after.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [], "nothing reopens while windows come back");
  assert.equal(Object.keys(after.state.restoring ?? {}).length, 1, "one Chat still waits");
  await after.command("focus-next");
  await clock.fire();
  assert.deepEqual(opened(chrome), [], "nor when the wait ends");
  close(chrome, 12);
  await after.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [{ url: "https://chat.google.com/", type: "popup" }], "a close after the restore reopens");
});

test("a pinned app's window doesn't reopen when its display goes", async () => {
  const { chrome, tide } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2, { type: "app", url: CHAT }), on(HD, 3, { type: "app", url: CHAT })]);
  const clock = timed(tide);
  pinChat(chrome);
  await tide.event();
  chrome.displaysList = [HD];
  close(chrome, 2);
  await tide.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [], "it went with the display");
  close(chrome, 3);
  await tide.event();
  await clock.fire();
  assert.equal(opened(chrome).length, 1, "one closed on a display that stays reopens");
});

test("a pinned app that keeps closing stops reopening after three tries", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "app", url: CHAT })]);
  const clock = timed(tide);
  pinChat(chrome);
  await tide.event();
  let last = 2;
  for (let i = 0; i < 4; i++) {
    clock.tick(2_000);
    close(chrome, last);
    await tide.event();
    await clock.fire();
    last = chrome.created.at(-1).id;
  }
  assert.equal(opened(chrome).length, 3, "three reopens, then it stays closed");
  assert.equal(Object.values(tide.state.windows).filter((w) => w.app === "app-chat").length, 0);
  assert.match(warn.mock.calls.at(-1).arguments[0], /app-chat, pinned on in, closed 4 times in 60s; not reopening it again/);
  // Long after, one you open and close comes back again.
  clock.tick(120_000);
  await tide.command("app-chat");
  close(chrome, chrome.created.at(-1).id);
  await tide.event();
  await clock.fire();
  assert.equal(opened(chrome).length, 5);
});

test("closes that reopen nothing don't use up a pinned app's reopens", async () => {
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true }),
    ...[2, 3, 4, 5].map((id) => on(HD, id, { type: "app", url: CHAT })),
  ]);
  const clock = timed(tide);
  pinChat(chrome);
  await tide.event();
  for (const id of [2, 3, 4]) {
    clock.tick(1_000);
    close(chrome, id);
    await tide.event();
    await clock.fire();
  }
  assert.deepEqual(opened(chrome), [], "another Chat was still there each time");
  clock.tick(1_000);
  close(chrome, 5);
  await tide.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [{ url: "https://chat.google.com/", type: "popup" }], "the last one reopens");
});

test("a window's app follows its page with the dim off", async () => {
  const { chrome, tide } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "app", url: CHAT }), on(HD, 3)]);
  const clock = timed(tide);
  pinChat(chrome);
  await tide.event();
  // Chat's window goes to another site, then a tab window to Chat.
  chrome.win(2).url = "https://example.com/";
  await tide.tabLoaded(20);
  close(chrome, 2);
  await tide.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [], "it's no longer Chat");
  chrome.win(3).url = CHAT;
  await tide.tabLoaded(30);
  close(chrome, 3);
  await tide.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [{ url: "https://chat.google.com/", type: "popup" }], "the one that became Chat reopens");
});

test("a browser window with the settings in a tab still keeps a pinned app reopening", async () => {
  const SETTINGS = "chrome-extension://tide/src/options.html";
  const { chrome, tide } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/", moreTabs: [SETTINGS] }),
    on(HD, 2, { type: "app", url: CHAT }),
    on(HD, 3, { url: "https://example.com/" }),
  ]);
  const clock = timed(tide);
  pinChat(chrome);
  await tide.event();
  close(chrome, 2, 3);
  await tide.event();
  await clock.fire();
  assert.deepEqual(opened(chrome), [{ url: "https://chat.google.com/", type: "popup" }], "the settings tab's window is a browser window");
  // With no settings tab at the close, one opened before the reopen is due
  // doesn't stop it.
  delete chrome.win(1).moreTabs;
  await tide.event();
  clock.tick(30_000);
  close(chrome, chrome.created.at(-1).id);
  await tide.event();
  chrome.win(1).moreTabs = [SETTINGS];
  await tide.event();
  await clock.fire();
  assert.equal(opened(chrome).length, 2);
});
