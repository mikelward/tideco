// tileco's full-screen page (SPEC.md §6.2, §8.1, §9.4): tide's bar on top,
// with a launcher under it. As the home page of an empty workspace it opens
// on the launch scope and stays; as the dashboard, from its key or the
// toolbar button, it opens on open tabs and closes once you choose. Search+W
// opens the dashboard on its workspaces, the name prompt (§6.1), and
// Search+Shift+W the same for moving the window it opened over.

import { scrub } from "./clocks.js";
import { stepMonth } from "./calendar.js";
import { renderClocks, renderDetail, today } from "./clockview.js";
import { addDefaultSites, DISMISSED_KEY, extrasFor, isOn } from "./extras.js";
import { KEEP_AWAKE_KEY, isOn as keepingAwake, words as awakeWords } from "./keepawake.js";
import { actions, BAR_SECTIONS, footerKeys, footerText, items, limitFor, logoTapped, nextScope, opening, rank, SCOPE_ORDER, SECTION_KEY, settingsSections, workspaceRows } from "./launcher.js";
import { load as loadSettings, SETTINGS_KEY } from "./settings.js";
import { platform, TABS, TILE } from "./platform.js";

const SYMBOLS = { tile: "[]=", threecol: "|M|", twocol: "||=", monocle: "[M]" };
const opened = opening(location.search);
const home = opened.home;
// Search+Shift+W's prompt: Enter moves a window, so it keeps to Workspaces.
const move = opened.move;
const $ = (id) => document.getElementById(id);
const query = $("query");
const results = $("results");
const clocks = $("clocks");
const detail = $("clock-detail");

let scope = opened.scope;
// Tab titles and addresses need the tabs permission (§9.4); without it the
// Tabs scope offers to allow it.
let tabsAllowed = true;
const ALLOW_TABS = { kind: "allow", title: "Allow tab search", detail: "Chrome asks first" };
let all = [];
let shown = [];
let selected = 0;
let state = null;
let view = null;
let me = null;
// Off chromeOS nothing tiles (§14.6): no workspaces on the bar, and only the
// commands that place no window.
const where = platform(chrome);
const tiles = where.then((p) => p.role === TILE);
let tiling = true;
// The dim's access (§10.1), which the Actions scope can ask for.
const DIM_ACCESS = { origins: ["<all_urls>"] };

// After a choice the dashboard closes; the home page stays until a window
// arrives on its workspace, which closes it.
async function send(message) {
  await chrome.runtime.sendMessage(message);
  if (home) {
    query.value = "";
    update();
  } else window.close();
}

// The display this page is about: the home page belongs to its own; the
// dashboard has focus.
function hereDisplay() {
  return home ? Object.entries(state?.homes ?? {}).find(([, id]) => id === me?.id)?.[0] : view?.focusedDisplay;
}

// The scopes with a chip: no workspaces off chromeOS (§14.6), and only
// them in Search+Shift+W's prompt.
function scopes() {
  if (!tiling) return SCOPE_ORDER.filter((s) => s !== "workspaces");
  return move ? ["workspaces"] : SCOPE_ORDER;
}

function renderBar() {
  const nav = $("workspaces");
  nav.replaceChildren();
  if (!tiling) {
    $("title").textContent = "Tiling and workspaces work only on chromeOS";
    return;
  }
  if (!view) return;
  const display = hereDisplay();
  const here = view.displays[display];
  // By name in bar order, the standing ones even before they're made (§6.1).
  for (const name of view.bar ?? []) {
    const b = document.createElement("button");
    b.textContent = name;
    if (view.counts[name] > 0) b.classList.add("occupied");
    if (view.urgent?.includes(name)) b.classList.add("urgent");
    if (here?.workspace === name) b.classList.add("current");
    b.addEventListener("click", () => send({ workspace: name }));
    nav.append(b);
  }
  const layout = document.createElement("span");
  layout.className = "layout";
  layout.textContent = SYMBOLS[here?.mode] ?? "";
  nav.append(layout);
  $("title").textContent = here?.workspace ? `${here.workspace}${home ? " · empty" : ""}` : "";
}

// Keep awake's cup (§11): faint while off, in the accent color while on, and
// hovering says which. A click turns it over and leaves the page open.
const cup = $("keep-awake");
async function renderCup() {
  const on = await keepingAwake(chrome.storage);
  cup.setAttribute("aria-pressed", String(on));
  cup.title = awakeWords(on);
}
cup.addEventListener("click", () =>
  chrome.runtime.sendMessage({ command: "keep-awake" }).catch((e) => console.error("tileco: couldn't turn keep awake over:", e)),
);

async function refresh() {
  tiling = await tiles;
  if (!scopes().includes(scope)) scope = "launch";
  me = await chrome.windows.getCurrent();
  const wasAllowed = tabsAllowed;
  tabsAllowed = await chrome.permissions.contains({ permissions: ["tabs"] });
  // The dashboard opens on tabs only when it can show them.
  if (!home && !tabsAllowed && wasAllowed && scope === "tabs" && query.value === "") scope = "launch";
  const [tabs, stored, { settings: current }, awake, dimGranted, { role }] = await Promise.all([
    tabsAllowed ? chrome.tabs.query({}) : [],
    chrome.storage.local.get(["state", "view"]),
    loadSettings(chrome.storage),
    keepingAwake(chrome.storage),
    chrome.permissions.contains(DIM_ACCESS),
    where,
  ]);
  state = stored.state ?? null;
  view = stored.view ?? null;
  const commands = chrome.runtime.getManifest().commands;
  // Each app key's name comes from settings; its key, from the manifest.
  const keyOf = (command) => /\(([^)]*)\)$/.exec(commands[command]?.description ?? "")?.[1] ?? "";
  const apps = [
    { name: "Browser window", command: "app-browser", key: keyOf("app-browser") },
    ...current.apps.map((a) => ({ name: a.name, url: a.url, command: a.command, key: keyOf(a.command) })),
  ];
  all = items({
    tabs,
    apps,
    sections: settingsSections({ tiling, linux: role === TABS }),
    actions: actions({ keepAwake: awake, dim: tiling ? { granted: dimGranted, on: view?.dim === true } : null, key: keyOf }),
    commands,
    workspaceOf: (w) => state?.windows?.[w]?.ws ?? null,
    ownOrigin: chrome.runtime.getURL(""),
    tiling,
  });
  renderBar();
  update();
}

// What the field asks for in each scope; the workspaces' words are tide's
// name prompt's.
function placeholder() {
  if (scope !== "workspaces") return "Type to search";
  return move ? "Move this window to the workspace named" : "Go to the workspace named";
}

function update() {
  if (scope === "workspaces") {
    const current = view?.displays?.[hereDisplay()]?.workspace ?? null;
    // Until you type, a new window's short name lists every workspace.
    const suggested = opened.name !== "" && query.value === opened.name;
    shown = workspaceRows({ bar: view?.bar, counts: view?.counts, made: view?.made, current, query: query.value, suggested });
  } else shown = scope === "tabs" && !tabsAllowed ? [ALLOW_TABS] : rank(query.value, all, { scope, limit: limitFor(scope, query.value) });
  selected = Math.min(selected, Math.max(shown.length - 1, 0));
  for (const b of document.querySelectorAll(".scopes button")) {
    b.setAttribute("aria-selected", String(b.dataset.scope === scope));
    b.hidden = !scopes().includes(b.dataset.scope);
  }
  query.placeholder = placeholder();
  $("keys").textContent = footerText(footerKeys(scope, { home, tabsAllowed, move, scopes: scopes() }));
  results.replaceChildren();
  shown.forEach((item, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === selected));
    if (item.kind === "refused") li.setAttribute("aria-disabled", "true");
    const icon = document.createElement(item.icon ? "img" : "span");
    icon.className = `icon ${item.kind}`;
    if (item.icon) icon.src = item.icon;
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = item.title;
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = item.detail;
    const key = document.createElement("span");
    key.className = "key";
    key.textContent = item.key ?? "";
    li.append(icon, title, kind, key);
    li.addEventListener("click", () => choose(item));
    results.append(li);
  });
  // Actions lists every row, so the chosen one may be below the fold.
  results.children[selected]?.scrollIntoView({ block: "nearest" });
}

// A workspace, new or not, shows; in Search+Shift+W's prompt the window
// moves there first. A refused name is only there to say why.
function choose(item) {
  if (!item || item.kind === "refused") return;
  if (item.kind === "allow") allowTabs();
  else if (item.act === "settings") openSettings(item.section);
  else if (item.act === "dim") toggleDim(item.on);
  else if (item.act === "reload") chrome.runtime.reload();
  else if (item.kind === "tab") send({ tabId: item.tabId, windowId: item.windowId });
  else if (item.kind === "workspace" || item.kind === "new") send(move ? { moveTo: item.workspace } : { workspace: item.workspace });
  // Search+W's prompt is this page's own scope.
  else if (item.command === "workspace-go" && scopes().includes("workspaces")) {
    query.value = "";
    setScope("workspaces");
  } else send({ command: item.command });
}

function setScope(s) {
  scope = s;
  selected = 0;
  update();
  query.focus();
}

query.addEventListener("input", () => {
  selected = 0;
  update();
});
query.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = shown.length;
    if (n) selected = (selected + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    update();
  } else if (e.key === "Enter") {
    e.preventDefault();
    choose(shown[selected]);
  } else if (e.key === "Tab") {
    // Tab steps through the scopes, Shift+Tab back; it's Search+Tab, not
    // Tab, that runs attention.
    e.preventDefault();
    setScope(nextScope(scope, e.shiftKey ? -1 : 1, scopes()));
  }
});
// Esc anywhere on the page, not just in the search box: after a click on the
// clocks, focus is elsewhere.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  e.preventDefault();
  // A new window's prompt starts with its short name, which isn't typing
  // to clear: Esc leaves the window where it is at once (§6.1).
  if (query.value && query.value !== opened.name) {
    query.value = "";
    update();
    query.focus();
  } else if (!home) window.close();
  else query.focus();
});
for (const b of document.querySelectorAll(".scopes button")) b.addEventListener("click", () => setScope(b.dataset.scope));
// tide's wave logo (§8.1): the dashboard is the open launcher, so a tap
// closes it, as its key does; the home page's goes back to Launch.
$("logo").addEventListener("click", () => {
  if (logoTapped({ home }) === "close") window.close();
  else {
    query.value = "";
    setScope("launch");
  }
});

// The clocks: the home page shows each zone's day; the dashboard opens it on
// a click. Scrolling over them scrubs time until the pointer leaves (§8.2).
let scrubbed = null;
let settings;
// The calendar's month: today's each time the detail opens, as in tide.
let month = today();
function stepCalendar(by) {
  month = stepMonth(month.year, month.month, by);
  renderTime();
}
function renderTime() {
  const at = scrubbed ?? new Date();
  renderClocks(clocks, at, scrubbed !== null, settings);
  if (detail.hidden) return;
  // A redraw replaces the month buttons, so keep the keyboard on the one it was on.
  const focused = detail.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label") : null;
  renderDetail(detail, at, scrubbed !== null, settings, month, stepCalendar);
  if (focused) detail.querySelector(`[aria-label="${focused}"]`)?.focus();
}
// The options page reports bad settings; here the defaults stand in.
async function loadClocks() {
  settings = (await loadSettings(chrome.storage)).settings;
  renderTime();
}
function toggleDetail() {
  detail.hidden = !detail.hidden;
  if (!detail.hidden) month = today();
  clocks.setAttribute("aria-expanded", String(!detail.hidden));
  renderTime();
}
clocks.addEventListener("click", toggleDetail);
clocks.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  toggleDetail();
});
for (const e of [clocks, detail]) {
  e.addEventListener("wheel", (event) => {
    event.preventDefault();
    scrubbed = scrub(scrubbed ?? new Date(), Math.sign(event.deltaY));
    renderTime();
  }, { passive: false });
}
document.body.addEventListener("mouseleave", () => {
  scrubbed = null;
  renderTime();
});

// Chrome's prompt takes focus, and closing the dashboard under it drops the
// request, so the dashboard stays open until you answer.
let asking = false;

async function allowTabs() {
  asking = true;
  try {
    if (await chrome.permissions.request({ permissions: ["tabs"] })) await refresh();
  } catch (e) {
    console.error("tileco: couldn't ask for tab search:", e);
  } finally {
    asking = false;
  }
  query.focus();
}

// The settings open in a tab of their own, at `section` if one's given; the
// dashboard closes as it loses focus. Chrome brings an open settings tab
// forward rather than opening another, so the section goes by session
// storage, which the options page watches, not by the page's address.
async function openSettings(section = null) {
  try {
    if (section) await chrome.storage.session.set({ [SECTION_KEY]: section });
    await chrome.runtime.openOptionsPage();
  } catch (e) {
    console.error(`tileco: couldn't open the settings${section ? ` at ${section}` : ""}:`, e);
  }
  if (home) {
    query.value = "";
    update();
  }
}
$("open-settings").addEventListener("click", () => openSettings());
// A right-click on a bar item opens its settings section, in place of
// Chrome's menu (§8.1).
for (const [id, section] of Object.entries(BAR_SECTIONS)) {
  $(id).addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openSettings(section);
  });
}

// The dim on or off (§10.1). Without its access Chrome asks first, so the
// dashboard stays open while it does; once allowed, the dim comes on.
async function toggleDim(on) {
  if (on || (await chrome.permissions.contains(DIM_ACCESS))) {
    await send({ dim: !on }).catch((e) => console.error("tileco: couldn't turn the dim over:", e));
    return;
  }
  asking = true;
  try {
    await chrome.permissions.request(DIM_ACCESS);
  } catch (e) {
    console.error("tileco: couldn't ask for the dim's access:", e);
  } finally {
    asking = false;
  }
  await refresh();
  query.focus();
}

// The dashboard offers the extras still off (§14.1) until you dismiss it.
// Chrome's prompt takes focus, so the dashboard stays open while it asks.
async function renderExtras() {
  const card = $("extras");
  if (home || (await chrome.storage.local.get(DISMISSED_KEY))[DISMISSED_KEY]) {
    card.hidden = true;
    return;
  }
  const off = [];
  for (const extra of extrasFor(await tiles)) if (!(await isOn(chrome, extra))) off.push(extra);
  card.hidden = off.length === 0;
  card.querySelector("ul").replaceChildren(
    ...off.map((extra) => {
      const li = document.createElement("li");
      const allow = Object.assign(document.createElement("button"), { type: "button", textContent: "Allow" });
      allow.setAttribute("aria-label", `Allow: ${extra.title}`);
      allow.addEventListener("click", async () => {
        asking = true;
        try {
          if (await chrome.permissions.request(extra.access)) {
            if (extra.id === "unread") await addDefaultSites(chrome.storage);
            await refresh();
          }
        } catch (e) {
          console.error(`tileco: couldn't turn on ${extra.title}:`, e);
        } finally {
          asking = false;
        }
        await renderExtras();
        query.focus();
      });
      li.append(Object.assign(document.createElement("strong"), { textContent: extra.title }), allow);
      li.append(Object.assign(document.createElement("p"), { textContent: extra.how }));
      return li;
    }),
  );
}
$("dismiss-extras").addEventListener("click", async () => {
  $("extras").hidden = true;
  await chrome.storage.local.set({ [DISMISSED_KEY]: true });
  query.focus();
});
chrome.permissions.onAdded.addListener(() => renderExtras());
chrome.permissions.onRemoved.addListener(() => renderExtras());

if (home) {
  document.body.classList.add("home");
  detail.hidden = false;
  clocks.setAttribute("aria-expanded", "true");
} else {
  // The dashboard is a glance: clicking away closes it.
  window.addEventListener("blur", () => {
    if (!asking) window.close();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") {
    if (changes[KEEP_AWAKE_KEY]) {
      renderCup();
      refresh();
    }
    return;
  }
  if (changes.view || changes.state) refresh();
  if (changes[SETTINGS_KEY]) {
    renderExtras();
    loadClocks();
    refresh();
  }
});
// The home page can sit for hours; look again whenever it comes back.
window.addEventListener("focus", () => {
  refresh();
  query.focus();
});
// A new window's prompt starts with its short name, selected so typing
// replaces it (§6.1).
query.value = opened.name;
refresh();
renderCup();
renderExtras();
loadClocks();
setInterval(renderTime, 10000);
query.focus();
query.select();
