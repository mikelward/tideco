// The options page (SPEC.md §13). Every change is checked and saved at once
// to chrome.storage.sync; a bad one is reported, naming the setting, and
// isn't saved.

import { APP_COMMANDS, appLabel, withHomeApp } from "./apps.js";
import { checklist } from "./keys.js";
import { MOUSE_PAGE } from "./mouse.js";
import { ITEMS, progress, SETUP_KEY, tick } from "./setup.js";
import { EXTRAS as BASE_EXTRAS, extrasFor } from "./extras.js";
import { DEFAULT_SITES } from "./unread.js";
import { pattern } from "./watchers.js";
import { DEFAULT_SETTINGS, PER_MACHINE, pick, resolve, SETTINGS_KEY, SHARED, standingProblems, START_MODES, withWorkspaceSetting, workspaceSetting } from "./settings.js";
import { osName, platform, TABS, TILE, worksUntiled } from "./platform.js";
import { SECTION_KEY, sectionToShow, SETTINGS_SECTIONS, TOP } from "./launcher.js";
import { ACCESS as BRIDGE_ACCESS, bridgeText, STATUS_KEY as BRIDGE_KEY } from "./tabsbridge.js";

const $ = (id) => document.getElementById(id);
const rows = $("clocks").tBodies[0];
const errors = $("errors");
const json = $("json");
const appRows = $("apps").tBodies[0];
// The keys as bound, which can differ from the manifest's suggestions.
let shortcuts = {};
const HOURS = { day: ["day-from", "day-to"], work: ["work-from", "work-to"] };

function showErrors(list) {
  errors.hidden = list.length === 0;
  errors.replaceChildren(...list.map((e) => Object.assign(document.createElement("p"), { textContent: e })));
}

function input(value, attrs, onChange = () => save()) {
  const i = Object.assign(document.createElement("input"), { value: value ?? "", ...attrs });
  i.addEventListener("change", onChange);
  return i;
}

// A page opened from here goes in this window, beside the settings. Left to
// choose, Chrome may pick another window and refuse it, as a Chromebook did
// with "You cannot create new tabs while in locked fullscreen mode".
async function openHere(url) {
  const { id } = await chrome.windows.getCurrent();
  return chrome.tabs.create({ url, windowId: id });
}

function button(text, label, onClick) {
  const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

// A list row's arrows and ×, moving or taking out `tr` in `body`. Each then
// calls `changed` with a function that puts the row back as it was.
function orderCell(tr, body, changed) {
  const back = () => {
    const next = tr.nextElementSibling;
    return () => body.insertBefore(tr, next);
  };
  const move = (by) => () => {
    const to = by < 0 ? tr.previousElementSibling : tr.nextElementSibling?.nextElementSibling;
    if (by < 0 && !to) return;
    const undo = back();
    body.insertBefore(tr, to ?? null);
    changed(undo);
  };
  const order = document.createElement("td");
  order.className = "order";
  order.append(
    button("↑", "Move up", move(-1)),
    button("↓", "Move down", move(1)),
    button("×", "Remove", () => {
      const undo = back();
      tr.remove();
      changed(undo);
    }),
  );
  return order;
}

function clockRow(c) {
  const tr = document.createElement("tr");
  const cells = [
    input(c.label, { className: "label", maxLength: 4, ariaLabel: "Label", required: true }),
    input(c.zone, { className: "zone", ariaLabel: "Time zone", required: true }),
    input(c.city, { className: "city", ariaLabel: "City", placeholder: "from the zone" }),
  ];
  cells[1].setAttribute("list", "zones");
  // In the bar, or only in the dashboard's clock panel.
  const bar = input(undefined, { type: "checkbox", className: "bar", checked: c.bar !== false, ariaLabel: "In the bar" });
  cells.push(bar);
  const order = orderCell(tr, rows, () => save());
  for (const c of cells) {
    const td = document.createElement("td");
    td.append(c);
    tr.append(td);
  }
  tr.append(order);
  return tr;
}

// The app keys are fixed in the manifest, so each has a row; leaving one's
// name and address empty turns it off.
function appRow(command, app) {
  const tr = document.createElement("tr");
  tr.dataset.command = command;
  const key = shortcuts[command] || "No key";
  const cells = [
    Object.assign(document.createElement("kbd"), { textContent: key }),
    input(app?.name, { className: "name", ariaLabel: `${key} app's name`, placeholder: "off" }),
    input(app?.url, { className: "url", ariaLabel: `${key} app's address`, type: "url", placeholder: "https://" }),
  ];
  for (const c of cells) {
    const td = document.createElement("td");
    td.append(c);
    tr.append(td);
  }
  return tr;
}

// The extras (§14.1), each with what turning it on or off here takes
// beyond its permission.
const HOOKS = {
  unread: {
    // On only while they're in the list too.
    on: () => DEFAULT_SITES.every((s) => watchedSites.includes(s)),
    // Off takes them out of the list too: with all sites allowed for
    // dimming, their access stays, so the list is what turns them off.
    off: async () => {
      watchedSites = watchedSites.filter((s) => !DEFAULT_SITES.includes(s));
      return save();
    },
    // Allowing them puts back any you'd removed.
    allowed: async () => {
      const missing = DEFAULT_SITES.filter((s) => !watchedSites.includes(s));
      if (missing.length === 0) return;
      watchedSites.push(...missing);
      await save();
    },
  },
  // Every page is undimmed while tide can still reach them.
  dim: { off: () => chrome.runtime.sendMessage({ dim: false }) },
};
const ALL_EXTRAS = BASE_EXTRAS.map((e) => ({ ...e, ...HOOKS[e.id] }));
// Off chromeOS, only what works there (§14.6).
const where = platform(chrome);
const tiles = where.then((p) => p.role === TILE);

async function renderPermissions() {
  const items = await Promise.all(
    extrasFor(await tiles, ALL_EXTRAS).map(async (extra) => {
      const li = document.createElement("li");
      const on = (await chrome.permissions.contains(extra.access)) && (extra.on?.() ?? true);
      const title = Object.assign(document.createElement("strong"), { textContent: extra.title });
      const state = Object.assign(document.createElement("span"), { className: "muted", textContent: on ? "On" : "Off" });
      const toggle = button(on ? "Turn off" : "Allow", `${on ? "Turn off" : "Allow"}: ${extra.title}`, async () => {
        try {
          if (on) {
            if (extra.off && !(await extra.off())) throw new Error("tide couldn't undim the windows");
            await chrome.permissions.remove(extra.access);
          } else if (await chrome.permissions.request(extra.access)) {
            await extra.allowed?.();
          }
        } catch (e) {
          showErrors([`${extra.title}: ${e.message}`]);
        }
        renderPermissions();
        renderWatched();
      });
      li.append(title, " ", state, " ", toggle, Object.assign(document.createElement("p"), { className: "muted", textContent: extra.how }));
      return li;
    }),
  );
  $("permissions").replaceChildren(...items);
}

// The sites whose unread counts tide shows (§10.3). Settings sync, but a
// site's access is allowed per Chromebook, so each shows whether it's on here.
let watchedSites = [];

async function renderWatched() {
  const items = await Promise.all(
    watchedSites.map(async (site) => {
      const li = document.createElement("li");
      const granted = await chrome.permissions.contains({ origins: [pattern(site)] });
      li.append(site, " ", Object.assign(document.createElement("span"), { className: "muted", textContent: granted ? "on" : "not allowed yet" }));
      if (!granted) {
        li.append(" ", button("Allow", `Allow ${site}`, async () => {
          if (await chrome.permissions.request({ origins: [pattern(site)] })) renderWatched();
        }));
      }
      li.append(" ", button("×", `Stop showing unread counts for ${site}`, async () => {
        watchedSites = watchedSites.filter((s) => s !== site);
        if (await save()) {
          // Gives back this site's access; with all-sites access for dimming
          // inactive windows, Chrome keeps that, which is fine: it's the dim's.
          await chrome.permissions.remove({ origins: [pattern(site)] });
          renderWatched();
          renderPermissions();
        }
      }));
      return li;
    }),
  );
  $("watched").replaceChildren(...items);
}

// The layouts by their names in SPEC.md §5.2.
const MODE_NAMES = { tile: "Tile", threecol: "Three columns", twocol: "Two columns + stack", monocle: "Monocle" };
const START = { normal: "start-normal", ultrawide: "start-ultrawide" };
const modeRows = $("modes").tBodies[0];
for (const id of Object.values(START)) {
  $(id).replaceChildren(...START_MODES.map((m) => Object.assign(document.createElement("option"), { value: m, textContent: MODE_NAMES[m] })));
  $(id).addEventListener("change", () => save());
}

function modeRow(mode, o) {
  const tr = document.createElement("tr");
  tr.dataset.mode = mode;
  const th = Object.assign(document.createElement("th"), { scope: "row", textContent: MODE_NAMES[mode] });
  const share = input(percent(o.mfact), { className: "share", type: "number", step: "any", min: "10", max: "90", ariaLabel: `${MODE_NAMES[mode]} main share, percent`, required: true });
  const count = input(o.nmaster, { className: "count", type: "number", step: "1", min: mode === "tile" ? "0" : "1", max: "100", ariaLabel: `${MODE_NAMES[mode]} main windows`, required: true });
  tr.append(th);
  for (const c of [share, count]) {
    const td = document.createElement("td");
    td.append(c);
    tr.append(td);
  }
  return tr;
}

// The standing workspaces (§6.1), in order, the first being home. A move,
// removal or addition that can't be saved is put back, so the list shows
// what's saved; a name being edited stays as typed until it's fixed.
const standingRows = $("standing").tBodies[0];

function standingRow(name) {
  const tr = document.createElement("tr");
  const field = input(name, { className: "name", ariaLabel: "Standing workspace's name", spellcheck: false });
  field.addEventListener("input", markStanding);
  const home = Object.assign(document.createElement("td"), { className: "muted" });
  const order = orderCell(tr, standingRows, async (undo) => {
    if (!(await save())) undo();
    markStanding();
  });
  const td = document.createElement("td");
  td.append(field);
  tr.append(td, home, order);
  return tr;
}

const standingFields = () => [...standingRows.rows].map((tr) => tr.querySelector("input"));

// Marks the first as home, and each name that can't be one as you type,
// with why as its tooltip; saving says why too, naming the setting.
function markStanding() {
  const fields = standingFields();
  const problems = standingProblems(fields.map((f) => f.value));
  fields.forEach((f, i) => {
    f.closest("tr").cells[1].textContent = i === 0 ? "home" : "";
    f.setAttribute("aria-invalid", String(problems[i] !== ""));
    f.title = problems[i];
  });
}

// Home's apps (§6.1): a box for each app key, called by its app's name.
// The list keeps its own order, which the boxes don't show.
let homeApps = DEFAULT_SETTINGS.homeApps;

function renderHomeApps(settings) {
  homeApps = [...settings.homeApps];
  $("home-apps").replaceChildren(
    $("home-apps").querySelector("legend"),
    ...APP_COMMANDS.map((command) => {
      const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: homeApps.includes(command) });
      box.dataset.command = command;
      box.addEventListener("change", async () => {
        const previous = homeApps;
        homeApps = withHomeApp(homeApps, command, box.checked);
        if (!(await save())) {
          homeApps = previous;
          box.checked = !box.checked;
        }
      });
      const label = document.createElement("label");
      label.append(box, Object.assign(document.createElement("span"), { textContent: appLabel(command, settings.apps) }));
      return label;
    }),
  );
}

// The boxes follow the apps' names as they're saved.
function nameHomeApps(apps) {
  for (const box of $("home-apps").querySelectorAll("input")) box.nextElementSibling.textContent = appLabel(box.dataset.command, apps);
}

// Each standing workspace's own settings (§6.1): whether a new window there
// asks for a workspace, and its pinned apps, boxes as home's apps have.
// Kept as stored, null while unset, until a box changes, so an unset
// default keeps following home.
let workspaceSettings = DEFAULT_SETTINGS.workspaceSettings;
// What the boxes were drawn for, so a save that changes neither the
// standing names nor the apps' names leaves them, and their focus, be.
let drawnFor = "";

function renderWorkspaceSettings(settings) {
  workspaceSettings = settings.workspaceSettings === null ? null : structuredClone(settings.workspaceSettings);
  const labels = APP_COMMANDS.map((c) => appLabel(c, settings.apps));
  drawnFor = JSON.stringify([settings.standing, labels]);
  const change = async (box, name, field, value) => {
    const previous = workspaceSettings;
    workspaceSettings = withWorkspaceSetting({ ...settings, workspaceSettings }, name, field, value);
    if (!(await save())) {
      workspaceSettings = previous;
      box.checked = !box.checked;
    }
  };
  const current = (name) => workspaceSetting({ ...settings, workspaceSettings }, name);
  $("workspace-settings").replaceChildren(
    ...settings.standing.map((name) => {
      const set = Object.assign(document.createElement("fieldset"), { className: "home-apps workspace-settings" });
      set.dataset.name = name;
      const ask = Object.assign(document.createElement("input"), { type: "checkbox", className: "ask", checked: current(name).askForName });
      ask.setAttribute("aria-label", `New windows on ${name} ask for a workspace`);
      ask.addEventListener("change", () => change(ask, name, "askForName", ask.checked));
      const askLabel = document.createElement("label");
      askLabel.append(ask, Object.assign(document.createElement("span"), { textContent: "New windows ask for a workspace" }));
      const pinned = Object.assign(document.createElement("p"), { className: "pinned" });
      pinned.append(Object.assign(document.createElement("span"), { className: "muted", textContent: "Pinned apps:" }));
      APP_COMMANDS.forEach((command, i) => {
        const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: current(name).pinnedApps.includes(command) });
        box.dataset.command = command;
        box.setAttribute("aria-label", `Pin ${labels[i]} on ${name}`);
        box.addEventListener("change", () => change(box, name, "pinnedApps", withHomeApp(current(name).pinnedApps, command, box.checked)));
        const label = document.createElement("label");
        label.append(box, Object.assign(document.createElement("span"), { textContent: labels[i] }));
        pinned.append(" ", label);
      });
      set.append(Object.assign(document.createElement("legend"), { textContent: name }), askLabel, pinned);
      return set;
    }),
  );
}

// An emptied hour field is NaN, an error, not Number("")'s midnight.
function fromForm() {
  const clocks = [...rows.rows].map((tr) => {
    const [label, zone, city] = [...tr.querySelectorAll("input:not(.bar)")].map((i) => i.value.trim());
    const clock = city ? { label, zone, city } : { label, zone };
    if (!tr.querySelector("input.bar").checked) clock.bar = false;
    return clock;
  });
  const hours = Object.fromEntries(Object.entries(HOURS).map(([k, ids]) => [k, ids.map((id) => ($(id).value.trim() === "" ? NaN : Number($(id).value)))]));
  const apps = [...appRows.rows].flatMap((tr) => {
    const [name, url] = [...tr.querySelectorAll("input")].map((i) => i.value.trim());
    return name || url ? [{ command: tr.dataset.command, name, url }] : [];
  });
  const strength = num($("dim-strength"));
  const defaultMode = Object.fromEntries(Object.entries(START).map(([k, id]) => [k, $(id).value]));
  const modes = Object.fromEntries([...modeRows.rows].map((tr) => {
    const [share, count] = tr.querySelectorAll("input");
    return [tr.dataset.mode, { mfact: Number((num(share) / 100).toPrecision(12)), nmaster: num(count) }];
  }));
  const standing = standingFields().map((f) => f.value.trim());
  return { clocks, ...hours, apps, dimStrength: Number((strength / 100).toPrecision(12)), watched: [...watchedSites], defaultMode, modes, standing, homeApps: [...homeApps], workspaceSettings };
}

function toForm(settings) {
  rows.replaceChildren(...settings.clocks.map(clockRow));
  $("dim-strength").value = Number((settings.dimStrength * 100).toPrecision(12));
  watchedSites = [...settings.watched];
  standingRows.replaceChildren(...settings.standing.map(standingRow));
  markStanding();
  renderHomeApps(settings);
  renderWorkspaceSettings(settings);
  renderWatched();
  renderPermissions();
  appRows.replaceChildren(...APP_COMMANDS.map((c) => appRow(c, settings.apps.find((a) => a.command === c))));
  for (const [k, ids] of Object.entries(HOURS)) ids.forEach((id, i) => ($(id).value = settings[k][i]));
  for (const [k, id] of Object.entries(START)) $(id).value = settings.defaultMode[k];
  modeRows.replaceChildren(...Object.entries(settings.modes).map(([mode, o]) => modeRow(mode, o)));
  json.value = JSON.stringify(pick(settings, SHARED), null, 2);
}

// Saves the shared settings on the page, or says why not.
async function save(value = fromForm()) {
  const { settings, errors: found } = resolve(value);
  showErrors(found);
  if (found.length > 0) return false;
  await chrome.storage.sync.set({ [SETTINGS_KEY]: pick(settings, SHARED) });
  json.value = JSON.stringify(pick(settings, SHARED), null, 2);
  nameHomeApps(settings.apps);
  if (JSON.stringify([settings.standing, APP_COMMANDS.map((c) => appLabel(c, settings.apps))]) !== drawnFor) renderWorkspaceSettings(settings);
  return true;
}

// Start at login (§13.1): this Chromebook's list of websites, in order.
let startupSites = [];

function renderStartup() {
  $("startup").replaceChildren(
    ...startupSites.map((site, i) => {
      const li = document.createElement("li");
      const move = (by) => () => {
        const j = i + by;
        if (j < 0 || j >= startupSites.length) return;
        const previous = [...startupSites];
        [startupSites[i], startupSites[j]] = [startupSites[j], startupSites[i]];
        saveStartup(previous);
      };
      li.append(
        site,
        " ",
        button("↑", `Move ${site} up`, move(-1)),
        button("↓", `Move ${site} down`, move(1)),
        button("×", `Don't open ${site} at login`, () => {
          const previous = [...startupSites];
          startupSites = startupSites.filter((s) => s !== site);
          saveStartup(previous);
        }),
      );
      return li;
    }),
  );
}

// Saves the list, or says why not and puts back `previous`, the list as it
// was, so a change refused here isn't saved later by another field's save.
async function saveStartup(previous) {
  if (!(await saveLocal())) startupSites = previous;
  renderStartup();
}

// This Chromebook's layouts, kept apart from the shared settings.
const ruleRows = $("rules").tBodies[0];

// Shown as stored, so saving another field can't round a width away;
// toPrecision only drops float noise like 33.300000000000004.
const percent = (fraction) => Number((fraction * 100).toPrecision(12));

function ruleRow(r) {
  const tr = document.createElement("tr");
  const local = () => saveLocal();
  const aspect = input(r.minAspect, { className: "aspect", type: "number", step: "0.1", min: "1", max: "10", ariaLabel: "From aspect ratio" }, local);
  const width = input(r.width === undefined ? "" : percent(r.width), { className: "width", type: "number", step: "any", min: "10", max: "100", ariaLabel: "Width, percent" }, local);
  const cells = [aspect, width, button("×", "Remove", () => {
    tr.remove();
    saveLocal();
  })];
  for (const c of cells) {
    const td = document.createElement("td");
    td.append(c);
    tr.append(td);
  }
  return tr;
}

const num = (input) => (input.value.trim() === "" ? NaN : Number(input.value));

function layoutFromForm() {
  const singleRules = [...ruleRows.rows].map((tr) => {
    const [aspect, width] = tr.querySelectorAll("input");
    return { minAspect: num(aspect), width: Number((num(width) / 100).toPrecision(12)) };
  });
  // An empty step is no reminder, not an error.
  const wheelStep = $("wheel-step").value.trim() === "" ? null : num($("wheel-step"));
  return { singleRules, ultrawideAspect: num($("ultrawide")), wheelStep, startup: [...startupSites] };
}

function layoutToForm(settings) {
  ruleRows.replaceChildren(...settings.singleRules.map(ruleRow));
  $("ultrawide").value = settings.ultrawideAspect;
  $("wheel-step").value = settings.wheelStep ?? "";
  startupSites = [...settings.startup];
  renderStartup();
}

async function saveLocal() {
  const { settings, errors: found } = resolve(undefined, layoutFromForm());
  showErrors(found);
  if (found.length > 0) return false;
  // Merged in, so other overrides this Chromebook keeps stay.
  const kept = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  const base = kept && typeof kept === "object" && !Array.isArray(kept) ? kept : {};
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...base, ...pick(settings, PER_MACHINE) } });
  return true;
}

$("add-clock").addEventListener("click", () => {
  rows.append(clockRow({ label: "", zone: "" }));
  rows.lastElementChild.querySelector("input").focus();
});
for (const ids of Object.values(HOURS)) for (const id of ids) $(id).addEventListener("change", () => save());
$("dim-strength").addEventListener("change", () => save());
// Chrome asks for a site's access only from a click, so Add asks first and
// saves the site once it's granted.
$("watch-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let origin;
  try {
    origin = new URL($("watch-site").value.trim()).origin;
  } catch {
    showErrors([`"${$("watch-site").value}" isn't a site's address`]);
    return;
  }
  if (!origin.startsWith("https://")) {
    showErrors([`${origin} must be https`]);
    return;
  }
  if (!(await chrome.permissions.request({ origins: [pattern(origin)] }))) {
    showErrors([`tide needs access to ${origin} to show its unread counts`]);
    return;
  }
  if (!watchedSites.includes(origin)) watchedSites.push(origin);
  if (await save()) {
    $("watch-site").value = "";
    renderWatched();
  }
});

// A standing workspace is added at the end, or refused, saying why.
$("standing-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tr = standingRow($("standing-name").value.trim());
  standingRows.append(tr);
  if (await save()) $("standing-name").value = "";
  else tr.remove();
  markStanding();
});

$("startup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const previous = [...startupSites];
  startupSites.push($("startup-site").value.trim());
  if (await saveLocal()) {
    $("startup-site").value = "";
    // As the settings keep it, so the list shows what will open.
    startupSites = resolve(undefined, layoutFromForm()).settings.startup;
    renderStartup();
  } else startupSites = previous;
});

$("import").addEventListener("click", async () => {
  let value;
  try {
    value = JSON.parse(json.value);
  } catch (e) {
    showErrors([`The JSON doesn't parse: ${e.message}`]);
    return;
  }
  // null or a list would read as nothing stored, a reset nobody asked for.
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    showErrors(["The settings must be a JSON object, like {\"clocks\": [...]}"]);
    return;
  }
  const here = Object.keys(value).filter((k) => PER_MACHINE.includes(k));
  if (here.length > 0) {
    showErrors([`${here.join(", ")} ${here.length > 1 ? "are" : "is"} set for each Chromebook, on this page, not imported`]);
    return;
  }
  // Settings left out keep their defaults, as tide's files do.
  const whole = { ...pick(DEFAULT_SETTINGS, SHARED), ...value };
  if (await save(whole)) toForm(resolve(whole).settings);
});
$("reset").addEventListener("click", async () => {
  await chrome.storage.sync.remove(SETTINGS_KEY);
  showErrors([]);
  toForm(DEFAULT_SETTINGS);
});

$("zones").replaceChildren(
  ...Intl.supportedValuesOf("timeZone").map((z) => Object.assign(document.createElement("option"), { value: z })),
);
// The page edits the shared settings alone, so saving never copies this
// machine's overrides to the others. What's stored may predate a check, so
// say what was wrong with it.
// The keys checklist, refreshed when you come back from the shortcuts page.
async function renderKeys() {
  const bound = await chrome.commands.getAll();
  shortcuts = Object.fromEntries(bound.map((c) => [c.name, c.shortcut]));
  for (const tr of appRows.rows) tr.querySelector("kbd").textContent = shortcuts[tr.dataset.command] || "No key";
  const tiling = await tiles;
  const rows = checklist(chrome.runtime.getManifest().commands, bound).filter((r) => tiling || worksUntiled(r.name));
  // A command on another key is your choice (or Chrome's default off
  // chromeOS), so only an unbound one is still to do.
  const todo = rows.filter((r) => r.state === "unbound").length;
  $("keys-summary").textContent = todo === 0 ? "Every command has a key." : `${todo} of ${rows.length} commands have no key yet.`;
  // Still to do first, in manifest order.
  const order = { unbound: 0, other: 1, bound: 2 };
  $("keys").tBodies[0].replaceChildren(
    ...[...rows].sort((a, b) => order[a.state] - order[b.state]).map((r) => {
      const tr = document.createElement("tr");
      tr.className = r.state;
      const cells = [r.title, r.intended, r.state === "unbound" ? "not bound" : r.bound];
      for (const text of cells) tr.append(Object.assign(document.createElement("td"), { textContent: text }));
      return tr;
    }),
  );
}
// The setup checklist (§3.4): ticks are this Chromebook's, in storage.local.
async function renderSetup() {
  const { done, left } = progress((await chrome.storage.local.get(SETUP_KEY))[SETUP_KEY]);
  $("setup-summary").textContent = left === 0 ? "All done." : `${left} of ${ITEMS.length} still to do.`;
  $("setup").replaceChildren(
    ...ITEMS.map((item) => {
      const li = document.createElement("li");
      const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: done.includes(item.id), id: `setup-${item.id}` });
      box.addEventListener("change", () =>
        tick(chrome.storage.local, item.id, box.checked)
          .then(renderSetup)
          .catch((e) => showErrors([`Couldn't save the checklist: ${e.message}`])),
      );
      const label = Object.assign(document.createElement("label"), { htmlFor: box.id, textContent: item.title });
      const how = Object.assign(document.createElement("p"), { className: "muted", textContent: `${item.how} (${item.ref})` });
      li.append(box, label);
      if (item.where) {
        li.append(" ", button("Open", `Open the settings for: ${item.title}`, () =>
          openHere(item.where).catch((e) => showErrors([`Couldn't open ${item.where}: ${e.message}`])),
        ));
      }
      li.append(how);
      return li;
    }),
  );
}
$("open-shortcuts").addEventListener("click", () =>
  openHere("chrome://extensions/shortcuts").catch((e) => showErrors([`Couldn't open the shortcuts page: ${e.message}`])),
);
window.addEventListener("focus", () => renderKeys());
await renderKeys();
await renderSetup();
// Allowed or removed elsewhere too: the dashboard's offer of extras, or
// Chrome's own extension page.
chrome.permissions.onAdded.addListener(() => {
  renderPermissions();
  renderWatched();
});
chrome.permissions.onRemoved.addListener(() => {
  renderPermissions();
  renderWatched();
});
const shared = (await chrome.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY];
const { settings, errors: stored } = resolve(shared);
toForm(settings);
const local = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
const mine = resolve(undefined, local);
layoutToForm(mine.settings);
showErrors([...stored, ...mine.errors]);
const overrides = local && typeof local === "object" ? Object.keys(local).filter((k) => SHARED.includes(k)) : [];
if (overrides.length > 0) {
  $("overrides").textContent = `This Chromebook overrides ${overrides.join(", ")}, so those may differ here.`;
  $("overrides").hidden = false;
}
$("ultrawide").addEventListener("change", () => saveLocal());
$("wheel-step").addEventListener("change", () => saveLocal());
$("show-mouse").addEventListener("click", () =>
  openHere(chrome.runtime.getURL(MOUSE_PAGE)).catch((e) => showErrors([`Couldn't open the mouse page: ${e.message}`])),
);
$("add-rule").addEventListener("click", () => {
  ruleRows.append(ruleRow({}));
  ruleRows.lastElementChild.querySelector("input").focus();
});

// Another tab or Chromebook changed the settings: show theirs, so the
// next save here builds on them rather than undoing them. A change the page
// already shows, its own save included, leaves the form and its focus be.
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[SETTINGS_KEY];
  if (!change) return;
  if (area === "local") {
    const mine = resolve(undefined, change.newValue);
    const shown = resolve(undefined, layoutFromForm()).settings;
    if (JSON.stringify(pick(mine.settings, PER_MACHINE)) !== JSON.stringify(pick(shown, PER_MACHINE))) {
      layoutToForm(mine.settings);
    }
    return;
  }
  if (area !== "sync") return;
  const fresh = resolve(change.newValue);
  if (JSON.stringify(fresh.settings) === JSON.stringify(resolve(fromForm()).settings)) return;
  toForm(fresh.settings);
  showErrors(fresh.errors);
});

// Off chromeOS the tiling settings hide (§14.6), and Linux offers tide's tab
// list too.
async function renderBridge() {
  const allowed = await chrome.permissions.contains(BRIDGE_ACCESS);
  const status = allowed ? (await chrome.storage.session.get(BRIDGE_KEY))[BRIDGE_KEY] : null;
  const { state, detail } = bridgeText(allowed, status);
  $("bridge-state").textContent = state;
  $("bridge-detail").textContent = detail;
  $("bridge-detail").hidden = detail === "";
  const toggle = $("bridge-toggle");
  toggle.textContent = allowed ? "Turn off" : "Allow";
  toggle.setAttribute("aria-label", `${toggle.textContent}: tabs in tide's switcher`);
}

$("bridge-toggle").addEventListener("click", async () => {
  try {
    if (await chrome.permissions.contains(BRIDGE_ACCESS)) await chrome.permissions.remove(BRIDGE_ACCESS);
    else await chrome.permissions.request(BRIDGE_ACCESS);
  } catch (e) {
    showErrors([`Tabs in tide's switcher: ${e.message}`]);
  }
  renderBridge();
});

where.then((p) => {
  if (p.role === TILE) return;
  for (const el of document.querySelectorAll("[data-chromeos]")) el.hidden = true;
  $("untiled").hidden = false;
  $("untiled").textContent = `Changes apply as you make them, and follow you to every computer you sign in to. Tiling and workspaces work only on chromeOS, so on ${osName(p.os)} their keys do nothing and their settings aren't shown; the dashboard, its launcher and the app keys work here too.`;
  if (p.role !== TABS) return;
  $("linux").hidden = false;
  renderBridge();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[BRIDGE_KEY]) renderBridge();
  });
  chrome.permissions.onAdded.addListener(renderBridge);
  chrome.permissions.onRemoved.addListener(renderBridge);
});

// A section Launch found (§9.4), or the address's anchor: scrolled to once
// the platform's sections are shown or hidden, and again whenever Launch
// asks for another while this page is open. The request is cleared once
// shown, so a later visit opens at the top.
const SECTION_IDS = SETTINGS_SECTIONS.map((s) => s.id);
async function showSection() {
  try {
    const asked = (await chrome.storage.session.get(SECTION_KEY))[SECTION_KEY];
    const id = sectionToShow(location.hash, asked, SECTION_IDS);
    if (asked !== undefined) await chrome.storage.session.remove(SECTION_KEY);
    if (id === TOP) {
      window.scrollTo({ top: 0 });
      return;
    }
    const el = id && $(id);
    if (!el || el.hidden) return;
    el.scrollIntoView({ block: "start" });
    el.querySelector("h2")?.setAttribute("tabindex", "-1");
    el.querySelector("h2")?.focus({ preventScroll: true });
  } catch (e) {
    console.error("tide: couldn't show the settings section:", e);
  }
}
where.then(showSection);
window.addEventListener("hashchange", showSection);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[SECTION_KEY]?.newValue) {
    history.replaceState(null, "", location.pathname);
    showSection();
  }
});
