// The extension's service worker. MV3 delivers the event that wakes a
// sleeping worker only to listeners added synchronously when this script
// first runs, so every listener is added here, at the top level, and tileco
// loads its saved state on the first event it handles.
//
// Each listener then waits for the platform (§14.6): only chromeOS tiles.
// Elsewhere the dashboard, launcher, app keys and keep awake still work,
// placing nothing.

import { remind } from "./mouse.js";
import { load as loadSettings, settingsChanged } from "./settings.js";
import { isWatched, serialized, syncWatchers } from "./watchers.js";
import { DIM_ORIGINS, Tileco } from "./tileco.js";
import { actionTitle, platform, TILE, worksUntiled } from "./platform.js";
import { Untiled } from "./untiled.js";
import { checkName } from "./workspaces.js";

const tileco = new Tileco(chrome);
const untiled = new Untiled(chrome);
// Asked afresh each time, which costs Chrome nothing to answer.
const where = () => platform(chrome);
// `f` runs only where `role` is this platform's.
const on = (role, f) => (...args) => where().then((p) => (p.role === role ? f(...args) : undefined));
const tiling = (f) => on(TILE, f);
const changed = tiling(() => tileco.event());
where().then((p) => {
  if (p.role === TILE) return;
  console.info(`tileco: ${actionTitle(p)}`);
  chrome.action.setTitle({ title: actionTitle(p) }).catch((e) => console.error("tileco: couldn't set the toolbar title:", e));
});
// The extra watched sites (§10.3) follow the settings and this Chromebook's
// grants, one update at a time so an older one can't undo a newer one.
const watch = tiling(serialized(() =>
  loadSettings(chrome.storage)
    .then(({ settings }) => syncWatchers(chrome, settings.watched))
    .catch((e) => console.error("tileco: couldn't update the watched sites:", e)),
));
// A title report counts only from a site watched now; in order, so a tab's
// reports reach tileco as they were sent.
const report = serialized((tab, url, title, first) =>
  loadSettings(chrome.storage)
    .then(({ settings }) => {
      if (isWatched(url, settings.watched)) return tileco.title(tab.id, tab.windowId, title, first);
    })
    .catch((e) => console.error("tileco: couldn't take a title report:", e)),
);
const commands = new Set(Object.keys(chrome.runtime.getManifest().commands));

// Off chromeOS a command that would lay out or move a window does nothing,
// and the toolbar's tooltip says why.
const command = (name) => where().then((p) => (p.role === TILE ? tileco.command(name) : untiled.command(name)));
chrome.commands.onCommand.addListener(command);
chrome.windows.onCreated.addListener(changed);
chrome.windows.onRemoved.addListener(changed);
chrome.windows.onFocusChanged.addListener(changed);
chrome.windows.onBoundsChanged.addListener(changed);
chrome.system.display.onDisplayChanged.addListener(changed);
// Startup is a login on chromeOS, after which the mouse lines need running
// again (§19.2).
chrome.runtime.onStartup.addListener(tiling(() => {
  changed();
  watch();
  tileco.startAtLogin().catch((e) => console.error("tileco: couldn't start the login list:", e));
  remind(chrome).catch((e) => console.error("tileco: couldn't open the mouse reminder:", e));
}));
// A new install opens the settings, whose extras each need allowing (§14.1),
// on every platform: off chromeOS they say what tileco does there.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  changed();
  watch();
  if (reason === "install") chrome.runtime.openOptionsPage().catch((e) => console.error("tileco: couldn't open the settings:", e));
});
// A newly active tab needs the dim if its window has it, and so does a
// dimmed tab that loaded a new page.
chrome.tabs.onActivated.addListener(changed);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "complete") tiling(() => tileco.tabLoaded(tabId))();
});
// Granting all-sites access is turning the dim on (§10.1), even if the
// popup that asked closed during the prompt.
chrome.permissions.onAdded.addListener((granted) => {
  tiling(() => {
    if (DIM_ORIGINS.every((o) => granted.origins?.includes(o))) tileco.setDim(true);
    else changed();
    watch();
  })();
});
chrome.permissions.onRemoved.addListener(() => {
  changed();
  watch();
});
// A setting saved on the options page applies at once, not at the next
// window event; tileco's own state writes aren't settings, so don't loop.
chrome.storage.onChanged.addListener((changes) => {
  if (!settingsChanged(changes)) return;
  changed();
  watch();
});
// The toolbar button opens the dashboard, as its key does (§8.1).
chrome.action.onClicked.addListener(() => command("popup"));

// The launcher runs commands too, but only ones the manifest declares, and
// its bar and Workspaces scope show a workspace by name, and Search+Shift+W's
// prompt moves its window to one, but only by a valid name from tileco's own
// pages. Pages on the watched origins report their titles (§10.3). The
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
    const fromTileco = sender.url?.startsWith(chrome.runtime.getURL(""));
    let step = null;
    if (fromTileco && commands.has(message?.command) && worksUntiled(message.command)) step = untiled.command(message.command);
    else if (fromTileco && Number.isInteger(message?.tabId) && Number.isInteger(message?.windowId)) step = untiled.activateTab(message.tabId, message.windowId);
    if (step) step.then(() => respond(true), () => respond(false));
    else respond(false);
  });
  return true;
});

function handle(message, sender, respond) {
  const fromTileco = sender.url?.startsWith(chrome.runtime.getURL(""));
  const done = (p) => {
    p.then(() => respond(true), () => respond(false));
    return true;
  };
  // The launcher waits for each step before it closes itself (§9.4).
  if (commands.has(message?.command)) return done(tileco.command(message.command));
  const valid = (name) => typeof name === "string" && checkName(name).name === name;
  if (fromTileco && valid(message?.workspace)) return done(tileco.workspace(message.workspace));
  if (fromTileco && valid(message?.moveTo)) return done(tileco.moveTo(message.moveTo));
  if (fromTileco && Number.isInteger(message?.tabId) && Number.isInteger(message?.windowId)) {
    return done(tileco.activateTab(message.tabId, message.windowId));
  }
  if (typeof message?.title === "string" && sender.tab) report(sender.tab, sender.url ?? sender.tab.url, message.title, message.first === true);
  else if (typeof message?.dim === "boolean" && fromTileco) {
    tileco.setDim(message.dim).then(() => respond(true), () => respond(false));
    return true;
  }
}
