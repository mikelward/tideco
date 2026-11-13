// The launcher's matching and ranking (SPEC.md §9.4), free of chrome.* so it
// tests in Node: tabs, apps and tide's commands, filtered by a fuzzy match
// and ordered by how well they match, then by how recently you used them;
// and the workspaces, which double as the name prompt (§6.1).

import { worksUntiled } from "./platform.js";

import { appOfUrl } from "./apps.js";
import { checkName, sameName } from "./workspaces.js";

// How well `query` matches `text`, or null if it doesn't. Every query
// character must appear in order; matches at the start of a word, and runs of
// consecutive matches, score higher, so "gc" finds "Google Calendar" first.
export function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q === "") return 0;
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    score += 1;
    if (i === 0 || /[\s\-_./:()]/.test(t[i - 1])) score += 3;
    if (i === last + 1) score += 2;
    last = i;
    from = i + 1;
  }
  if (t.startsWith(q)) score += 5;
  return score;
}

// The best score of an item over its title, a tab's app name, which counts
// as much, and its other searchable text, such as a tab's host, which counts
// for less.
function itemScore(query, item) {
  const scores = [fuzzyScore(query, item.title), item.app ? fuzzyScore(query, item.app) : null];
  const extra = item.extra ? fuzzyScore(query, item.extra) : null;
  if (extra !== null) scores.push(extra - 2);
  const found = scores.filter((s) => s !== null);
  return found.length === 0 ? null : Math.max(...found);
}

// The scopes rank() ranks: "launch" is apps, Tide Settings and its sections,
// and, for a query, the actions and commands too; "tabs" is open tabs;
// "actions" is tide's actions and commands. "workspaces" has rows of its
// own (workspaceRows).
export const SCOPES = { launch: ["app", "setting", "action", "command"], tabs: ["tab"], actions: ["action", "command"] };

// What each scope lists with nothing typed (§9.4): Launch only its apps, so
// it reads as a start menu; a settings section turns up only for a query.
const EMPTY = { launch: ["app"], tabs: ["tab"], actions: ["action", "command"] };

// The scopes in their chips' order, which Tab steps through.
export const SCOPE_ORDER = ["launch", "tabs", "workspaces", "actions"];
const SCOPE_NAMES = { launch: "Launch", tabs: "Tabs", workspaces: "Workspaces", actions: "Actions" };

// The name of the options page as an app (§9.4), in the user's words.
export const SETTINGS_APP = "Tide Settings";

// The options page's pages (§13), in its sidebar's order, as tide for
// Linux's settings panel has them (tide's shell/lib/settings.mjs): each in
// its `group`, under that group's heading, with its `icon`. Launch finds
// each by its name and what it covers, and opens it by `id`, its element on
// the options page. `chromeos` ones show only there and `linux` only on
// Linux, as the options page shows them (§14.6). Names and groups are
// tide for Linux's where the page is the same; the rest are Chrome's own.
export const SETTINGS_GROUPS = [
  { id: "hardware", label: "Hardware" },
  { id: "windows", label: "Windows" },
  { id: "general", label: "General" },
];
export const SETTINGS_SECTIONS = [
  { id: "mouse", group: "hardware", icon: "mouse", name: "Mouse", covers: "wheel scroll step crosh", chromeos: true },
  { id: "keys-section", group: "hardware", icon: "keyboard", name: "Keyboard", covers: "keys shortcuts bindings hotkeys" },
  { id: "layouts", group: "windows", icon: "layouts", name: "Layouts", covers: "tiling start in main share main windows ultrawide aspect ratio width", chromeos: true },
  { id: "workspaces", group: "windows", icon: "workspaces", name: "Workspaces", covers: "standing workspaces home apps pinned apps ask for a name", chromeos: true },
  { id: "floating", group: "windows", icon: "floating", name: "Floating", covers: "float rules always float app windows sites", chromeos: true },
  { id: "apps-section", group: "windows", icon: "open", name: "Apps", covers: "app keys web apps addresses" },
  { id: "dim", group: "general", icon: "appearance", name: "Appearance", covers: "dim strength inactive windows", chromeos: true },
  { id: "bar", group: "general", icon: "bar", name: "Bar", covers: "panel taskbar position top bottom" },
  { id: "unread", group: "general", icon: "muted", name: "Notifications", covers: "unread counts Gmail Chat Calendar sites", chromeos: true },
  { id: "clocks-section", group: "general", icon: "clocks", name: "Clocks", covers: "time zones world clocks cities daytime working hours" },
  { id: "startup-section", group: "general", icon: "startup", name: "Start at login", covers: "websites autostart login items", chromeos: true },
  { id: "extras", group: "general", icon: "more", name: "Extras", covers: "permissions allow tab search unread dim" },
  { id: "linux", group: "general", icon: "floating", name: "Tabs in tide's switcher", covers: "Linux native helper tide-tabs", linux: true },
  { id: "setup-section", group: "general", icon: "setup", name: "Setup checklist", covers: "chromeOS settings", chromeos: true },
  { id: "import-section", group: "general", icon: "folder", name: "Import and export", covers: "JSON backup reset defaults" },
];

// Asked for in place of a page, the options page's first, so a tab that's
// open on another goes back to it.
export const TOP = "top";

// The page a right-click on each item of the dashboard's bar opens, by its
// id in launcher.html, as tide's bar opens a page (tide SPEC.md §7.1,
// shell/lib/barsettings.mjs): "bar", the Bar page, for the bar itself (a
// right-click anywhere that isn't an item) and for tide's logo, as tide's
// do; TOP for the first page where tide's has a page tide for Chrome
// lacks: keep awake, whose tide page is Idle. The title names the
// workspace here, so it opens Workspaces.
export const BAR_SECTIONS = Object.freeze({
  bar: "bar",
  logo: "bar",
  workspaces: "workspaces",
  title: "workspaces",
  "keep-awake": TOP,
  clocks: "clocks-section",
});

// Where Launch leaves the page to show, in session storage, for the
// options page to show and clear (§9.4).
export const SECTION_KEY = "settingsSection";

// The page the options page shows: its address's anchor, else the one
// Launch asked for; either only if the page has it, by `ids`, or TOP.
export function sectionToShow(hash, asked, ids) {
  const id = hash.replace(/^#/, "") || asked || "";
  return id === TOP || ids.includes(id) ? id : null;
}

// The sections shown where tide runs: on chromeOS (`tiling`), or off it,
// where `linux` adds Linux's own.
export function settingsSections({ tiling = true, linux = false } = {}) {
  return SETTINGS_SECTIONS.filter((s) => (tiling ? !s.linux : !s.chromeos && (!s.linux || linux)));
}

// The Actions scope's own rows (§9.4), before the commands: keep awake,
// saying whether it's on; on chromeOS the dim, on, off, or to allow; and
// reloading tide. chromeOS gives extensions no lock, log out or shut down.
// `keepAwake` is whether it's on, `dim` null off chromeOS, else
// {granted, on}, and `key` names a command's key.
export function actions({ keepAwake = false, dim = null, key = () => "" } = {}) {
  const out = [{ kind: "action", title: "Keep awake", detail: keepAwake ? "on" : "off", key: key("keep-awake"), command: "keep-awake" }];
  if (dim) {
    const on = dim.granted && dim.on;
    out.push({ kind: "action", title: "Dim inactive windows", detail: on ? "on" : dim.granted ? "off" : "off · Chrome asks first", act: "dim", on });
  }
  out.push({ kind: "action", title: "Reload tide", detail: "restarts the extension", act: "reload" });
  return out;
}

// How many rows a scope shows: Actions lists every one with nothing typed,
// the rest the best eight.
export function limitFor(scope, query) {
  return scope === "actions" && query.trim() === "" ? Infinity : 8;
}

// The scope `by` chips from `scope` among those shown, `scopes`, wrapping.
// Off chromeOS there are no workspaces, so no Workspaces chip (§14.6).
export function nextScope(scope, by = 1, scopes = SCOPE_ORDER) {
  const n = scopes.length;
  return scopes[(scopes.indexOf(scope) + by + n) % n];
}

// How the page was opened, from its address: `mode=home` is an empty
// workspace's home page (§6.2), on Launch; anything else the dashboard
// (§8.1), on Tabs, or on Workspaces with `scope=workspaces`, as Search+W
// opens it. Search+Shift+W adds `move=1`: Enter then moves the window the
// dashboard opened over. A new window's prompt adds `name`, the field's
// text to start with (§6.1).
export function opening(search) {
  const q = new URLSearchParams(search);
  const home = q.get("mode") === "home";
  const workspaces = !home && q.get("scope") === "workspaces";
  const move = workspaces && q.get("move") === "1";
  return {
    home,
    scope: home ? "launch" : workspaces ? "workspaces" : "tabs",
    move,
    name: workspaces ? (q.get("name") ?? "") : "",
  };
}

// The Workspaces scope's rows for `query` (§6.1, §9.4), as tide's switcher
// lists workspaces and its name prompt offers them. From the view: `bar`, the
// names in bar order, home first; `counts`, each one's windows; `made`, the
// ones made so far; `current`, the one showing where you are.
// With nothing typed, every workspace in bar order, the standing ones even
// before they're made. Typing filters them with the launcher's fuzzy match,
// a name typed in any case first; a valid name no workspace has comes first
// of all, as a "new" row that makes it; an invalid one shows why, as a
// "refused" row. Home is offered as any other, to go to or move a window to.
// Each row is {kind, title, detail, workspace}, `workspace` the name Enter
// shows; a refused row has none.
// `suggested` says the text is still a new window's short name, which the
// prompt started with: it isn't a filter, so every workspace follows it in
// bar order, the one it names first.
export function workspaceRows({ bar = [], counts = {}, made = bar, current = null, query = "", suggested = false }) {
  const home = bar[0] ?? null;
  const typed = query.trim();
  const out = [];
  if (typed !== "") {
    const checked = checkName(typed);
    const known = bar.find((n) => sameName(n, typed)) ?? null;
    if (checked.error) out.push({ kind: "refused", title: typed, detail: checked.error });
    else if (known === null) out.push({ kind: "new", title: checked.name, detail: "new workspace", workspace: checked.name });
  }
  const all = suggested || typed === "";
  const scored = [];
  bar.forEach((name, i) => {
    const score = all ? 0 : fuzzyScore(typed, name);
    if (score !== null) scored.push({ name, score, exact: typed !== "" && sameName(name, typed), i });
  });
  scored.sort((a, b) => b.exact - a.exact || b.score - a.score || a.i - b.i);
  for (const { name } of scored) {
    // tide's words: whether it's showing here, made, and how full.
    const count = counts[name] ?? 0;
    const what = name === current ? "current"
      : !made.includes(name) ? "not made yet"
      : count === 0 ? "empty"
      : count === 1 ? "1 window" : `${count} windows`;
    out.push({ kind: "workspace", title: name, detail: name === home ? `home · ${what}` : what, workspace: name });
  }
  return out;
}

// Items in `scope` matching `query`, best first; ties go to the most recent.
// With no query, tabs come most recent first, apps before commands. A query
// that matches nothing in its scope looks in every scope instead, so a tab
// still turns up from the launch scope.
export function rank(query, items, { scope = null, limit = 8 } = {}) {
  const empty = query.trim() === "";
  const kinds = scope ? (empty ? EMPTY : SCOPES)[scope] : null;
  // A settings section is only ever found by a query.
  const inScope = items.filter((i) => (kinds ? kinds.includes(i.kind) : !empty || i.kind !== "setting"));
  const found = rankAll(query, inScope, limit);
  return found.length > 0 || !scope || empty ? found : rankAll(query, items, limit);
}

function rankAll(query, items, limit) {
  const q = query.trim();
  const kindOrder = { tab: 0, app: 1, setting: 2, action: 3, command: 4 };
  const scored = [];
  for (const item of items) {
    const score = q === "" ? 0 : itemScore(q, item);
    if (score !== null) scored.push({ item, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (q === "" ? kindOrder[a.item.kind] - kindOrder[b.item.kind] : 0) ||
      (b.item.recency ?? 0) - (a.item.recency ?? 0),
  );
  return scored.slice(0, limit).map((s) => s.item);
}

function host(url) {
  try {
    return new URL(url).host;
  } catch {
    // chrome:// and blank pages have no host worth searching
    return "";
  }
}

// The launcher's items: every tab but tide's own pages, the app keys, Tide
// Settings and its `sections`, the `actions`, and the manifest's commands. A
// tab on an app's site carries the app's name, so "calendar" finds
// Calendar's tabs. `workspaceOf` names a window's workspace, or null. Off
// chromeOS (`tiling` false) only the commands that place no window are
// listed (§14.6). Keep awake is an action, so its command isn't listed too.
export function items({ tabs = [], apps = [], sections = [], actions = [], commands = {}, workspaceOf = () => null, ownOrigin = "", tiling = true }) {
  const out = [];
  for (const t of tabs) {
    if (ownOrigin && t.url?.startsWith(ownOrigin)) continue;
    const n = workspaceOf(t.windowId);
    out.push({
      kind: "tab",
      title: t.title || t.url || "Untitled",
      extra: host(t.url ?? ""),
      app: appOfUrl(t.url, apps)?.name ?? null,
      detail: n === null ? "tab" : `tab on ${n}`,
      recency: t.lastAccessed ?? 0,
      tabId: t.id,
      windowId: t.windowId,
      icon: t.favIconUrl ?? null,
    });
  }
  for (const a of apps) out.push({ kind: "app", title: a.name, detail: "app", key: a.key ?? "", command: a.command });
  out.push({ kind: "app", title: SETTINGS_APP, detail: "settings", act: "settings" });
  // Each section matches by its name, by Tide Settings, and for less by
  // what it covers, as a tab does by its app and its host.
  for (const s of sections) out.push({ kind: "setting", title: s.name, app: SETTINGS_APP, extra: s.covers, detail: SETTINGS_APP, act: "settings", section: s.id });
  out.push(...actions);
  for (const [name, c] of Object.entries(commands)) {
    if (name.startsWith("app-") || name === "keep-awake") continue;
    if (!tiling && !worksUntiled(name)) continue;
    // Descriptions end with the key in parentheses, which shows on its own.
    const m = /^(.*?)\s*\(([^)]*)\)$/.exec(c.description ?? name);
    out.push({ kind: "command", title: m ? m[1] : c.description ?? name, detail: "command", key: m ? m[2] : "", command: name });
  }
  return out;
}

// The footer's key hints in `scope`, as [key, what it does], naming only the
// keys that work there, as tide's switcher footer does (SPEC.md §9.4).
// Without tab access the Tabs scope is one row, so there's nothing to choose.
// Search+Shift+W's prompt (`move`) keeps to Workspaces, so Tab does nothing.
export function footerKeys(scope, { home, tabsAllowed, move = false, scopes = SCOPE_ORDER }) {
  const tabs = scope === "tabs";
  const enter = scope === "workspaces" ? (move ? "move the window there" : "go there")
    : !tabs ? "run" : tabsAllowed ? "go there" : "allow tab search";
  return [["Enter", enter]]
    .concat(tabs && !tabsAllowed ? [] : [["↑ ↓", "choose"]])
    .concat(move ? [] : [["Tab", `switch to ${SCOPE_NAMES[nextScope(scope, 1, scopes)]}`]])
    .concat([["Esc", home ? "clear" : "clear or close"]]);
}

export function footerText(keys) {
  return keys.map(([key, does]) => `${key} to ${does}`).join(" · ");
}

// What a tap on the bar's logo does (§8.1): the dashboard is the open
// launcher, so it closes; the home page's launcher can't, so it goes back to
// Launch, ready to type.
export function logoTapped({ home }) {
  return home ? "launch" : "close";
}

// Whether the bar sits along the bottom of the dashboard and the home page
// (§8.1), with the launcher above it: `settings` is settings.js's resolve's.
export function barAtBottom(settings) {
  return settings?.barPosition === "bottom";
}

// The step an arrow key takes through the results, `key` being "ArrowDown"
// or "ArrowUp". The best result is next to the field, so the list runs
// down from it with the bar on top and up from it with the bar at the
// bottom; either way the key pointing away from the field goes on to the
// next (§8.1).
export function arrowStep(key, bottom = false) {
  return (key === "ArrowDown") !== bottom ? 1 : -1;
}
