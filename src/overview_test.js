// Tests for overview.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPS } from "./apps.js";
import { card, cardsOf, filtered, focusedIn, groups, keep, notes, step } from "./overview.js";
import * as ws from "./workspaces.js";

const tab = (url, title, extra = {}) => ({ id: 1, active: true, url, title, favIconUrl: `${url}favicon.ico`, ...extra });
const win = (id, url, title, extra = {}) => ({ id, type: "normal", tabs: [tab(url, title)], ...extra });

// "in" showing with windows 1 (tiled) and 2 (floating), "me" with 3, and
// "notes" with 4 and 5 across two displays.
function state() {
  let s = ws.create(["a", "b"]);
  s = ws.addWindow(s, 1, "a");
  s = ws.addWindow(s, 2, "a", { floating: true });
  s = ws.addWindow(s, 3, "a", { to: "me" });
  s = ws.addWindow(s, 5, "b", { to: "notes" });
  s = ws.addWindow(s, 4, "a", { to: "notes" });
  s = ws.focused(s, 2);
  return s;
}
const windows = [
  win(1, "https://mail.google.com/", "Inbox (3)"),
  win(2, "https://example.com/", "Example"),
  win(3, "https://calendar.google.com/", "Calendar", { type: "popup" }),
  win(4, "https://news.example.com/", "News", { tabs: [tab("https://news.example.com/", "News"), tab("https://a.example/", "A", { active: false })] }),
  win(5, "https://docs.example.com/", "Doc"),
];

test("the workspace showing comes first, then the rest in bar order, each window once", () => {
  const s = ws.show(state(), "me");
  const g = groups({ state: s, windows, apps: DEFAULT_APPS });
  assert.deepEqual(g.map((x) => x.name), ["me", "in", "notes"]);
  assert.deepEqual(g.map((x) => x.current), [true, false, false]);
  assert.deepEqual(cardsOf(g).map((c) => c.id), [3, 1, 2, 4, 5]);
});

test("cards go display by display, tiles before floats", () => {
  const g = groups({ state: state(), windows });
  assert.deepEqual(g.find((x) => x.name === "in").cards.map((c) => c.id), [1, 2], "the float last");
  assert.deepEqual(g.find((x) => x.name === "notes").cards.map((c) => c.id), [4, 5], "display a's first");
});

test("the workspace showing is listed with no windows; others aren't", () => {
  const g = groups({ state: ws.show(state(), "re"), windows });
  assert.equal(g[0].name, "re");
  assert.deepEqual(g[0].cards, []);
  assert.ok(!g.some((x) => x.name === "oc"), "a standing workspace with nothing on it");
});

test("a window tide tracks that has closed has no card", () => {
  const g = groups({ state: state(), windows: windows.filter((w) => w.id !== 2) });
  assert.deepEqual(g[0].cards.map((c) => c.id), [1]);
});

test("a card has its title, app, icon and picture", () => {
  const c = card(windows[2], { app: "app-calendar" }, { apps: DEFAULT_APPS, pictures: { 3: { url: "data:x", at: 1 } } });
  assert.deepEqual(c, {
    id: 3,
    title: "Calendar",
    app: "Google Calendar",
    detail: "Google Calendar",
    icon: "https://calendar.google.com/favicon.ico",
    picture: "data:x",
    minimized: false,
  });
  const news = card(windows[3], {});
  assert.equal(news.app, "Browser window");
  assert.equal(news.detail, "Browser window · 2 tabs");
  assert.equal(card(windows[1], { minimizedByYou: true }).detail, "Browser window · minimized");
});

test("without tab access a card names its app, by the key that opened it", () => {
  const hidden = { id: 3, type: "popup", tabs: [{ id: 30, active: true }] };
  const c = card(hidden, { app: "app-chat" }, { apps: DEFAULT_APPS });
  assert.equal(c.title, "Google Chat");
  assert.equal(c.detail, "", "and doesn't say it twice");
  assert.equal(card({ ...hidden, type: "normal", tabs: [{ id: 30, active: true }, { id: 31 }] }, {}).detail, "2 tabs");
  assert.equal(c.icon, null);
  assert.equal(card({ id: 9, type: "app", tabs: [{ id: 90, active: true }] }, {}).title, "App");
  assert.equal(card({ id: 9, type: "app", tabs: [{ id: 90, active: true, url: "https://x.example/" }] }, {}).app, "x.example");
});

test("typing filters by title and app, and drops emptied groups", () => {
  const all = groups({ state: state(), windows, apps: DEFAULT_APPS });
  assert.deepEqual(cardsOf(filtered(all, "inbx")).map((c) => c.id), [1]);
  assert.deepEqual(cardsOf(filtered(all, "browser")).map((c) => c.id), [1, 2, 4, 5]);
  assert.deepEqual(filtered(all, "calendar").map((g) => g.name), ["me"]);
  assert.deepEqual(filtered(all, "zzz"), []);
  const empty = groups({ state: ws.show(state(), "re"), windows });
  assert.deepEqual(filtered(empty, "").map((g) => g.name), ["re", "in", "me", "notes"], "nothing typed keeps the one showing");
});

test("the arrows step through the cards, stopping at the ends", () => {
  const cards = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.equal(step(cards, 1, 1), 2);
  assert.equal(step(cards, 3, 1), 3);
  assert.equal(step(cards, 1, -1), 1);
  assert.equal(step([], 1, 1), null);
  assert.equal(keep(cards, 2), 2);
  assert.equal(keep(cards, 9), 1, "a window filtered out gives way to the first");
  assert.equal(keep([], 9), null);
});

test("the overview starts on the window you were in", () => {
  assert.equal(focusedIn(state()), 2);
  assert.equal(focusedIn(null), null);
});

test("it says what it can't show, and why", () => {
  assert.deepEqual(notes({ tabs: true, pictures: true }), []);
  assert.deepEqual(notes({ tabs: true, pictures: false }), ["No pictures: they need the dim's access"]);
  assert.deepEqual(notes({ tabs: false, pictures: false }), ["No titles: they need tab search", "No pictures: they need the dim's access"]);
  assert.deepEqual(notes({ tabs: false, pictures: true }), [], "all-sites access shows titles too");
});
