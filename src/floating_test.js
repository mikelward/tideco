// Tests for floating.js, the float rules (SPEC.md §5.4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { askBounds, askFloat, askText, checkFloating, checkSite, coveringRule, floatingNow, MAX_RULES, movedRule, newlyCovered, ruleable, siteName, siteOf, withoutRule, withRule } from "./floating.js";

const MEET = "https://meet.google.com";
const CHAT = "https://chat.google.com";
const win = (id, url, extra = {}) => ({ id, type: "app", tabs: [{ id: id * 10, active: true, url, title: `title ${id}` }], ...extra });

test("a site is its origin, typed with or without https", () => {
  assert.deepEqual(checkSite("https://meet.google.com/abc-defg?x=1"), { site: MEET });
  assert.deepEqual(checkSite("  meet.google.com "), { site: MEET });
  assert.deepEqual(checkSite("http://localhost:8080/app"), { site: "http://localhost:8080" });
  assert.match(checkSite("").error, /type a site's address/);
  assert.match(checkSite("chrome-extension://abc/x.html").error, /isn't a website/);
  assert.match(checkSite("http://").error, /isn't a site's address/);
});

test("stored rules load as origins, and a bad one names its place", () => {
  assert.deepEqual(checkFloating([{ site: "https://meet.google.com/x" }, { site: "chat.google.com" }]), [{ site: MEET }, { site: CHAT }]);
  assert.throws(() => checkFloating({}), /must be a list/);
  assert.throws(() => checkFloating(["meet.google.com"]), /rule 1 must be an object/);
  assert.throws(() => checkFloating([{ site: MEET, title: "x" }]), /rule 1: title isn't site/);
  assert.throws(() => checkFloating([{ site: MEET }, { site: "ftp://x" }]), /rule 2: "ftp:\/\/x" isn't a website/);
  assert.throws(() => checkFloating([{ site: MEET }, { site: `${MEET}/other` }]), /rule 2: https:\/\/meet\.google\.com is listed already/);
  const many = Array.from({ length: MAX_RULES + 1 }, (_, i) => ({ site: `https://s${i}.example.com` }));
  assert.throws(() => checkFloating(many), /more than 64/);
});

test("a site's name is its host, which reads back as the same site", () => {
  assert.equal(siteName(MEET), "meet.google.com");
  assert.equal(checkSite(siteName(MEET)).site, MEET);
  assert.equal(siteName("http://localhost:8080"), "http://localhost:8080", "http keeps its scheme");
  assert.equal(checkSite(siteName("http://localhost:8080")).site, "http://localhost:8080");
});

test("a window's site is its active tab's, or where it's going", () => {
  assert.equal(siteOf(win(1, "https://meet.google.com/abc")), MEET);
  assert.equal(siteOf({ tabs: [{ active: true, url: "", pendingUrl: "https://chat.google.com/" }] }), CHAT);
  assert.equal(siteOf(win(1, "chrome://newtab/")), null, "not a website");
  assert.equal(siteOf({ tabs: [{ active: true }] }), null, "Chrome hides the address without tab search");
  assert.equal(siteOf({}), null);
});

test("only app windows can be covered: installed web apps and tide's app popups", () => {
  assert.equal(ruleable({ id: 1, type: "app" }, new Set()), true);
  assert.equal(ruleable({ id: 2, type: "popup" }, new Set([2])), true);
  assert.equal(ruleable({ id: 3, type: "popup" }, new Set()), false);
  assert.equal(ruleable({ id: 4, type: "normal" }, new Set()), false, "a tab window's site changes with its tabs");
});

test("a rule covers its site's windows", () => {
  const rules = [{ site: CHAT }, { site: MEET }];
  assert.equal(coveringRule(rules, MEET), 1);
  assert.equal(coveringRule(rules, "https://example.com"), -1);
  assert.equal(coveringRule(rules, null), -1);
});

test("a new rule floats the tiled windows it covers, and nothing else", () => {
  const windows = [
    { id: 1, site: MEET, floating: false, big: false },
    { id: 2, site: MEET, floating: true, big: false },
    { id: 3, site: MEET, floating: false, big: true },
    { id: 4, site: CHAT, floating: false, big: false },
    { id: 5, site: null, floating: false, big: false },
  ];
  assert.deepEqual(newlyCovered(windows, [], [{ site: MEET }]), [1], "not one floating, maximized or of another site");
  assert.deepEqual(newlyCovered(windows, [{ site: MEET }], [{ site: CHAT }, { site: MEET }]), [4], "one tiled by hand under its rule stays tiled");
  assert.deepEqual(newlyCovered(windows, [{ site: CHAT }, { site: MEET }], [{ site: MEET }, { site: CHAT }]), [], "a reorder floats nothing");
  assert.deepEqual(newlyCovered(windows, [{ site: MEET }], []), [], "taking one out floats nothing");
  assert.deepEqual(newlyCovered(windows, undefined, [{ site: MEET }]), [], "with no rules before, nothing says what they met");
});

test("rules are added, moved and taken out, a stale change refused", () => {
  const { rules } = withRule([{ site: CHAT }], "meet.google.com");
  assert.deepEqual(rules, [{ site: CHAT }, { site: MEET }]);
  assert.match(withRule(rules, "https://meet.google.com/x").error, /meet\.google\.com is listed already/);
  assert.match(withRule(rules, "").error, /type a site's address/);
  const full = Array.from({ length: MAX_RULES }, (_, i) => ({ site: `https://s${i}.example.com` }));
  assert.match(withRule(full, MEET).error, /as many as there can be/);
  assert.deepEqual(movedRule(rules, 1, MEET, -1).rules, [{ site: MEET }, { site: CHAT }]);
  assert.deepEqual(movedRule(rules, 0, CHAT, -1).rules, rules, "past the top stays");
  assert.match(movedRule(rules, 0, MEET, 1).error, /changed since/);
  assert.deepEqual(withoutRule(rules, 0, CHAT).rules, [{ site: MEET }]);
  assert.match(withoutRule(rules, 5, CHAT).error, /changed since/);
});

test("Floating now lists the floating app windows no rule covers, one per site", () => {
  const state = { appPopups: [4], windows: { 1: { floating: true }, 2: { floating: true }, 3: { floating: false }, 4: { floating: true }, 5: { floating: true }, 6: { floating: true } } };
  const windows = [
    win(1, "https://meet.google.com/a"),
    win(2, "https://meet.google.com/b"),
    win(3, "https://example.com/"),
    win(4, "https://chat.google.com/", { type: "popup" }),
    win(5, "https://docs.google.com/", { type: "normal" }),
    win(6, "https://calendar.google.com/"),
    win(7, "https://music.youtube.com/"),
  ];
  assert.deepEqual(floatingNow(state, windows, [{ site: "https://calendar.google.com" }]), [
    { id: 1, site: MEET, title: "title 1" },
    { id: 4, site: CHAT, title: "title 4" },
  ]);
  assert.deepEqual(floatingNow(undefined, windows, []), [], "no state yet");
});

test("tide asks about a site once, and never about one a rule covers", () => {
  let { ask, asked } = askFloat(undefined, [], MEET);
  assert.equal(ask, true);
  assert.deepEqual(asked, [MEET]);
  ({ ask, asked } = askFloat(asked, [], MEET));
  assert.equal(ask, false, "asked already, whatever the answer");
  assert.equal(askFloat([], [{ site: MEET }], MEET).ask, false);
  assert.equal(askFloat([], [], null).ask, false, "a site Chrome hides");
  assert.deepEqual(askFloat("junk", [], CHAT).asked, [CHAT], "a bad record starts again");
});

test("the question sits in the work area's bottom-right corner, and says what a rule does", () => {
  assert.deepEqual(askBounds({ left: 0, top: 0, width: 1920, height: 1032 }), { left: 1484, top: 846, width: 420, height: 170 });
  assert.deepEqual(askBounds({ left: 1920, top: 0, width: 300, height: 100 }), { left: 1920, top: 0, width: 300, height: 100 }, "never past a small display");
  assert.deepEqual(askText(MEET), { title: "Always float meet.google.com?", body: "New meet.google.com app windows will open floating." });
});

test("a host with a port is a site, not a scheme, so the question's Edit rule adds it", () => {
  assert.equal(checkSite("example.com:8443").site, "https://example.com:8443");
  assert.equal(siteName("https://example.com:8443"), "example.com:8443");
  assert.equal(checkSite(siteName("https://example.com:8443")).site, "https://example.com:8443");
  assert.equal(checkSite("localhost:8080/").site, "https://localhost:8080");
  assert.ok(checkSite("ftp://example.com").error, "a scheme that isn't the web's is still refused");
  assert.ok(checkSite("mailto:someone").error);
});
