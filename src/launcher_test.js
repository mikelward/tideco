import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actions, arrowStep, barAtBottom, BAR_SECTIONS, footerKeys, footerText, fuzzyScore, items, limitFor, logoTapped, nextScope, opening, rank, sectionToShow, settingsSections, SETTINGS_SECTIONS, TOP, workspaceRows } from "./launcher.js";

test("a fuzzy match needs every query letter in order", () => {
  assert.equal(fuzzyScore("cal", "Google Calendar") > 0, true);
  assert.equal(fuzzyScore("gc", "Google Calendar") > 0, true);
  assert.equal(fuzzyScore("xyz", "Google Calendar"), null);
  assert.equal(fuzzyScore("lac", "Calendar"), null, "out of order");
});

test("word starts and runs score higher", () => {
  assert.ok(fuzzyScore("gc", "Google Calendar") > fuzzyScore("gc", "biggcat"), "word starts beat the middle of a word");
  assert.ok(fuzzyScore("cal", "Calendar") > fuzzyScore("cal", "Chat, all"), "a run beats scattered letters");
});

const tabs = [
  { id: 10, windowId: 1, title: "Inbox (3) - Gmail", url: "https://mail.google.com/mail/u/0/", lastAccessed: 300 },
  { id: 20, windowId: 2, title: "Design doc", url: "https://docs.google.com/document/d/1", lastAccessed: 500 },
  { id: 30, windowId: 3, title: "tide", url: "chrome-extension://tide/src/launcher.html" },
];
const apps = [{ name: "Google Calendar", url: "https://calendar.google.com/", command: "app-calendar", key: "Search+C" }];
const commands = {
  "workspace-4": { description: "Go to workspace 4 (Search+4)" },
  "app-calendar": { description: "Open Google Calendar (Search+C)" },
};
const all = items({ tabs, apps, commands, workspaceOf: (w) => ({ 1: 2, 2: 1 })[w] ?? null, ownOrigin: "chrome-extension://tide/" });

test("the items are tabs, apps, Tide Settings and commands, without tide's own pages", () => {
  assert.deepEqual(
    all.map((i) => [i.kind, i.title, i.detail, i.key ?? ""]),
    [
      ["tab", "Inbox (3) - Gmail", "tab on 2", ""],
      ["tab", "Design doc", "tab on 1", ""],
      ["app", "Google Calendar", "app", "Search+C"],
      ["app", "Tide Settings", "settings", ""],
      ["command", "Go to workspace 4", "command", "Search+4"],
    ],
  );
});

test("with no query, the most recent tabs come first, then apps and commands", () => {
  assert.deepEqual(rank("", all).map((i) => i.title), ["Design doc", "Inbox (3) - Gmail", "Google Calendar", "Tide Settings", "Go to workspace 4"]);
});

test("a query ranks by match, then by recency", () => {
  assert.deepEqual(rank("cal", all).map((i) => i.title), ["Google Calendar"]);
  assert.equal(rank("gmail", all)[0].title, "Inbox (3) - Gmail");
  assert.equal(rank("docs.google", all)[0].title, "Design doc", "a tab's host counts too");
  assert.equal(rank("ws 4", all)[0].title, "Go to workspace 4");
});

test("a scope keeps to its kinds: launch lists apps, and finds commands too; tabs is tabs", () => {
  assert.deepEqual(rank("", all, { scope: "launch" }).map((i) => i.title), ["Google Calendar", "Tide Settings"]);
  assert.deepEqual(rank("ws 4", all, { scope: "launch" }).map((i) => i.title), ["Go to workspace 4"]);
  assert.deepEqual(rank("", all, { scope: "tabs" }).map((i) => i.title), ["Design doc", "Inbox (3) - Gmail"]);
  assert.deepEqual(rank("google", all, { scope: "launch" }).map((i) => i.title), ["Google Calendar"]);
});

test("a query with no match in its scope looks in every scope", () => {
  assert.equal(rank("gmail", all, { scope: "launch" })[0].title, "Inbox (3) - Gmail");
  assert.deepEqual(rank("zzz", all, { scope: "launch" }), []);
});

test("a tab on an app's site matches by the app's name", () => {
  // A name that's in neither the tab's title nor its host.
  const agenda = [{ name: "Agenda", url: "https://calendar.google.com/", command: "app-calendar" }];
  const week = { id: 40, windowId: 4, title: "Week of October 19", url: "https://calendar.google.com/calendar/u/0/r" };
  const found = items({ tabs: [...tabs, week], apps: agenda });
  assert.deepEqual(rank("agenda", found, { scope: "tabs" }).map((i) => i.title), ["Week of October 19"]);
  assert.equal(found.find((i) => i.tabId === 20).app, null, "a site no app has");
});

// tide's switcher footer names only the keys that work on the tab you're on.
test("the footer names only the keys that work in each scope", () => {
  assert.deepEqual(footerKeys("launch", { home: true, tabsAllowed: true }), [
    ["Enter", "run"],
    ["↑ ↓", "choose"],
    ["Tab", "switch to Tabs"],
    ["Esc", "clear"],
  ]);
  assert.deepEqual(footerKeys("tabs", { home: false, tabsAllowed: true }), [
    ["Enter", "go there"],
    ["↑ ↓", "choose"],
    ["Tab", "switch to Workspaces"],
    ["Esc", "clear or close"],
  ]);
  // Off chromeOS there's no Workspaces scope to switch to.
  assert.deepEqual(footerKeys("tabs", { home: false, tabsAllowed: true, scopes: ["launch", "tabs"] })[2], ["Tab", "switch to Launch"]);
  // Without tab access the Tabs scope has one row, so nothing to choose.
  assert.deepEqual(footerKeys("tabs", { home: false, tabsAllowed: false }), [
    ["Enter", "allow tab search"],
    ["Tab", "switch to Workspaces"],
    ["Esc", "clear or close"],
  ]);
  assert.equal(footerText(footerKeys("launch", { home: true, tabsAllowed: true })), "Enter to run · ↑ ↓ to choose · Tab to switch to Tabs · Esc to clear");
});

// tide's wave logo opens the launcher, or closes it where it's open.
test("a tap on the logo closes the dashboard and brings home's launcher to Launch", () => {
  assert.equal(logoTapped({ home: false }), "close");
  assert.equal(logoTapped({ home: true }), "launch");
});

// The Workspaces scope (§6.1, §9.4), as the view describes the workspaces.
const view = {
  bar: ["in", "re", "oc", "me", "web", "docs"],
  made: ["in", "re", "oc", "web", "docs"],
  counts: { in: 2, re: 1, oc: 0, me: 0, web: 3, docs: 0 },
  current: "docs",
};
const rows = (query, more = {}) => workspaceRows({ ...view, query, ...more }).map((r) => [r.kind, r.title, r.detail]);

test("the Workspaces scope lists every workspace in bar order, with tide's words for each", () => {
  assert.deepEqual(rows(""), [
    ["workspace", "in", "home · 2 windows"],
    ["workspace", "re", "1 window"],
    ["workspace", "oc", "empty"],
    ["workspace", "me", "not made yet"],
    ["workspace", "web", "3 windows"],
    ["workspace", "docs", "current"],
  ]);
  assert.deepEqual(workspaceRows({ ...view, query: "" })[3].workspace, "me", "Enter on one shows it by name");
});

test("typing filters the workspaces, a new name coming first, to be made", () => {
  assert.deepEqual(rows("o"), [["new", "o", "new workspace"], ["workspace", "oc", "empty"], ["workspace", "docs", "current"]]);
  // Trimmed, as the name is made.
  const [made] = workspaceRows({ ...view, query: "  notes " });
  assert.deepEqual([made.kind, made.workspace], ["new", "notes"]);
  assert.deepEqual(rows("notes"), [["new", "notes", "new workspace"]], "nothing else matches");
});

test("a new window's short name, untouched, comes first with every workspace after it", () => {
  const titles = (query) => workspaceRows({ ...view, query, suggested: true }).map((r) => [r.kind, r.title]);
  assert.deepEqual(titles("ABC-123"), [["new", "ABC-123"], ...view.bar.map((n) => ["workspace", n])]);
  // A workspace's name: that one first, then the rest, once each.
  assert.deepEqual(titles("web").map(([, t]) => t), ["web", ...view.bar.filter((n) => n !== "web")]);
  // Typed, it filters.
  assert.deepEqual(rows("ABC-123"), [["new", "ABC-123", "new workspace"]]);
});

test("a name typed in another case is that workspace's, first, with nothing to make", () => {
  assert.deepEqual(rows("WEB")[0], ["workspace", "web", "3 windows"]);
  assert.ok(!rows("WEB").some(([kind]) => kind === "new"));
  // A standing one not made yet, too.
  assert.deepEqual(rows("Me"), [["workspace", "me", "not made yet"]]);
  // The exact name, then the others that match.
  assert.deepEqual(rows("OC").map(([, title]) => title), ["oc", "docs"]);
});

test("a name that can't be one says why, in a row that can't be chosen", () => {
  const [bad] = workspaceRows({ ...view, query: 'o"c' });
  assert.deepEqual([bad.kind, bad.title, bad.workspace], ["refused", 'o"c', undefined]);
  assert.match(bad.detail, /can't have quotes/);
  assert.match(workspaceRows({ ...view, query: "x".repeat(33) })[0].detail, /at most 32 characters/);
});

test("moving any window, home is offered with the rest", () => {
  assert.deepEqual(rows("", { move: true }).map(([, title]) => title), ["in", "re", "oc", "me", "web", "docs"]);
  assert.deepEqual(rows("IN", { move: true })[0], ["workspace", "in", "home · 2 windows"]);
  assert.equal(workspaceRows({ ...view, query: "in", move: true })[0].workspace, "in");
  assert.deepEqual(rows("notes", { move: true }), [["new", "notes", "new workspace"]]);
});

test("the page's address says how it opened: home, the dashboard, or a name prompt", () => {
  const how = (home, scope, move = false, name = "") => ({ home, scope, move, name });
  assert.deepEqual(opening("?mode=home"), how(true, "launch"));
  assert.deepEqual(opening("?mode=dashboard"), how(false, "tabs"));
  assert.deepEqual(opening("?mode=dashboard&scope=workspaces"), how(false, "workspaces"));
  assert.deepEqual(opening("?mode=dashboard&scope=workspaces&move=1"), how(false, "workspaces", true));
  assert.deepEqual(opening("?mode=home&scope=workspaces&move=1"), how(true, "launch"), "home's page moves nothing");
  // A new window's prompt starts with its name.
  assert.deepEqual(opening(`?mode=dashboard&scope=workspaces&move=1&name=${encodeURIComponent("PR-12 & co")}`), how(false, "workspaces", true, "PR-12 & co"));
  assert.deepEqual(opening("?mode=dashboard&name=x"), how(false, "tabs"), "only the prompt has a field to fill");
});

test("Tab steps through the scopes, Shift+Tab back, skipping those not shown", () => {
  assert.equal(nextScope("launch"), "tabs");
  assert.equal(nextScope("tabs"), "workspaces");
  assert.equal(nextScope("workspaces"), "actions");
  assert.equal(nextScope("actions"), "launch");
  assert.equal(nextScope("launch", -1), "actions");
  assert.equal(nextScope("tabs", 1, ["launch", "tabs", "actions"]), "actions", "off chromeOS, past the missing Workspaces");
  assert.equal(nextScope("tabs", 1, ["launch", "tabs"]), "launch");
  assert.equal(nextScope("workspaces", 1, ["workspaces"]), "workspaces");
});

test("the Workspaces footer says where Enter goes, and the move prompt has no Tab", () => {
  assert.equal(
    footerText(footerKeys("workspaces", { home: false, tabsAllowed: true })),
    "Enter to go there · ↑ ↓ to choose · Tab to switch to Actions · Esc to clear or close",
  );
  assert.equal(
    footerText(footerKeys("workspaces", { home: false, tabsAllowed: false, move: true, scopes: ["workspaces"] })),
    "Enter to move the window there · ↑ ↓ to choose · Esc to clear or close",
  );
});

// Tide Settings and its sections (§9.4): the app is listed with the apps,
// each section only found by a query, by its name, Tide Settings, or what it
// covers, and only those the options page shows here.
const withSettings = items({ apps, sections: settingsSections(), commands });

test("Launch lists Tide Settings with the apps, but no section until you type", () => {
  assert.deepEqual(rank("", withSettings, { scope: "launch" }).map((i) => i.title), ["Google Calendar", "Tide Settings"]);
  const [found] = rank("clocks", withSettings, { scope: "launch" });
  assert.deepEqual([found.kind, found.title, found.detail, found.section], ["setting", "Clocks", "Tide Settings", "clocks-section"]);
  assert.equal(rank("time zone", withSettings, { scope: "launch" })[0].title, "Clocks", "by what it covers");
  assert.ok(rank("tide settings", withSettings, { scope: "launch" }).length > 2, "every section is Tide Settings'");
  assert.equal(rank("", withSettings).some((i) => i.kind === "setting"), false, "nor with no scope");
});

test("each platform gets the sections its options page shows", () => {
  const ids = (where) => settingsSections(where).map((s) => s.id);
  assert.ok(ids({ tiling: true }).includes("workspaces"));
  assert.ok(!ids({ tiling: true }).includes("linux"));
  assert.deepEqual(ids({ tiling: false, linux: true }), ["keys-section", "apps-section", "clocks-section", "extras", "linux", "import-section"]);
  assert.deepEqual(ids({ tiling: false }), ["keys-section", "apps-section", "clocks-section", "extras", "import-section"]);
});

test("the options page shows its address's section, else the one Launch asked for", () => {
  const ids = SETTINGS_SECTIONS.map((s) => s.id);
  assert.equal(sectionToShow("#dim", "mouse", ids), "dim");
  assert.equal(sectionToShow("", "mouse", ids), "mouse");
  assert.equal(sectionToShow("", undefined, ids), null);
  assert.equal(sectionToShow("#nowhere", undefined, ids), null);
  // The bar's logo asks for the top, so an open tab scrolls back up.
  assert.equal(sectionToShow("", TOP, ids), TOP);
});

// The Actions scope (§9.4): tide's own actions, then its commands.
test("Actions lists keep awake, the dim and reloading, saying which are on", () => {
  const rows = (opts) => actions(opts).map((a) => [a.title, a.detail]);
  assert.deepEqual(rows({ keepAwake: true, dim: { granted: true, on: false } }), [
    ["Keep awake", "on"],
    ["Dim inactive windows", "off"],
    ["Reload tide", "restarts the extension"],
  ]);
  assert.deepEqual(rows({ dim: { granted: false, on: true } })[1], ["Dim inactive windows", "off · Chrome asks first"]);
  // Off chromeOS there's no dim.
  assert.deepEqual(rows({}).map(([title]) => title), ["Keep awake", "Reload tide"]);
  assert.equal(actions({ key: (c) => (c === "keep-awake" ? "Search+S" : "") })[0].key, "Search+S");
});

test("Actions lists every action and command with nothing typed; keep awake once", () => {
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`workspace-${i}`, { description: `Go to ${i} (Search+${i})` }]));
  const list = items({ apps, actions: actions({ dim: { granted: true, on: true } }), commands: { ...many, "keep-awake": { description: "Toggle keep awake (Search+S)" } } });
  const shown = rank("", list, { scope: "actions", limit: limitFor("actions", "") });
  assert.deepEqual(shown.slice(0, 3).map((i) => i.title), ["Keep awake", "Dim inactive windows", "Reload tide"]);
  assert.equal(shown.length, 15, "every one, past the usual eight");
  assert.equal(shown.filter((i) => /keep awake/i.test(i.title)).length, 1);
  assert.equal(limitFor("actions", "re"), 8, "a query shows the best eight");
  assert.equal(limitFor("launch", ""), 8);
  // Launch finds an action by name too.
  assert.equal(rank("reload", list, { scope: "launch" })[0].title, "Reload tide");
});

test("the Actions footer runs, and Tab goes round to Launch", () => {
  assert.equal(
    footerText(footerKeys("actions", { home: false, tabsAllowed: true })),
    "Enter to run · ↑ ↓ to choose · Tab to switch to Launch · Esc to clear or close",
  );
});

test("a right-click on each bar item opens a settings section, or the top", () => {
  const page = readFileSync(new URL("./launcher.html", import.meta.url), "utf8");
  const ids = SETTINGS_SECTIONS.map((s) => s.id);
  for (const [id, section] of Object.entries(BAR_SECTIONS)) {
    assert.match(page, new RegExp(`id="${id}"`), `${id} is on the bar`);
    assert.ok(section === TOP || ids.includes(section), `${id} opens ${section}, which isn't a section`);
  }
  assert.equal(BAR_SECTIONS.workspaces, "workspaces");
  assert.equal(BAR_SECTIONS.clocks, "clocks-section");
  assert.equal(BAR_SECTIONS.logo, TOP);
});

// The overview has no key yet (§6.5), so the dashboard is a way to it: its
// command is in Actions, and Launch finds it.
test("the dashboard finds the overview, which has no key to show", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url))).commands;
  const list = items({ commands: manifest });
  const row = list.find((i) => i.command === "overview");
  assert.deepEqual({ title: row.title, key: row.key }, { title: "Overview of every workspace's windows", key: "" });
  assert.ok(rank("", list, { scope: "actions", limit: Infinity }).includes(row));
  assert.equal(rank("overview", list, { scope: "launch" })[0]?.command, "overview");
});

test("the bar is at the top unless the settings put it at the bottom", () => {
  assert.equal(barAtBottom({ barPosition: "top" }), false);
  assert.equal(barAtBottom({ barPosition: "bottom" }), true);
  // tide for macOS's settings have no barPosition yet.
  assert.equal(barAtBottom({}), false);
  assert.equal(barAtBottom(undefined), false);
});

test("the arrow pointing away from the field goes on to the next result", () => {
  assert.equal(arrowStep("ArrowDown"), 1);
  assert.equal(arrowStep("ArrowUp"), -1);
  // With the bar at the bottom the results run up from the field.
  assert.equal(arrowStep("ArrowUp", true), 1);
  assert.equal(arrowStep("ArrowDown", true), -1);
});
