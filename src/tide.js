// tide's core: it reads Chrome's windows and displays, applies an operation
// to the workspace state, and makes the screen match (SPEC.md §5, §6).
// `api` is `chrome` in the extension and a fake in the tests; only its
// promise-returning calls are used.

import { appOf, appOfUrl, DEFAULT_APPS, homeAppOf } from "./apps.js";
import { DEFAULT_SETTINGS, load as loadSettings, workspaceSetting } from "./settings.js";
import { overlay } from "./dim.js";
import { toggle as toggleKeepAwake } from "./keepawake.js";
import { matchWindows, windowUrls } from "./restart.js";
import * as geometry from "./geometry.js";
import { unreadCount } from "./unread.js";
import * as ws from "./workspaces.js";

// Window types tide manages. Popups and devtools float untracked (§5.4),
// except the app popups tide opens itself (§9.1) and Secure Shell's.
const MANAGED = ["normal", "app"];
const TILED_POPUP_ORIGINS = [
  // Secure Shell opens its terminals as popup windows (§6.4).
  "chrome-extension://iodihamcpbpeioajjeobimgagajmlibd/",
];

// Whether tide manages `w`. Always-on-top windows (Document
// picture-in-picture, always-on-top popups) refuse minimizing, so they're
// left alone on every workspace (§5.4), as is any window that refused once.
function managed(w, appPopups, refused) {
  if (w.alwaysOnTop || refused.has(w.id)) return false;
  if (MANAGED.includes(w.type) || appPopups.has(w.id)) return true;
  const url = w.tabs?.[0]?.url ?? "";
  return w.type === "popup" && TILED_POPUP_ORIGINS.some((o) => url.startsWith(o));
}
// The windows a new one on a workspace that asks for a name asks a
// workspace for (§6.1): tab windows
// and installed web apps' own. Popups and dialogs never ask, nor do the app
// popups tide opens itself.
const ASKING = ["normal", "app"];

// Whether `w` may ask for a workspace by its kind. chromeOS's system apps
// (Settings, Files, Camera) report as `app` too, on a `chrome://` page, so an
// app window asks only when its page is a website. Without tab search
// Chrome hides the address, so none can tell, and none asks. One still
// loading its first page has only the address it's going to.
function asksByKind(w) {
  if (!ASKING.includes(w.type)) return false;
  if (w.type !== "app") return true;
  const tab = w.tabs?.find((t) => t.active);
  return /^https?:/.test(tab?.url || tab?.pendingUrl || "");
}

const STATE_KEY = "state";
const VIEW_KEY = "view";
// In storage.session, which a browser restart empties: whether this browser
// session has had a window yet.
const SEEN_KEY = "seenWindow";
export const DIM_ORIGINS = ["<all_urls>"];
const BADGE = "#3584e4";
const BADGE_ATTENTION = "#e5a50a";
// A pinned app's window you close comes back (§6.1) this long after, once
// the close is plainly not the browser going, which ends the worker first.
const REOPEN_DELAY = 1000;
// It comes back at most this many times on a workspace in this span, so a
// site that keeps closing itself doesn't loop.
export const REOPEN_LIMIT = 3;
export const REOPEN_SPAN = 60_000;

function area(display) {
  const a = display.workArea;
  return { x: a.left, y: a.top, w: a.width, h: a.height };
}

// The display holding a window's center, else the first.
export function displayFor(win, displays) {
  const cx = win.left + win.width / 2;
  const cy = win.top + win.height / 2;
  const hit = displays.find((d) => {
    const b = d.bounds;
    return cx >= b.left && cx < b.left + b.width && cy >= b.top && cy < b.top + b.height;
  });
  return (hit || displays[0]).id;
}

export class Tide {
  constructor(api) {
    this.apps = DEFAULT_APPS;
    this.api = api;
    this.settings = DEFAULT_SETTINGS;
    this.state = null;
    this.displays = [];
    this.windows = new Map();
    this.queue = Promise.resolve();
    // The clock and the timer, which the tests replace.
    this.now = () => Date.now();
    this.later = (f, ms) => setTimeout(f, ms);
    // When each pinned app came back on each workspace, by "ws\napp".
    this.reopens = new Map();
  }

  // Run one step at a time: events arrive faster than Chrome answers, and
  // each step reads what the one before it did.
  run(step) {
    const done = this.queue.then(step);
    this.queue = done.catch((e) => console.error("tide:", e));
    return done;
  }

  // Something changed outside tide: a window opened, closed, moved or took
  // focus, or a display came or went.
  event() {
    return this.run(async () => {
      await this.sync();
      await this.apply();
    });
  }

  // A watched page's title changed (§10.3): a rising unread count marks its
  // window, unless you're already in it. A page's first report only sets the
  // baseline, so loading one with old unread mail marks nothing, even in a
  // tab that showed fewer before.
  title(tabId, windowId, title, first = false) {
    return this.run(async () => {
      await this.sync();
      const s = this.state;
      const count = unreadCount(title);
      const before = first ? Infinity : (s.unread[tabId]?.count ?? Infinity);
      s.unread[tabId] = { windowId, count };
      const w = this.windows.get(windowId);
      if (count > before && w && !w.focused) {
        s.marks = [...s.marks.filter((id) => id !== windowId), windowId];
        await this.api.windows.update(windowId, { drawAttention: true });
      }
      await this.apply();
    });
  }

  // The dim is on while tide holds all-sites access (§10.1) and you haven't
  // turned it off. Turning it off comes here first, to undim every page
  // while tide can still reach them, then gives the access back.
  setDim(on) {
    return this.run(async () => {
      await this.sync();
      this.state.dimPaused = !on;
      await this.apply();
    });
  }

  // A tab finished loading a page. Any overlay went with the old page, and
  // the new one may be reachable where the old wasn't (a new tab page
  // becoming a website), so forget the tab and look at the dim afresh.
  tabLoaded(tabId) {
    // With the dim off there's nothing to dim, so skip the sync, but the
    // window's URLs still changed, and a restart matches by them (§14.2).
    if (this.state && !this.dimOn()) return this.run(() => this.rememberUrls());
    return this.run(async () => {
      await this.sync();
      this.state.dimmed = (this.state.dimmed ?? []).filter((id) => id !== tabId);
      await this.apply();
    });
  }

  async rememberUrls() {
    this.tabsAllowed = await this.api.permissions.contains({ permissions: ["tabs"] });
    const all = await this.api.windows.getAll({ populate: true, windowTypes: [...MANAGED, "popup"] });
    for (const w of all) {
      if (!(w.id in this.state.windows)) continue;
      this.state.windows[w.id].urls = this.urlsOf(w);
      this.rememberApp(this.state.windows[w.id], w);
    }
    await this.save();
  }

  // Window `w`'s app, kept in its `info` for when it closes, which leaves
  // no tabs to read (§6.1). Without its address, it stays what it was.
  rememberApp(info, w) {
    const tab = w.tabs?.find((t) => t.active) ?? w.tabs?.[0];
    if (!tab?.url && !tab?.pendingUrl) return;
    const app = appOf(w, this.apps)?.command;
    if (app) info.app = app;
    else delete info.app;
  }

  // The tab addresses kept for a restart (§14.2), only with tab search
  // allowed: all-sites access for dimming, or a site's for unread counts,
  // shows Chrome's tabs' addresses too, but that's not the opt-in.
  urlsOf(w) {
    return this.tabsAllowed ? windowUrls(w) : [];
  }

  dimOn() {
    return this.dimGranted && !this.state.dimPaused;
  }

  command(name) {
    return this.run(async () => {
      await this.sync();
      this.restored();
      const focus = await this.perform(name);
      await this.apply(focus);
    });
  }

  // A click on the bar's workspace `name` (§8.1): it shows on every
  // display, made if it's new.
  workspace(name) {
    return this.run(async () => {
      await this.sync();
      this.restored();
      await this.apply(this.showWorkspace(this.focusedDisplay(), name));
    });
  }

  // Enter in Search+Shift+W's prompt (§6.1): the window the dashboard opened
  // over moves to workspace `name`, made if it's new, which then shows with
  // that window focused, as tide's Super+Shift+Return. Home takes any
  // window. Only the prompt's own dashboard can ask: no other has a window
  // to move.
  moveTo(name) {
    return this.run(async () => {
      await this.sync();
      this.restored();
      const s = this.state;
      const id = s.moving;
      if (id === undefined || !(id in s.windows)) throw new Error(`no window to move to ${name}: the prompt that asked has gone`);
      this.state = ws.send(s, id, name);
      this.showWorkspace(this.focusedDisplay(), this.state.windows[id].ws);
      await this.apply(this.activate(id));
    });
  }

  // A key or a click means the browser has finished restoring (§14.2), so
  // the workspaces kept for windows that never came back can go.
  restored() {
    if (!this.state.restoring) return;
    delete this.state.restoring;
    this.state = ws.prune(this.state);
  }

  // Whether window `w`, as a sync saw it, is one of home's apps' (§6.1), by
  // its tab's site.
  homeApp(w) {
    return homeAppOf(w, this.apps, this.settings.homeApps) !== null;
  }

  // Whether a new window on workspace `n` asks for a workspace, by its
  // askForName (§6.1): home alone, unless workspaceSettings says otherwise.
  asksOn(n) {
    return workspaceSetting(this.settings, n).askForName;
  }

  // A new window joins the workspace showing where it opened, or home if
  // it's one of home's apps, there or not, as a send (§6.1). One that lands
  // otherwise on a workspace that asks for a name, and may `ask`, is marked
  // to ask for a workspace the first time it's focused. `to` names the
  // workspace it joins instead, as a pinned app's reopened window does.
  join(s, id, display, { homeApp = false, ask = false, to = null } = {}) {
    if (id in s.windows) return s;
    const joined = ws.addWindow(s, id, display, { to: homeApp ? ws.home(s) : to });
    if (ask && !homeApp && this.asksOn(joined.windows[id].ws)) joined.windows[id].ask = true;
    return joined;
  }

  // The windows waiting for a name prompt, in the order they asked (§6.1):
  // those still on a workspace that asks, then the focused window if it's
  // marked to ask and still on one. The mark goes at its first focus, so
  // each window asks once, and a prompt closed or answered isn't asked
  // again.
  asking(s, before, wins) {
    const waiting = (before?.asking ?? []).filter((id) => id in s.windows && this.asksOn(s.windows[id].ws));
    const f = wins.find((w) => w.focused && w.state !== "minimized");
    const info = f && s.windows[f.id];
    if (info?.ask) {
      delete info.ask;
      if (this.asksOn(info.ws) && !this.homeApp(f) && !waiting.includes(f.id)) waiting.push(f.id);
    }
    return waiting;
  }

  // The next waiting window's name prompt, once no dashboard is open, as
  // one prompt at a time (§6.1): Search+Shift+W's, on the window's display,
  // the field starting as the window's short name.
  async ask() {
    const s = this.state;
    if (s.dashboard !== undefined) return;
    while (s.asking?.length > 0) {
      const id = s.asking.shift();
      const w = this.all.get(id);
      if (!this.windows.has(id) || !w || !(id in s.windows) || !this.asksOn(s.windows[id].ws) || this.homeApp(w)) continue;
      // A new tab page's title, "New Tab", names nothing.
      const tab = w.tabs?.find((t) => t.active);
      const name = /^https?:/.test(tab?.url ?? "") ? ws.shortName(tab.title) : "";
      const display = s.windows[id].display;
      await this.dashboard(this.displays.some((d) => d.id === display) ? display : this.focusedDisplay(), "move", id, name);
      return;
    }
  }

  // A state stored before workspaces had names takes them here (§6.1).
  async load() {
    if (this.state) return;
    const stored = await this.api.storage.local.get(STATE_KEY);
    this.state = ws.migrate(stored[STATE_KEY] || null, this.settings.standing);
  }

  async save() {
    await this.api.storage.local.set({ [STATE_KEY]: this.state, [VIEW_KEY]: this.view() });
  }

  // What the dashboard and home window show: the workspaces in bar order,
  // which of them are made, the workspace showing, each display's layout of
  // it, how many
  // windows each workspace holds, and which hold a marked window, all by
  // name.
  view() {
    const s = this.state;
    const displays = {};
    for (const d of this.displays) {
      const n = ws.showing(s, d.id);
      displays[d.id] = { workspace: n, mode: n === null ? null : this.modeOf(n, d) };
    }
    const bar = ws.barOrder(s);
    const counts = Object.fromEntries(bar.map((n) => [n, Object.hasOwn(s.workspaces, n) ? s.workspaces[n].windows.length : 0]));
    const urgent = [...new Set(s.marks.map((id) => s.windows[id]?.ws).filter((n) => n !== undefined))];
    return { focusedDisplay: this.focusedDisplay() ?? null, current: s.current, displays, bar, made: [...s.made], counts, urgent, dim: this.dimOn() };
  }

  // Bring the state up to date with Chrome: displays, new and closed
  // windows, and what you did to windows yourself since the last step.
  async sync() {
    // The options page reports bad settings; here the defaults stand in.
    // Before loading the state, whose migration names home from them.
    this.settings = (await loadSettings(this.api.storage)).settings;
    this.apps = this.settings.apps;
    await this.load();
    this.displays = await this.api.system.display.getInfo();
    // Before matching windows after a restart, which reads their addresses.
    this.tabsAllowed = await this.api.permissions.contains({ permissions: ["tabs"] });
    const ids = this.displays.map((d) => d.id);
    // Every window type, so a focused popup or devtools window still says
    // which display you're on, but only managed ones are tracked.
    const all = await this.api.windows.getAll({ populate: true, windowTypes: [...MANAGED, "popup", "devtools"] });
    this.seenWindow ??= Boolean((await this.api.storage.session.get(SEEN_KEY))[SEEN_KEY]);
    // The state as the last step left the screen, before displays changed,
    // with windows renamed if the browser restarted.
    const { state: before, renamed, waiting } = this.restarted(this.state, all);
    if (all.length > 0 && !this.seenWindow) {
      await this.api.storage.session.set({ [SEEN_KEY]: true });
      this.seenWindow = true;
    }
    const standing = this.settings.standing;
    let s = before ? ws.setDisplays(ws.setStanding(before, standing), ids) : ws.create(ids, standing);
    // Workspaces from before this setting existed began with the defaults.
    const modes = { ...ws.DEFAULT_MODE_SETTINGS, ...this.settings.modes };
    if (JSON.stringify(s.modesFrom ?? ws.DEFAULT_MODE_SETTINGS) !== JSON.stringify(modes)) s = ws.setModes(s, modes);
    const appPopups = new Set((before?.appPopups ?? []).map(Number));
    const refused = new Set((before?.refused ?? []).filter((id) => all.some((w) => w.id === id)));
    const wins = all.filter((w) => managed(w, appPopups, refused));
    this.windows = new Map(wins.map((w) => [w.id, w]));
    this.all = new Map(all.map((w) => [w.id, w]));
    this.activeTab = new Map(all.map((w) => [w.id, w.tabs?.find((t) => t.active)?.id]));
    this.tabWindow = new Map(all.flatMap((w) => (w.tabs ?? []).map((t) => [t.id, w.id])));
    this.dimGranted = await this.api.permissions.contains({ origins: DIM_ORIGINS });
    for (const id of Object.keys(s.windows).map(Number)) {
      if (!this.windows.has(id)) s = ws.removeWindow(s, id);
    }
    // After every step the screen matches the state, so a mismatch now is
    // something you did. Judge each window against the state the last step
    // left, before any display came or went and before this sync changed
    // anything, so neither a new display nor one restore that brings a
    // workspace makes other windows look minimized or restored.
    // A tiled window you resized, the first if there are several.
    let resized = null;
    // A new window asks for a workspace only once tide knows the rest, and
    // not while a restart brings windows back (§14.2), which aren't new.
    const asks = before !== null && renamed.size === 0 && Object.keys(waiting).length === 0;
    const closed = this.closedPinned(before, all, ids, renamed, waiting);
    for (const w of wins) {
      // Chrome restores a restarted window as it likes; tide puts it back.
      if (renamed.has(w.id)) {
        if (w.focused) s = ws.focused(s, w.id);
        continue;
      }
      // A window from a state stored before workspaces spanned displays
      // belongs to the display it's on.
      if (w.id in s.windows && s.windows[w.id].display == null) s.windows[w.id].display = displayFor(w, this.displays);
      if (!(w.id in s.windows) || !before || !(w.id in before.windows)) {
        const ask = asks && asksByKind(w) && !appPopups.has(w.id);
        s = this.join(s, w.id, displayFor(w, this.displays), { homeApp: this.homeApp(w), ask });
        // A window already minimized when tide first sees it stays so.
        if (w.state === "minimized") s = ws.userMinimized(s, w.id);
        if (w.focused) s = ws.focused(s, w.id);
        continue;
      }
      const minimized = w.state === "minimized";
      const shouldShow = ws.isShown(before, w.id);
      if (minimized && shouldShow) s = ws.userMinimized(s, w.id);
      // Before the first sync of a state from when each display showed its
      // own workspace, the others' windows are still up, and not by you.
      else if (!minimized && !shouldShow && !before.spanned) s = ws.userRestored(s, w.id);
      else if (!minimized) {
        // A window you moved is on another display than when tide last
        // looked, maximized or not. One chromeOS moved off a display that's
        // gone wasn't moved by you, and nor is one tide is handing back:
        // that one is still where it was, until tide places it, which
        // waits while it's maximized.
        const was = before.windows[w.id].display;
        const last = before.windows[w.id].on ?? was;
        const d = displayFor(w, this.displays);
        if (last !== null && ids.includes(last) && last !== d) s = ws.movedToDisplay(s, w.id, d);
        else if (w.state === "normal" && was === d && last === d && s.windows[w.id]?.display === was) resized ??= this.resized(before, w, d);
      }
      if (w.focused) s = ws.focused(s, w.id);
    }
    if (resized?.singleWidth !== undefined) s = ws.setSingleWidth(s, resized.n, resized.display, resized.singleWidth);
    else if (resized) s = ws.setMfact(s, resized.n, resized.display, resized.mode, resized.mfact);
    delete s.spanned;
    s.asking = this.asking(s, before, wins);
    s.appPopups = [...appPopups].filter((id) => this.windows.has(id));
    s.refused = [...refused];
    if (Object.keys(waiting).length > 0) s.restoring = waiting;
    else if (s.restoring) {
      delete s.restoring;
      s = ws.prune(s);
    }
    // What a window is, should the browser restart and renumber it.
    for (const w of wins) {
      if (!(w.id in s.windows)) continue;
      s.windows[w.id].urls = this.urlsOf(w);
      s.windows[w.id].type = w.type;
      this.rememberApp(s.windows[w.id], w);
    }
    // A mark clears when you go to its window, or it closes.
    s.marks = (before?.marks ?? []).filter((id) => this.windows.has(id) && !this.windows.get(id).focused);
    s.unread = Object.fromEntries(
      Object.entries(before?.unread ?? {}).filter(([, u]) => this.all.has(u.windowId)),
    );
    // The dashboard closes itself after a choice, or when you click away.
    // While it's open it remembers what it opened for, and the window
    // Search+Shift+W's would move.
    if (before?.dashboard !== undefined && this.all.has(before.dashboard)) {
      s.dashboard = before.dashboard;
      for (const key of ["dashboardFor", "moving"]) {
        if (before[key] !== undefined) s[key] = before[key];
        else delete s[key];
      }
    } else {
      delete s.dashboard;
      delete s.dashboardFor;
      delete s.moving;
    }
    s.homes = {};
    for (const [d, id] of Object.entries(this.state?.homes ?? {})) {
      if (!this.all.has(id)) continue;
      if (ids.includes(d)) s.homes[d] = id;
      // chromeOS moves a gone display's home onto another, where nothing
      // would ever close it.
      else await this.api.windows.remove(id);
    }
    this.state = s;
    for (const c of closed) this.reopenLater(c);
  }

  // The pinned apps' windows you closed since the last sync (§6.1): each
  // one of its workspace's pinnedApps, by the app the last sync saw in it,
  // closed on that workspace. None while a restart brings windows back
  // (§14.2), when no window but tide's own is left, as when the browser
  // closes, or when a
  // display went, taking its windows' places with it.
  closedPinned(before, all, ids, renamed, waiting) {
    if (!before || before.restoring || renamed.size > 0 || Object.keys(waiting).length > 0) return [];
    if (!all.some((w) => !this.ours(w))) return [];
    if ((before.present ?? []).some((d) => !ids.includes(d))) return [];
    const out = [];
    for (const [key, info] of Object.entries(before.windows)) {
      const id = Number(key);
      if (all.some((w) => w.id === id) || !info.app || !ids.includes(info.display)) continue;
      if (workspaceSetting(this.settings, info.ws).pinnedApps.includes(info.app)) out.push({ app: info.app, n: info.ws, display: info.display });
    }
    return out;
  }

  // Whether window `w` holds only tide's own pages, as a home window or
  // the dashboard does. A browser window with the settings in one of its
  // tabs is still a browser window.
  ours(w) {
    const prefix = this.api.runtime.getURL("");
    const tabs = w.tabs ?? [];
    return tabs.length > 0 && tabs.every((t) => (t.url || t.pendingUrl || "").startsWith(prefix));
  }

  // Reopen a pinned app's closed window shortly.
  reopenLater(c) {
    this.later(() => this.reopen(c).catch((e) => console.error(`tide: couldn't reopen ${c.app} on ${c.n}:`, e)), REOPEN_DELAY);
  }

  // A pinned app's window back on workspace `n` and `display`, as its app
  // key opens it but taking no focus, so neither focus nor the workspace
  // showing changes. Not if, since it closed, every window but tide's
  // own has gone (the browser closing), a restart began, the display went,
  // the pin came out, or the workspace has a window of that app again. Nor
  // once it has come back REOPEN_LIMIT times there in the last
  // REOPEN_SPAN: a site that keeps closing itself then stays closed, said
  // in the log. Only a window reopened counts toward that.
  reopen({ app: command, n, display }) {
    return this.run(async () => {
      await this.sync();
      const s = this.state;
      const app = this.apps.find((a) => a.command === command);
      const d = this.displays.find((x) => x.id === display);
      if (![...this.all.values()].some((w) => !this.ours(w)) || s.restoring || !app?.url || !d) return;
      if (!workspaceSetting(this.settings, n).pinnedApps.includes(command)) return;
      const there = ws.lookup(s, n);
      if (Object.values(s.windows).some((info) => info.ws === there && info.app === command)) return;
      const key = `${n}\n${command}`;
      const now = this.now();
      const times = (this.reopens.get(key) ?? []).filter((t) => now - t < REOPEN_SPAN);
      this.reopens.set(key, times);
      if (times.length >= REOPEN_LIMIT) {
        console.warn(`tide: ${command}, pinned on ${n}, closed ${times.length + 1} times in ${REOPEN_SPAN / 1000}s; not reopening it again`);
        return;
      }
      times.push(now);
      const a = d.workArea;
      const w = await this.open({ url: app.url, type: "popup", focused: false, left: a.left, top: a.top }, display, { to: n });
      this.state.appPopups.push(w.id);
      this.state.windows[w.id].app = command;
      await this.apply();
    });
  }

  // A browser restart gives every window a new ID, so none of the stored
  // ones exist any more; closing windows one by one never does that, since
  // each sync forgets the closed ones. Then each new window takes the place
  // of the old one it shares the most tab URLs with (§14.2). Chrome may
  // bring the windows back over several events, so the old ones nothing
  // matched yet wait in `restoring` for the next sync, until your first
  // command says the restore is over. Returns the state to judge this sync
  // by, the new IDs that were matched, and the old windows still waiting.
  restarted(stored, all) {
    const none = { state: stored, renamed: new Set(), waiting: {} };
    if (!stored) return none;
    const oldIds = Object.keys(stored.windows).map(Number);
    const present = (id) => all.some((w) => w.id === id);
    let state = stored;
    let candidates = all;
    let waiting;
    if (oldIds.length > 0 && !oldIds.some(present)) {
      // An app popup keeps saying so while it waits.
      const appPopups = new Set((stored.appPopups ?? []).map(Number));
      waiting = Object.fromEntries(
        Object.entries(stored.windows).map(([id, info]) => [id, { ...info, appPopup: appPopups.has(Number(id)) }]),
      );
    } else if (stored.restoring) {
      // Put the waiting windows back on their workspaces, and match only
      // windows tide hasn't seen.
      state = structuredClone(stored);
      for (const [id, { appPopup, ...info }] of Object.entries(stored.restoring)) {
        // A waiting window keeps its workspace from going (§6.1), but one
        // from a state that lost it goes home.
        const n = Object.hasOwn(state.workspaces, info.ws) ? info.ws : ws.home(state);
        state.windows[id] = { ...info, ws: n };
        state.workspaces[n].windows.push(Number(id));
      }
      waiting = stored.restoring;
      candidates = all.filter((w) => !(w.id in stored.windows));
    } else {
      return none;
    }
    // Each kind of window only takes the place of its own kind, so a popup
    // tide doesn't manage can't take a tab window's place.
    const renames = new Map();
    for (const type of new Set(Object.values(waiting).map((info) => info.type))) {
      const old = Object.fromEntries(
        Object.entries(waiting).filter(([, info]) => info.type === type).map(([id, info]) => [id, info.urls]),
      );
      const current = candidates.filter((w) => w.type === type).map((w) => ({ id: w.id, urls: this.urlsOf(w) }));
      for (const [from, to] of matchWindows(old, current)) renames.set(from, to);
    }
    // A window that matches nothing doesn't end the wait for the rest. No
    // window at all is the browser starting before Chrome restores any, or,
    // once this browser session has had one, you closing them all, when
    // nothing waits.
    if (renames.size === 0 && !stored.restoring && all.length === 0 && this.seenWindow) return none;
    state = ws.renameWindows(state, renames);
    state.appPopups = [
      ...(stored.appPopups ?? []).filter((id) => present(Number(id))),
      ...[...renames].filter(([from]) => waiting[from].appPopup).map(([, to]) => to),
    ];
    const left = Object.fromEntries(Object.entries(waiting).filter(([id]) => !renames.has(Number(id))));
    // The windows still waiting keep their workspaces while this sync drops
    // them from the windows it sees.
    if (Object.keys(left).length > 0) state.restoring = left;
    return { state, renamed: new Set(renames.values()), waiting: left };
  }

  // A drag on a tiled window's edge sets its workspace's main share (§5.3),
  // or a lone window's width. Its width changed since tide placed it, on
  // the same display, which has the same work area: a work area that changed
  // may have moved it, and a drag of the whole window keeps the width.
  // Returns {n, display, mode, mfact} or {n, display, singleWidth}, or null
  // if this wasn't such a drag or the share doesn't move that edge.
  resized(before, w, display) {
    const info = before.windows[w.id];
    const p = info.placed;
    if (!p || info.floating || w.width === p.width) return null;
    const n = ws.showing(before, display);
    const d = this.displays.find((x) => x.id === display);
    if (n === null || info.ws !== n || !d || JSON.stringify(area(d)) !== JSON.stringify(p.area)) return null;
    const part = ws.layoutOf(before, n, display);
    if (p.count === 1) {
      const singleWidth = geometry.singleWidthFor(p.area, { x: p.left, w: p.width }, { x: w.left, w: w.width });
      return singleWidth === null ? null : { n, display, singleWidth };
    }
    const edge = w.left !== p.left ? "left" : "right";
    const x = edge === "left" ? w.left : w.left + w.width;
    const mfact = geometry.mfactFor(p.mode, p.area, p.count, part.modes[p.mode], this.singleRules(part), p.index, edge, x);
    return mfact === null ? null : { n, display, mode: p.mode, mfact };
  }

  // The single-window rule for a workspace's part: the width you dragged a
  // lone window to there, or this Chromebook's rule for the display.
  singleRules(part) {
    return part.singleWidth === undefined ? this.settings.singleRules : [{ minAspect: 0, width: part.singleWidth }];
  }

  // The display of the focused window, any type: a home window or a popup
  // counts, so keys pressed there act on its display.
  focusedDisplay() {
    const f = [...(this.all?.values() ?? [])].find((w) => w.focused && w.state !== "minimized");
    return f ? displayFor(f, this.displays) : this.displays[0]?.id;
  }

  focusedWindow() {
    for (const w of this.windows.values()) if (w.focused) return w.id;
    return null;
  }

  modeOf(n, display) {
    return ws.layoutOf(this.state, n, display.id).layout ?? this.defaultModeOf(display);
  }

  defaultModeOf(display) {
    const a = display.workArea;
    return this.settings.defaultMode[a.width / a.height >= this.settings.ultrawideAspect ? "ultrawide" : "normal"];
  }

  // A floating window keeps its size and its place relative to its display,
  // but moves to the display it belongs on when that's another (a display
  // went or came back), so every shown window is on its own display and the
  // next sync doesn't read the difference as a drag.
  async placeFloating(update) {
    const s = this.state;
    for (const [key, info] of Object.entries(s.windows)) {
      const id = Number(key);
      const w = this.windows.get(id);
      if (!info.floating || !w || w.state !== "normal" || !ws.isShown(s, id)) continue;
      const target = this.displays.find((d) => d.id === info.display);
      const source = this.displays.find((d) => d.id === displayFor(w, this.displays));
      if (!target || !source || target.id === source.id) continue;
      const t = target.workArea;
      const from = source.workArea;
      const width = Math.min(w.width, t.width);
      const height = Math.min(w.height, t.height);
      const left = Math.min(Math.max(t.left + (w.left - from.left), t.left), t.left + t.width - width);
      const top = Math.min(Math.max(t.top + (w.top - from.top), t.top), t.top + t.height - height);
      await update(id, { left, top, width, height });
    }
  }

  // Apply a command to the state. Returns the window to focus, if any.
  async perform(name) {
    const s = this.state;
    const display = this.focusedDisplay();
    const n = ws.showing(s, display);
    // With the dashboard or another untracked window in front, a command acts
    // on the window you were last in on this workspace, if it's on this
    // display: an empty display's home page has none.
    const remembered = n === null ? null : s.workspaces[n].focused;
    const here = remembered !== null && ws.isShown(s, remembered) && ws.part(s, display).includes(remembered);
    const win = this.focusedWindow() ?? (here ? remembered : null);
    const tracked = win !== null && win in s.windows;
    const disp = this.displays.find((d) => d.id === display);
    const mode = n === null || !disp ? null : this.modeOf(n, disp);

    // The steps and numbers go by bar order, stopping at its ends; the steps
    // pass over workspaces with no window (§6.1).
    let m;
    if ((m = name.match(/^workspace-([0-9])$/))) return this.showWorkspace(display, ws.nth(s, Number(m[1])));
    if (name === "workspace-next") return this.showWorkspace(display, ws.step(s, n, 1, { withWindows: true }));
    if (name === "workspace-prev") return this.showWorkspace(display, ws.step(s, n, -1, { withWindows: true }));
    if (name === "workspace-home") return this.showWorkspace(display, ws.home(s));
    if (name === "workspace-last") return this.showWorkspace(display, ws.last(s, n));
    if (name === "popup") return this.dashboard(display);
    if (name === "workspace-go") return this.dashboard(display, "go");
    if (name === "app-browser") return this.browser(display);
    if (name === "attention") return this.attention();
    if (name === "keep-awake") {
      await toggleKeepAwake(this.api);
      return null;
    }
    const app = this.apps.find((a) => a.command === name);
    if (app) return this.app(app, display);
    if (!tracked && name !== "layout-next" && name !== "layout-prev") return null;
    if (name === "workspace-move") return this.dashboard(display, "move", win);

    const sendTo = (to) => (to === null ? s : ws.send(s, win, to));
    if ((m = name.match(/^send-([0-9])$/))) this.state = sendTo(ws.nth(s, Number(m[1])));
    else if (name === "send-next") this.state = sendTo(ws.step(s, n, 1));
    else if (name === "send-prev") this.state = sendTo(ws.step(s, n, -1));
    else if (name === "focus-next") return ws.neighbor(s, win, 1);
    else if (name === "focus-prev") return ws.neighbor(s, win, -1);
    else if (name === "move-next") this.state = ws.moveInStack(s, win, 1);
    else if (name === "move-prev") this.state = ws.moveInStack(s, win, -1);
    else if (name === "swap-master") this.state = ws.swapMaster(s, win);
    else if (name === "float") this.state = ws.toggleFloating(s, win);
    else if (n === null || mode === null) return null;
    else if (name === "grow") this.state = ws.adjust(s, n, display, mode, { mfact: 0.025 });
    else if (name === "shrink") this.state = ws.adjust(s, n, display, mode, { mfact: -0.025 });
    else if (name === "master-add") this.state = ws.adjust(s, n, display, mode, { nmaster: 1 });
    else if (name === "master-remove") this.state = ws.adjust(s, n, display, mode, { nmaster: -1 });
    else if (name === "monocle") this.state = ws.toggleMonocle(s, n, display, mode, this.defaultModeOf(disp));
    else if (name === "layout-next" || name === "layout-prev") {
      const i = geometry.modes.indexOf(mode);
      const k = name === "layout-next" ? 1 : -1;
      this.state = ws.setLayout(s, n, display, geometry.modes[(i + k + geometry.modes.length) % geometry.modes.length]);
    }
    return null;
  }

  // Dim every shown window but the focused one, on displays showing more
  // than one (§10.1). A hidden window keeps its overlay until it's back.
  async dim(focused) {
    const s = this.state;
    s.dimmed ??= [];
    const want = new Set();
    const shown = new Set();
    for (const display of this.displays) {
      const ids = ws.part(s, display.id).filter((id) => ws.isShown(s, id));
      for (const id of ids) shown.add(id);
      if (!this.dimOn() || ids.length < 2) continue;
      for (const id of ids) {
        // Fullscreen is for watching; leave it be.
        if (id !== focused && this.windows.get(id)?.state !== "fullscreen") want.add(this.activeTab.get(id));
      }
    }
    want.delete(undefined);
    const strength = this.settings.dimStrength;
    // A new strength repaints every overlay showing, not just new ones.
    const repaint = s.dimStrength !== undefined && s.dimStrength !== strength;
    s.dimStrength = strength;
    const dimmed = new Set(s.dimmed);
    const set = async (tabId, on) => {
      try {
        await this.api.scripting.executeScript({ target: { tabId }, func: overlay, args: [on, strength] });
        return true;
      } catch {
        // chrome:// pages, the Web Store and the PDF viewer can't be
        // injected, and a closing tab has gone: those just stay undimmed.
        return false;
      }
    };
    for (const tabId of want) if ((repaint || !dimmed.has(tabId)) && (await set(tabId, true))) dimmed.add(tabId);
    for (const tabId of dimmed) {
      if (want.has(tabId)) continue;
      const win = this.tabWindow.get(tabId);
      // Leave a hidden window's overlay for when it comes back; a window tide
      // stopped managing never will, so it's undimmed.
      if (this.dimOn() && win in s.windows && !shown.has(win)) continue;
      if (win !== undefined) await set(tabId, false);
      dimmed.delete(tabId);
    }
    // Overlays kept on hidden windows take the new strength too, for when
    // they're back.
    if (repaint) for (const tabId of dimmed) if (!want.has(tabId) && this.tabWindow.has(tabId)) await set(tabId, true);
    s.dimmed = [...dimmed];
  }

  // The toolbar badge shows the focused display's workspace (§8.1), its name
  // cut to the four characters a badge has room for.
  async badge() {
    const n = ws.showing(this.state, this.focusedDisplay());
    await this.api.action?.setBadgeText({ text: n === null ? "" : [...n].slice(0, 4).join("") });
    // Amber while another workspace holds a marked window (§8.1).
    const elsewhere = this.state.marks.some((id) => this.state.windows[id] && this.state.windows[id].ws !== n);
    await this.api.action?.setBadgeBackgroundColor({ color: elsewhere ? BADGE_ATTENTION : BADGE });
  }

  // The launcher page full screen on `display` (§6.2, §8.1): opened on that
  // display first, since Chrome won't take a position and a full-screen
  // state in one call.
  async fullscreen(mode, display, focused, extra = "") {
    const b = display.bounds;
    const w = await this.api.windows.create({
      url: this.api.runtime.getURL(`src/launcher.html?mode=${mode}${extra}`),
      type: "popup",
      focused,
      left: b.left,
      top: b.top,
      width: b.width,
      height: b.height,
    });
    await this.api.windows.update(w.id, { state: "fullscreen" });
    return w;
  }

  // The dashboard, from its key or the toolbar button: the launcher full
  // screen over the focused display. The key again closes it (§8.1).
  // `how` is "tabs" for that, "go" for Search+W's name prompt, on the
  // Workspaces scope, and "move" for Search+Shift+W's, which moves window
  // `moving` (§6.1), offering home if that's one of home's apps'. A new
  // window's prompt starts its field as `name`. A different one's key swaps
  // it for that one.
  async dashboard(display, how = "tabs", moving = null, name = "") {
    const s = this.state;
    if (s.dashboard !== undefined) {
      const id = s.dashboard;
      const was = s.dashboardFor ?? "tabs";
      delete s.dashboard;
      delete s.dashboardFor;
      delete s.moving;
      await this.api.windows.remove(id);
      if (was === how) return null;
    }
    const d = this.displays.find((x) => x.id === display) ?? this.displays[0];
    let extra = { tabs: "", go: "&scope=workspaces", move: "&scope=workspaces&move=1" }[how];
    if (name) extra += `&name=${encodeURIComponent(name)}`;
    s.dashboard = (await this.fullscreen("dashboard", d, true, extra)).id;
    if (how !== "tabs") s.dashboardFor = how;
    if (moving !== null) s.moving = moving;
    return null;
  }

  // A tab chosen in the launcher: its tab comes forward, and its window with
  // its workspace (§6.1 Activate).
  activateTab(tabId, windowId) {
    return this.run(async () => {
      await this.sync();
      await this.api.tabs.update(tabId, { active: true });
      const focus = windowId in this.state.windows ? this.activate(windowId) : windowId;
      await this.apply(focus);
    });
  }

  // Search+Tab (§10.3): the most recent mark, so pressing again goes to the
  // next; with none, the last window you were in.
  attention() {
    const s = this.state;
    if (s.marks.length > 0) return this.activate(s.marks.pop());
    const current = this.focusedWindow();
    let last = null;
    for (const [key, info] of Object.entries(s.windows)) {
      const id = Number(key);
      if (id === current || !info.lastFocused) continue;
      if (last === null || info.lastFocused > s.windows[last].lastFocused) last = id;
    }
    return last === null ? null : this.activate(last);
  }

  // Bring up a window, with its workspace (§6.1 Activate).
  activate(id) {
    this.state = ws.activate(this.state, id);
    return id;
  }

  // At login (§13.1): each address on this Chromebook's list,
  // in order, as an app window on the workspace showing where you are, as
  // its app key would open it, but taking no focus. Tracked from the
  // moment it opens, so it can't take the place of a window Chrome is still
  // restoring (§14.2).
  startAtLogin() {
    return this.run(async () => {
      await this.sync();
      const addresses = this.settings.startup;
      if (addresses.length === 0) return;
      const display = this.focusedDisplay();
      if (display === undefined) return;
      for (const url of addresses) {
        try {
          await this.app({ url }, display, false);
        } catch (e) {
          // One that can't open mustn't keep the rest from starting.
          console.error(`tide: couldn't start ${url} at login:`, e);
        }
      }
      await this.apply();
    });
  }

  async open(props, display, how) {
    const w = await this.api.windows.create({ focused: true, ...props });
    this.windows.set(w.id, w);
    this.state = this.join(this.state, w.id, display, how);
    return w;
  }

  // The browser key: always a new browser window on this workspace, as
  // tide's and KDE's keys launch one (§9.1). On a workspace that asks for
  // a name, home by default, it asks, as any new window there does (§6.1).
  async browser(display) {
    return (await this.open({}, display, { ask: true })).id;
  }

  // A web app key: always a new window on this workspace, never one already
  // open, as tide's and KDE's keys launch the app (§9.1). Installed web apps
  // open their own windows, but there's no public way to launch one by
  // origin, so tide opens the site in an app-like popup and tiles it as the
  // app's. One of home's apps opens on home (§6.1), which comes with it when
  // it takes focus, since it was asked for.
  async app(app, display, focused = true) {
    const homeApp = this.settings.homeApps.includes(appOfUrl(app.url, this.apps)?.command);
    const w = await this.open({ url: app.url, type: "popup", focused }, display, { homeApp });
    this.state.appPopups.push(w.id);
    const key = appOfUrl(app.url, this.apps)?.command;
    if (key) this.state.windows[w.id].app = key;
    return homeApp && focused ? this.activate(w.id) : w.id;
  }

  // A display with no window of the workspace showing gets a home window, so
  // tide's keys still have a Chrome window to work in (§6.2). It isn't
  // tiled or counted, and closes when a window arrives. One you close stays
  // closed until the display shows another empty part.
  async homes(focus) {
    const s = this.state;
    s.homeShownFor ??= {};
    const target = this.switchedTo ?? this.focusedDisplay();
    for (const display of this.displays) {
      const n = ws.showing(s, display.id);
      const empty = n !== null && !ws.part(s, display.id).some((id) => ws.isShown(s, id));
      const home = s.homes[display.id];
      // Only one display's home may take focus: the one you switched, else
      // the one you're on.
      const wantFocus = focus === null && display.id === target;
      if (!empty) delete s.homeShownFor[display.id];
      if (empty && home === undefined && s.homeShownFor[display.id] !== n) {
        s.homeShownFor[display.id] = n;
        const w = await this.fullscreen("home", display, wantFocus);
        s.homes[display.id] = w.id;
      } else if (!empty && home !== undefined) {
        delete s.homes[display.id];
        await this.api.windows.remove(home);
      } else if (empty && home !== undefined) {
        s.homeShownFor[display.id] = n;
        if (wantFocus && this.switchedTo !== undefined) await this.api.windows.update(home, { focused: true });
      }
    }
    this.switchedTo = undefined;
  }

  // Show workspace `n` on every display, focus staying on `display`, the one
  // you're on; null, as a number past the last or a step past an end gives,
  // shows nothing. Returns the window to focus: the workspace's remembered
  // one if it's on `display` and you haven't minimized it since, else the
  // one there you were in last, else the first tiled there.
  showWorkspace(display, n) {
    if (display === undefined || n === null) return null;
    this.switchedTo = display;
    const s = (this.state = ws.show(this.state, n));
    const here = ws.part(s, display).filter((id) => ws.isShown(s, id));
    const remembered = s.workspaces[s.current].focused;
    if (here.includes(remembered)) return remembered;
    const last = here.filter((id) => s.windows[id].lastFocused).sort((a, b) => s.windows[b].lastFocused - s.windows[a].lastFocused)[0];
    return last ?? ws.tiled(s, display)[0] ?? null;
  }

  // Make the screen match the state, then save it.
  async apply(focus = null) {
    const s = this.state;
    const minimizedNow = new Set([...this.windows.values()].filter((w) => w.state === "minimized").map((w) => w.id));
    const { restore, minimize } = ws.plan(s, minimizedNow);
    // Keep the snapshot current with what each update returns, so every
    // later step in this apply sees a restored window as restored.
    const update = async (id, props) => {
      const w = await this.api.windows.update(id, props);
      if (w && this.windows.has(id)) this.windows.set(id, w);
      return w;
    };
    // A window that refuses to hide (a locked full-screen one, say) can't
    // follow a workspace, so tide stops managing it rather than stop the
    // switch, or read it still showing as your doing next time (§5.4).
    const refusedNow = [];
    const setState = async (id, state) => {
      try {
        await update(id, { state });
      } catch (e) {
        console.warn(`tide: window ${id} refused to be ${state}; leaving it alone:`, e?.message ?? e);
        refusedNow.push(id);
      }
    };
    for (const id of restore) await setState(id, "normal");
    for (const id of minimize) await setState(id, "minimized");
    for (const id of refusedNow) {
      this.state = ws.removeWindow(this.state, id);
      this.windows.delete(id);
      this.state.refused = [...new Set([...(this.state.refused ?? []), id])];
    }

    // Only windows tiled now have a placement to judge a resize by; one
    // that's floating, hidden or maximized gets a new one when it tiles.
    for (const info of Object.values(this.state.windows)) delete info.placed;
    for (const display of this.displays) {
      const n = ws.showing(s, display.id);
      if (n === null) continue;
      // Maximized and fullscreen windows are left alone (§5.1).
      const ids = ws.tiled(s, display.id).filter((id) => this.windows.get(id)?.state === "normal");
      const mode = this.modeOf(n, display);
      const part = ws.layoutOf(s, n, display.id);
      const boxes = geometry.arrange(mode, area(display), ids.length, part.modes[mode], this.singleRules(part));
      await Promise.all(ids.map(async (id, i) => {
        const b = boxes[i];
        const w = await update(id, { left: b.x, top: b.y, width: b.w, height: b.h });
        // Where it ended up, which a minimum size can make differ from the
        // box, so that only your own resize reads as one.
        const info = this.state.windows[id];
        if (info) info.placed = { left: w?.left ?? b.x, width: w?.width ?? b.w, area: area(display), mode, index: i, count: ids.length };
      }));
    }
    await this.placeFloating(update);
    // Which display each window is on now, so the next sync can tell your
    // move from one tide hasn't made yet.
    for (const [key, info] of Object.entries(this.state.windows)) {
      const w = this.windows.get(Number(key));
      if (w) info.on = displayFor(w, this.displays);
    }
    if (focus !== null) {
      await update(focus, { focused: true });
      this.state = ws.focused(this.state, focus);
    }
    await this.homes(focus);
    await this.ask();
    await this.dim(focus ?? this.focusedWindow());
    await this.badge();
    await this.save();
  }
}
