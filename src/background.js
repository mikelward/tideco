// The extension's service worker. MV3 delivers the event that wakes a
// sleeping worker only to listeners added synchronously when this script
// first runs, so every listener is added here, at the top level, and tide
// loads its saved state on the first event it handles.
//
// Each listener then waits for the platform (§14.6): only chromeOS tiles.
// Elsewhere the dashboard, launcher, app keys and keep awake still work,
// placing nothing, and on Linux the worker also runs tide's tab list.

import { remind } from "./mouse.js";
import { load as loadSettings, settingsChanged } from "./settings.js";
import { isWatched, serialized, syncWatchers } from "./watchers.js";
import { DIM_ORIGINS, Tide } from "./tide.js";
import { actionTitle, platform, TABS, TILE, worksUntiled } from "./platform.js";
import { ACCESS as BRIDGE_ACCESS, TabsBridge } from "./tabsbridge.js";
import { Untiled } from "./untiled.js";
import { checkName } from "./workspaces.js";
import { SECTION_KEY } from "./launcher.js";
import { capture, CHANGES_KEY, LOG_KEY, Recent } from "./recent.js";
import { Reporter } from "./bugreport.js";

// Report a bug's ring buffers (§14.7): the worker's log, every line it
// prints from here on, and each workspace and focus change with its cause.
// A failed write says so on the console's own functions, which record
// nothing, so it can't feed itself.
const own = { warn: console.warn.bind(console) };
const log = new Recent(chrome.storage.session, LOG_KEY, { warn: (...a) => own.warn(...a) });
Object.assign(own, capture(console, log));
const trail = new Recent(chrome.storage.session, CHANGES_KEY, { warn: (...a) => own.warn(...a) });
const reporter = new Reporter(chrome, { log, changes: trail });
console.info("tide: the worker started");

const tide = new Tide(chrome, { trail, reporter });
const untiled = new Untiled(chrome, { reporter });
const bridge = new TabsBridge(chrome);
// Asked afresh each time, which costs Chrome nothing to answer.
const where = () => platform(chrome);
// `f` runs only where `role` is this platform's.
const on = (role, f) => (...args) => where().then((p) => (p.role === role ? f(...args) : undefined));
const tiling = (f) => on(TILE, f);
const tabs = (f) => on(TABS, f);
// A listener for a Chrome event that changes what tide shows, `cause`
// saying which, from the event's own arguments if it's a function.
const changed = (cause) => (...args) => tiling(() => tide.event(typeof cause === "function" ? cause(...args) : cause))();
const tabsChanged = tabs(() => bridge.changed());
where().then((p) => {
  if (p.role === TILE) return;
  console.info(`tide: ${actionTitle(p)}`);
  chrome.action.setTitle({ title: actionTitle(p) }).catch((e) => console.error("tide: couldn't set the toolbar title:", e));
  if (p.role === TABS) bridge.start().catch((e) => console.error("tide: couldn't start tide's tab list:", e));
});
// The extra watched sites (§10.3) follow the settings and this Chromebook's
// grants, one update at a time so an older one can't undo a newer one.
const watch = tiling(serialized(() =>
  loadSettings(chrome.storage)
    .then(({ settings }) => syncWatchers(chrome, settings.watched))
    .catch((e) => console.error("tide: couldn't update the watched sites:", e)),
));
// A title report counts only from a site watched now; in order, so a tab's
// reports reach tide as they were sent.
const report = serialized((tab, url, title, first) =>
  loadSettings(chrome.storage)
    .then(({ settings }) => {
      if (isWatched(url, settings.watched)) return tide.title(tab.id, tab.windowId, title, first);
    })
    .catch((e) => console.error("tide: couldn't take a title report:", e)),
);
const commands = new Set(Object.keys(chrome.runtime.getManifest().commands));

// Off chromeOS a command that would lay out or move a window does nothing,
// and the toolbar's tooltip says why. `via` says what ran it, for Report a
// bug: a key, the toolbar button or the launcher.
const command = (name, via = "key") => where().then((p) => (p.role === TILE ? tide.command(name, via) : untiled.command(name)));
chrome.commands.onCommand.addListener((name) => command(name));
const windowChanged = (cause) => {
  const f = changed(cause);
  return (...args) => {
    f(...args);
    tabsChanged();
  };
};
chrome.windows.onCreated.addListener(windowChanged((w) => `window ${w?.id} opened`));
chrome.windows.onRemoved.addListener(windowChanged((id) => `window ${id} closed`));
// chrome.windows.WINDOW_ID_NONE is -1: no Chrome window has focus.
chrome.windows.onFocusChanged.addListener(windowChanged((id) => (id === -1 ? "focus left Chrome" : `window ${id} took focus`)));
chrome.windows.onBoundsChanged.addListener(changed((w) => `window ${w?.id} moved or resized`));
chrome.system.display.onDisplayChanged.addListener(changed("a display changed"));
// Startup is a login on chromeOS, after which the mouse lines need running
// again (§19.2).
chrome.runtime.onStartup.addListener(tiling(() => {
  changed("Chrome started")();
  watch();
  tide.startAtLogin().catch((e) => console.error("tide: couldn't start the login list:", e));
  remind(chrome).catch((e) => console.error("tide: couldn't open the mouse reminder:", e));
}));
// A new install opens the settings on Extras, whose extras each need
// allowing (§14.1), on every platform: off chromeOS they say what tide does
// there. The page is asked for as Launch asks for one (§9.4).
chrome.runtime.onInstalled.addListener(({ reason }) => {
  changed(`tide was ${reason === "install" ? "installed" : "updated or reloaded"}`)();
  watch();
  if (reason !== "install") return;
  chrome.storage.session
    .set({ [SECTION_KEY]: "extras" })
    .then(() => chrome.runtime.openOptionsPage())
    .catch((e) => console.error("tide: couldn't open the settings on Extras:", e));
});
// A newly active tab needs the dim if its window has it, and so does a
// dimmed tab that loaded a new page.
chrome.tabs.onActivated.addListener(windowChanged((info) => `a tab in window ${info?.windowId} came forward`));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "complete") tiling(() => tide.tabLoaded(tabId))();
  if ("title" in info || "url" in info) tabsChanged();
});
// The rest only tide's tab list needs.
for (const e of ["onCreated", "onRemoved", "onMoved", "onAttached", "onDetached", "onReplaced"]) chrome.tabs[e].addListener(tabsChanged);
// Granting all-sites access is turning the dim on (§10.1), even if the
// popup that asked closed during the prompt.
chrome.permissions.onAdded.addListener((granted) => {
  tiling(() => {
    if (DIM_ORIGINS.every((o) => granted.origins?.includes(o))) tide.setDim(true);
    else changed("access granted")();
    watch();
  })();
  tabs(() => bridge.start())();
});
chrome.permissions.onRemoved.addListener((removed) => {
  changed("access taken away")();
  watch();
  tabs(() => {
    if (BRIDGE_ACCESS.permissions.some((p) => removed.permissions?.includes(p))) return bridge.stop();
  })();
});
// A setting saved on the options page applies at once, not at the next
// window event; tide's own state writes aren't settings, so don't loop.
chrome.storage.onChanged.addListener((changes) => {
  if (!settingsChanged(changes)) return;
  changed("settings changed")();
  watch();
});
// The toolbar button opens the dashboard, as its key does (§8.1).
chrome.action.onClicked.addListener(() => command("popup", "toolbar button"));

// The launcher runs commands too, but only ones the manifest declares, and
// its bar and Workspaces scope show a workspace by name, and Search+Shift+W's
// prompt moves its window to one, but only by a valid name from tide's own
// pages. The overview goes to a window, asked by tide's pages alone. Pages on the watched origins report their titles (§10.3). The
// popup turns the dim on and off, answering once it's done so the popup can
// give back the access only after every page is undimmed.
// Off chromeOS only the launcher's own asks apply, and only those that
// place nothing (§14.6); there's no dim or unread count to act on.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  where().then((p) => {
    if (p.role === TILE) {
      if (!handle(message, sender, respond)) respond(undefined);
      return;
    }
    const fromTide = sender.url?.startsWith(chrome.runtime.getURL(""));
    let step = null;
    if (fromTide && commands.has(message?.command) && worksUntiled(message.command)) step = untiled.command(message.command);
    else if (fromTide && Number.isInteger(message?.tabId) && Number.isInteger(message?.windowId)) step = untiled.activateTab(message.tabId, message.windowId);
    if (step) step.then(() => respond(true), () => respond(false));
    else respond(false);
  });
  return true;
});

function handle(message, sender, respond) {
  const fromTide = sender.url?.startsWith(chrome.runtime.getURL(""));
  const done = (p) => {
    p.then(() => respond(true), () => respond(false));
    return true;
  };
  // The launcher waits for each step before it closes itself (§9.4).
  if (commands.has(message?.command)) return done(tide.command(message.command, "launcher"));
  const valid = (name) => typeof name === "string" && checkName(name).name === name;
  if (fromTide && valid(message?.workspace)) return done(tide.workspace(message.workspace));
  if (fromTide && valid(message?.moveTo)) return done(tide.moveTo(message.moveTo));
  // The overview and the launcher's Attention scope go to a window by its
  // ID (§6.5, §10.3).
  if (fromTide && Number.isInteger(message?.activate)) return done(tide.activateWindow(message.activate));
  if (fromTide && Number.isInteger(message?.tabId) && Number.isInteger(message?.windowId)) {
    return done(tide.activateTab(message.tabId, message.windowId));
  }
  if (typeof message?.title === "string" && sender.tab) report(sender.tab, sender.url ?? sender.tab.url, message.title, message.first === true);
  else if (typeof message?.dim === "boolean" && fromTide) {
    tide.setDim(message.dim).then(() => respond(true), () => respond(false));
    return true;
  }
}
