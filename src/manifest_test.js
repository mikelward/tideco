// Tests for manifest.json and background.js.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Tide } from "./tide.js";
import { FakeChrome, HD } from "./fake_chrome.js";
import { EXTRAS } from "./extras.js";
import { worksUntiled } from "./platform.js";
import { ITEMS } from "./setup.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));

// The keys Chromium accepts for a command (ui/base/accelerators/command.cc).
const KEYS = /^([A-Z0-9]|Comma|Period|Up|Down|Left|Right|Insert|Delete|Home|End|PageUp|PageDown|Space|Tab)$/;

// Chrome and the Web Store refuse a description over 132 characters.
test("the description fits the store's summary", () => {
  assert.ok(manifest.description.length <= 132, `${manifest.description.length} characters`);
});

test("the options page exists and opens in a tab", () => {
  assert.deepEqual(manifest.options_ui, { page: "src/options.html", open_in_tab: true });
  const html = readFileSync(new URL(`../${manifest.options_ui.page}`, import.meta.url), "utf8");
  assert.match(html, /src="optionsview\.js"/);
});

// A PNG's width and height, from its IHDR chunk.
function pngSize(path) {
  const b = readFileSync(new URL(`../${path}`, import.meta.url));
  assert.equal(b.toString("ascii", 1, 4), "PNG", `${path} isn't a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test("every icon the manifest names is a PNG of its size", () => {
  const all = { ...manifest.icons, ...manifest.action.default_icon };
  assert.ok(manifest.icons["128"], "the store needs a 128 px icon");
  for (const [size, path] of Object.entries(all)) assert.deepEqual(pngSize(path), [Number(size), Number(size)], path);
});

// The extension shows itself as tide; tide is only the repo's and the
// code's name, which users never see.
const PAGES = ["src/launcher.html", "src/overview.html", "src/options.html", "src/mouse.html", "src/floatask.html"];
const page = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the name Chrome shows, in chrome://extensions, the toolbar and the shortcuts, is tide", () => {
  assert.equal(manifest.name, "tide");
  assert.equal(manifest.action.default_title, "tide");
  const shown = [manifest.name, manifest.short_name, manifest.description, manifest.action.default_title,
    ...Object.values(manifest.commands).map((c) => c.description)];
  for (const s of shown) assert.doesNotMatch(s ?? "", /tideco/i);
});

test("no page's title or text says tide", () => {
  for (const path of PAGES) {
    const html = page(path);
    assert.match(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "", /^tide\b/, `${path}'s title`);
    // Tag names and attributes hold file names, which keep tide; the text between them is shown.
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]*>/g, " ");
    assert.doesNotMatch(text, /tideco/i, path);
  }
});

test("every page's tab shows tide's logo, at a size the manifest names", () => {
  for (const path of PAGES) {
    const href = /<link rel="icon" href="\.\.\/([^"]+)">/.exec(page(path))?.[1];
    assert.ok(Object.values(manifest.icons).includes(href), `${path}: ${href}`);
  }
});

test("no setup item or extra says tide", () => {
  for (const item of [...EXTRAS, ...ITEMS]) {
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === "string" && key !== "id") assert.doesNotMatch(value, /tideco/i, `${item.id ?? item.title}.${key}`);
    }
  }
});

test("at most four commands suggest a key, as Chromium allows", () => {
  const suggested = Object.values(manifest.commands).filter((c) => c.suggested_key);
  assert.ok(suggested.length <= 4, `${suggested.length} suggest keys`);
});

test("every suggested key is one Chromium can bind, on every platform", () => {
  for (const [name, c] of Object.entries(manifest.commands)) {
    if (!c.suggested_key) continue;
    assert.ok("default" in c.suggested_key, `${name} has no default, so it fails to install off chromeOS`);
    for (const [platform, combo] of Object.entries(c.suggested_key)) {
      const parts = combo.split("+");
      const key = parts.pop();
      assert.match(key, KEYS, `${name} ${platform}: ${combo}`);
      for (const mod of parts) {
        assert.ok(["Ctrl", "Alt", "Shift", "Command", "MacCtrl", "Search"].includes(mod), `${name}: ${mod}`);
        if (mod === "Search") assert.equal(platform, "chromeos", `${name}: Search only works on chromeOS`);
      }
    }
  }
});

// chromeOS turns Search+arrows into Home, End, Page Up and Page Down before
// Chrome sees them, so chrome://extensions/shortcuts refuses them (§7.2).
test("no command's key is a Search+arrow", () => {
  for (const [name, c] of Object.entries(manifest.commands)) {
    const key = /\(([^)]*)\)$/.exec(c.description ?? "")?.[1] ?? "";
    assert.doesNotMatch(key, /^Search\+(Shift\+)?(Left|Right|Up|Down)$/, `${name}: ${key}`);
  }
});

// Frequent actions take Search and one key; Shift is for moving a window,
// as workspace-move does, and for rare actions (§7.3).
test("frequent actions take no modifier but Search, and no two commands share a key", () => {
  const keyOf = (c) => /\(([^)]*)\)$/.exec(c.description ?? "")?.[1] ?? "";
  const frequent = /^(focus-|grow|shrink|master-|monocle|layout-|workspace-(?!move)|popup|attention)/;
  const seen = new Map();
  for (const [name, c] of Object.entries(manifest.commands)) {
    const key = keyOf(c);
    if (frequent.test(name)) assert.match(key, /^Search\+[^+]+$/, `${name}: ${key}`);
    // A command with no key yet is yours to place (§7.1).
    if (key === "") continue;
    assert.ok(!seen.has(key), `${name} and ${seen.get(key)} both take ${key}`);
    seen.set(key, name);
  }
});

// Tiling needs no permission with an install warning; tab access and each
// site's are asked for on the options page (§14.1).
test("every permission with an install warning is optional", () => {
  // power has no install warning, so keep awake (§11) needs no prompt.
  assert.deepEqual(manifest.permissions, ["storage", "system.display", "scripting", "power"]);
  // nativeMessaging is asked for only on Linux, for tide's tab list (§14.6).
  assert.deepEqual(manifest.optional_permissions, ["tabs", "nativeMessaging"]);
  assert.equal(manifest.content_scripts, undefined, "the title watcher is registered once its sites are allowed");
  assert.equal(manifest.host_permissions, undefined);
});

test("all-sites access is optional, for the dim alone", () => {
  assert.deepEqual(manifest.optional_host_permissions, ["<all_urls>"]);
  assert.ok(manifest.permissions.includes("scripting"));
});

test("the dim is switched on and off in the settings, not on the dashboard", () => {
  const page = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
  assert.doesNotMatch(page("launcher.html"), /id="dim"/);
  assert.match(page("options.html"), /id="permissions"/, "the settings list the extras, the dim among them");
  assert.doesNotMatch(page("options.html"), /from the dashboard/);
});

test("every command in the manifest does something", async () => {
  for (const name of Object.keys(manifest.commands)) {
    const chrome = new FakeChrome({
      displays: [HD],
      windows: [
        { id: 1, left: 0, top: 0, width: 400, height: 300, focused: true },
        { id: 2, left: 500, top: 0, width: 400, height: 300 },
      ],
    });
    // Nine workspaces, so Search+9 has one to go to.
    chrome.syncStore.settings = { standing: ["in", "re", "oc", "me", "w5", "w6", "w7", "w8", "w9"] };
    const tide = new Tide(chrome);
    await tide.event();
    // Removing a master needs a second one to remove; going or sending to
    // home, or back a step, needs to start somewhere else; and going to the
    // last workspace needs one shown before.
    if (name === "master-remove") await tide.command("master-add");
    // Search+Tab with nothing marked goes back to the last window you were in.
    if (name === "attention") {
      chrome.focus(2);
      await tide.event();
      chrome.focus(1);
      await tide.event();
    }
    if (name === "workspace-last") {
      await tide.command("workspace-2");
      await tide.command("workspace-1");
    }
    if (name.endsWith("-1") || ["workspace-prev", "send-prev", "workspace-home"].includes(name)) {
      await tide.command("workspace-2");
      chrome.open({ id: 9, left: 0, top: 0, width: 400, height: 300 });
      chrome.focus(9);
      await tide.event();
    }
    const before = JSON.stringify([tide.state, chrome.wins]);
    chrome.updates.length = 0;
    await tide.command(name);
    const after = JSON.stringify([tide.state, chrome.wins]);
    const acted = before !== after || chrome.updates.some((u) => u.focused) || chrome.awake !== null;
    assert.ok(acted, `${name} changed nothing`);
  }
});

// A chrome for background.js: every event keeps its listeners, so a test
// can fire them, and `calls` records what the worker asked Chrome to do.
function workerChrome(os) {
  const listeners = {};
  const calls = [];
  const event = (name) => ({ addListener: (f) => (listeners[name] ??= []).push(f) });
  const call = (name, value) => (...args) => {
    calls.push([name, ...args]);
    return Promise.resolve(value);
  };
  const events = (ns, names) => Object.fromEntries(names.map((n) => [n, event(`${ns}.${n}`)]));
  const chrome = {
    commands: events("commands", ["onCommand"]),
    windows: {
      ...events("windows", ["onCreated", "onRemoved", "onFocusChanged", "onBoundsChanged"]),
      getAll: call("windows.getAll", []),
      update: call("windows.update", {}),
      create: call("windows.create", { id: 99 }),
      remove: call("windows.remove"),
    },
    system: { display: { ...events("system.display", ["onDisplayChanged"]), getInfo: call("system.display.getInfo", [HD]) } },
    tabs: {
      ...events("tabs", ["onActivated", "onUpdated", "onCreated", "onRemoved", "onMoved", "onAttached", "onDetached", "onReplaced"]),
      update: call("tabs.update", {}),
      query: call("tabs.query", []),
    },
    action: { ...events("action", ["onClicked"]), setTitle: call("action.setTitle"), setBadgeText: call("action.setBadgeText"), setBadgeBackgroundColor: call("action.setBadgeBackgroundColor") },
    permissions: { ...events("permissions", ["onAdded", "onRemoved"]), contains: async () => false },
    storage: {
      ...events("storage", ["onChanged"]),
      local: { get: async () => ({}), set: call("storage.local.set") },
      sync: { get: async () => ({}), set: call("storage.sync.set") },
      session: { get: async () => ({}), set: call("storage.session.set"), remove: call("storage.session.remove") },
    },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: call("scripting.registerContentScripts"), unregisterContentScripts: call("scripting.unregisterContentScripts") },
    power: { requestKeepAwake: call("power.requestKeepAwake"), releaseKeepAwake: call("power.releaseKeepAwake") },
    runtime: {
      ...events("runtime", ["onStartup", "onInstalled", "onMessage"]),
      getManifest: () => manifest,
      getURL: (path) => `chrome-extension://tide/${path}`,
      getPlatformInfo: async () => ({ os }),
      openOptionsPage: call("runtime.openOptionsPage"),
    },
  };
  return { chrome, listeners, calls };
}

after(() => delete globalThis.chrome);

// Each import of background.js is a fresh worker.
let workers = 0;
async function startWorker(os) {
  const w = workerChrome(os);
  // The worker reads the global as it runs, not only as it loads.
  globalThis.chrome = w.chrome;
  await import(`./background.js?worker=${++workers}`);
  // Let the platform check and what waits on it finish.
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return w;
}

async function fire(w, name, ...args) {
  const results = (w.listeners[name] ?? []).map((f) => f(...args));
  await Promise.all(results.map((r) => (r === true ? undefined : r)));
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

test("background.js adds every listener while it first runs", async () => {
  const { listeners } = await startWorker("cros");
  assert.deepEqual(Object.keys(listeners).sort(), [
    "action.onClicked",
    "commands.onCommand",
    "permissions.onAdded",
    "permissions.onRemoved",
    "runtime.onInstalled",
    "runtime.onMessage",
    "runtime.onStartup",
    "storage.onChanged",
    "system.display.onDisplayChanged",
    "tabs.onActivated",
    "tabs.onAttached",
    "tabs.onCreated",
    "tabs.onDetached",
    "tabs.onMoved",
    "tabs.onRemoved",
    "tabs.onReplaced",
    "tabs.onUpdated",
    "windows.onBoundsChanged",
    "windows.onCreated",
    "windows.onFocusChanged",
    "windows.onRemoved",
  ]);
});

// Only chromeOS tiles (§14.6): elsewhere no tiling or workspace key, and no
// window event, lays out or moves a window, but the dashboard, its
// launcher, the app keys and keep awake still work.
for (const os of ["linux", "mac", "win"]) {
  test(`on ${os}, nothing tiles, but the dashboard and launcher work`, async () => {
    const w = await startWorker(os);
    const placing = () => w.calls.filter(([name]) => /^(windows\.(update|create|remove)|tabs\.update|scripting\.register)/.test(name));
    for (const name of Object.keys(manifest.commands).filter((n) => !worksUntiled(n))) await fire(w, "commands.onCommand", name);
    await fire(w, "windows.onCreated", { id: 1 });
    await fire(w, "windows.onFocusChanged", 1);
    await fire(w, "system.display.onDisplayChanged");
    await fire(w, "runtime.onStartup");
    assert.deepEqual(placing(), [], "a tiling key or window event placed a window");
    // The toolbar says why the tiling keys do nothing.
    assert.ok(w.calls.some(([name, arg]) => name === "action.setTitle" && /work only on chromeOS/.test(arg.title)));
    // The dashboard opens from its key and the toolbar button.
    await fire(w, "commands.onCommand", "popup");
    const opened = w.calls.filter(([name, arg]) => name === "windows.create" && /launcher\.html\?mode=dashboard/.test(arg?.url));
    assert.equal(opened.length, 1, "the dashboard opens");
    // Its launcher's asks: a workspace one is refused, a tab comes up.
    const launcher = { url: "chrome-extension://tide/src/launcher.html?mode=dashboard" };
    let answer = "none";
    await fire(w, "runtime.onMessage", { command: "workspace-2" }, launcher, (a) => (answer = a));
    assert.equal(answer, false);
    await fire(w, "runtime.onMessage", { workspace: "re" }, launcher, (a) => (answer = a));
    assert.equal(answer, false, "and so is a click on a workspace");
    await fire(w, "runtime.onMessage", { moveTo: "re" }, launcher, (a) => (answer = a));
    assert.equal(answer, false, "and so is the name prompt's move");
    await fire(w, "runtime.onMessage", { tabId: 12, windowId: 3 }, launcher, (a) => (answer = a));
    assert.equal(answer, true);
    assert.deepEqual(w.calls.filter(([name]) => name === "tabs.update"), [["tabs.update", 12, { active: true }]]);
    await fire(w, "runtime.onMessage", { command: "keep-awake" }, launcher, (a) => (answer = a));
    assert.equal(answer, true);
    assert.ok(w.calls.some(([name]) => name === "power.requestKeepAwake"));
  });
}

// A new install opens the settings on Extras (§13, §14.1), asked for as
// Launch asks for a page; an update opens nothing.
test("a new install opens the settings on Extras", async () => {
  const w = await startWorker("cros");
  await fire(w, "runtime.onInstalled", { reason: "update" });
  assert.equal(w.calls.some(([name]) => name === "runtime.openOptionsPage"), false);
  await fire(w, "runtime.onInstalled", { reason: "install" });
  const asked = w.calls.findIndex(([name, arg]) => name === "storage.session.set" && arg?.settingsSection === "extras");
  const opened = w.calls.findIndex(([name]) => name === "runtime.openOptionsPage");
  assert.ok(asked >= 0, "Extras is asked for");
  assert.ok(opened > asked, "before the page opens");
});

test("on chromeOS, a key still tiles", async () => {
  const w = await startWorker("cros");
  assert.ok(!w.calls.some(([name]) => name === "action.setTitle"), "chromeOS keeps the manifest's title");
  await fire(w, "commands.onCommand", "popup");
  assert.ok(w.calls.some(([name]) => name === "windows.create"), "the dashboard opens");
});

// The bar's click shows a workspace by name (§8.1), asked by tide's own
// pages alone, and only by a valid name.
test("on chromeOS, the bar shows a workspace by name, asked by tide's pages only", async () => {
  const w = await startWorker("cros");
  const badges = () => w.calls.filter(([name]) => name === "action.setBadgeText").map(([, arg]) => arg.text);
  const launcher = { url: "chrome-extension://tide/src/launcher.html?mode=dashboard" };
  const site = { url: "https://example.com/", tab: { id: 5, windowId: 6, url: "https://example.com/" } };
  let answer = "none";
  await fire(w, "runtime.onMessage", { workspace: "oc" }, site, (a) => (answer = a));
  assert.equal(answer, undefined, "a website can't");
  await fire(w, "runtime.onMessage", { workspace: 'o"c' }, launcher, (a) => (answer = a));
  assert.equal(answer, undefined, "nor a name that isn't one");
  assert.ok(!badges().includes("oc"));
  await fire(w, "runtime.onMessage", { workspace: "oc" }, launcher, (a) => (answer = a));
  assert.equal(answer, true);
  assert.equal(badges().at(-1), "oc");
});

// Search+Shift+W's prompt moves its window by name (§6.1), asked by
// tide's own pages alone, and only by a valid name.
test("on chromeOS, the name prompt's move is asked by tide's pages only, by a valid name", async () => {
  const w = await startWorker("cros");
  const launcher = { url: "chrome-extension://tide/src/launcher.html?mode=dashboard&scope=workspaces&move=1" };
  const site = { url: "https://example.com/", tab: { id: 5, windowId: 6, url: "https://example.com/" } };
  let answer = "none";
  await fire(w, "runtime.onMessage", { moveTo: "notes" }, site, (a) => (answer = a));
  assert.equal(answer, undefined, "a website can't");
  for (const bad of ['o"c', " notes", "", "x".repeat(33), 7]) {
    answer = "none";
    await fire(w, "runtime.onMessage", { moveTo: bad }, launcher, (a) => (answer = a));
    assert.equal(answer, undefined, `nor a name that isn't one: ${JSON.stringify(bad)}`);
  }
  // A valid name reaches tide, which has no prompt's window to move here.
  await fire(w, "runtime.onMessage", { moveTo: "notes" }, launcher, (a) => (answer = a));
  assert.equal(answer, false);
});

// tide for Linux and macOS put the overview on Super+W for now, but here
// Search+W is the name prompt, so the overview has no key yet (§6.5, §7.1).
test("the overview is a command with no key yet, and Search+W stays the name prompt", () => {
  const c = manifest.commands.overview;
  assert.equal(c.description, "Overview of every workspace's windows");
  assert.equal(c.suggested_key, undefined);
  assert.equal(/\(([^)]*)\)$/.exec(c.description), null, "no key in its description");
});

// The overview goes to a window by its ID (§6.5), asked by tide's pages
// alone.
test("on chromeOS, the overview's window is asked for by tide's pages only", async () => {
  const w = await startWorker("cros");
  const overview = { url: "chrome-extension://tide/src/overview.html" };
  const site = { url: "https://example.com/", tab: { id: 5, windowId: 6, url: "https://example.com/" } };
  let answer = "none";
  await fire(w, "runtime.onMessage", { activate: 7 }, site, (a) => (answer = a));
  assert.equal(answer, undefined, "a website can't");
  await fire(w, "runtime.onMessage", { activate: "7" }, overview, (a) => (answer = a));
  assert.equal(answer, undefined, "nor by anything but an ID");
  await fire(w, "runtime.onMessage", { activate: 7 }, overview, (a) => (answer = a));
  assert.equal(answer, true, "a window tide doesn't know changes nothing");
});

test("the two name prompt commands are in the manifest, with their keys", () => {
  assert.equal(manifest.commands["workspace-go"].description, "Go to a workspace by name (Search+W)");
  assert.equal(manifest.commands["workspace-move"].description, "Move the window to a workspace by name (Search+Shift+W)");
});
