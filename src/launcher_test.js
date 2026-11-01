import { test } from "node:test";
import assert from "node:assert/strict";
import { footerKeys, footerText, fuzzyScore, items, logoTapped, nextScope, opening, rank, workspaceRows } from "./launcher.js";

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
  { id: 30, windowId: 3, title: "tide", url: "chrome-extension://tileco/src/launcher.html" },
];
const apps = [{ name: "Google Calendar", url: "https://calendar.google.com/", command: "app-calendar", key: "Search+C" }];
const commands = {
  "workspace-4": { description: "Go to workspace 4 (Search+4)" },
  "app-calendar": { description: "Open Google Calendar (Search+C)" },
};
const all = items({ tabs, apps, commands, workspaceOf: (w) => ({ 1: 2, 2: 1 })[w] ?? null, ownOrigin: "chrome-extension://tileco/" });

test("the items are tabs, apps and commands, without tileco's own pages", () => {
  assert.deepEqual(
    all.map((i) => [i.kind, i.title, i.detail, i.key ?? ""]),
    [
      ["tab", "Inbox (3) - Gmail", "tab on 2", ""],
      ["tab", "Design doc", "tab on 1", ""],
      ["app", "Google Calendar", "app", "Search+C"],
      ["command", "Go to workspace 4", "command", "Search+4"],
    ],
  );
});

test("with no query, the most recent tabs come first, then apps and commands", () => {
  assert.deepEqual(rank("", all).map((i) => i.title), ["Design doc", "Inbox (3) - Gmail", "Google Calendar", "Go to workspace 4"]);
});

test("a query ranks by match, then by recency", () => {
  assert.deepEqual(rank("cal", all).map((i) => i.title), ["Google Calendar"]);
  assert.equal(rank("gmail", all)[0].title, "Inbox (3) - Gmail");
  assert.equal(rank("docs.google", all)[0].title, "Design doc", "a tab's host counts too");
  assert.equal(rank("ws 4", all)[0].title, "Go to workspace 4");
});

test("a scope keeps to its kinds: launch is apps and commands, tabs is tabs", () => {
  assert.deepEqual(rank("", all, { scope: "launch" }).map((i) => i.kind), ["app", "command"]);
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

test("moving a window, home is refused, saying why, and the rest are offered", () => {
  assert.deepEqual(rows("", { move: true }).map(([, title]) => title), ["re", "oc", "me", "web", "docs"]);
  assert.deepEqual(rows("IN", { move: true }), [["refused", "in", "home holds only its own apps"]]);
  assert.deepEqual(rows("notes", { move: true }), [["new", "notes", "new workspace"]]);
  // Going there is fine.
  assert.deepEqual(rows("in")[0], ["workspace", "in", "home · 2 windows"]);
});

test("moving one of home's apps' windows, home is offered", () => {
  assert.deepEqual(rows("", { move: true, allowHome: true }).map(([, title]) => title), ["in", "re", "oc", "me", "web", "docs"]);
  assert.deepEqual(rows("IN", { move: true, allowHome: true })[0], ["workspace", "in", "home · 2 windows"]);
  assert.equal(workspaceRows({ ...view, query: "in", move: true, allowHome: true })[0].workspace, "in");
});

test("the page's address says how it opened: home, the dashboard, or a name prompt", () => {
  const how = (home, scope, move = false, allowHome = false, name = "") => ({ home, scope, move, allowHome, name });
  assert.deepEqual(opening("?mode=home"), how(true, "launch"));
  assert.deepEqual(opening("?mode=dashboard"), how(false, "tabs"));
  assert.deepEqual(opening("?mode=dashboard&scope=workspaces"), how(false, "workspaces"));
  assert.deepEqual(opening("?mode=dashboard&scope=workspaces&move=1"), how(false, "workspaces", true));
  assert.deepEqual(opening("?mode=home&scope=workspaces&move=1"), how(true, "launch"), "home's page moves nothing");
  // A home app's window may go home; a new window's prompt starts with its name.
  assert.deepEqual(opening("?mode=dashboard&scope=workspaces&move=1&allowHome=1"), how(false, "workspaces", true, true));
  assert.deepEqual(opening("?mode=dashboard&scope=workspaces&allowHome=1"), how(false, "workspaces"), "only a move goes anywhere");
  assert.deepEqual(opening(`?mode=dashboard&scope=workspaces&move=1&name=${encodeURIComponent("PR-12 & co")}`), how(false, "workspaces", true, false, "PR-12 & co"));
  assert.deepEqual(opening("?mode=dashboard&name=x"), how(false, "tabs"), "only the prompt has a field to fill");
});

test("Tab steps through the scopes, Shift+Tab back, skipping those not shown", () => {
  assert.equal(nextScope("launch"), "tabs");
  assert.equal(nextScope("tabs"), "workspaces");
  assert.equal(nextScope("workspaces"), "launch");
  assert.equal(nextScope("launch", -1), "workspaces");
  assert.equal(nextScope("tabs", 1, ["launch", "tabs"]), "launch");
  assert.equal(nextScope("workspaces", 1, ["workspaces"]), "workspaces");
});

test("the Workspaces footer says where Enter goes, and the move prompt has no Tab", () => {
  assert.equal(
    footerText(footerKeys("workspaces", { home: false, tabsAllowed: true })),
    "Enter to go there · ↑ ↓ to choose · Tab to switch to Launch · Esc to clear or close",
  );
  assert.equal(
    footerText(footerKeys("workspaces", { home: false, tabsAllowed: false, move: true, scopes: ["workspaces"] })),
    "Enter to move the window there · ↑ ↓ to choose · Esc to clear or close",
  );
});
