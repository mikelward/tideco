import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeDoes, pageAfterSearch, pageTerms, searchedSidebar } from "./optionssearch.js";
import { pageIds, sidebarRows } from "./optionspages.js";
import { settingsSections, SETTINGS_SECTIONS } from "./launcher.js";

// The sidebar as on chromeOS, and as off it on Linux.
const CROS = sidebarRows(settingsSections({ tiling: true }));
const LINUX = sidebarRows(settingsSections({ tiling: false, linux: true }));
const labels = (rows) => rows.map((r) => r.heading ?? r.label);
const found = (query, rows = CROS) => labels(searchedSidebar(rows, query));

test("every page has words beyond its name", () => {
  for (const { id, name } of SETTINGS_SECTIONS) {
    const terms = pageTerms(id);
    assert.equal(terms[0], name);
    assert.ok(terms.length > 1 && terms[1], id);
  }
});

test("a query keeps the pages it finds by name, under their headings", () => {
  assert.deepEqual(found("clocks"), ["General", "Clocks"]);
  assert.deepEqual(found("IMPORT"), ["General", "Import and export"]);
  assert.deepEqual(found("unread"), ["General", "Notifications", "Extras"]);
  // Headings with no page found under them go.
  assert.deepEqual(found("mouse"), ["Hardware", "Mouse"]);
});

test("a query finds pages by the words a person would search for", () => {
  assert.deepEqual(found("time zone"), ["General", "Clocks"]);
  assert.deepEqual(found("world clock"), ["General", "Clocks"]);
  assert.deepEqual(found("shortcuts"), ["Hardware", "Keyboard"]);
  assert.deepEqual(found("keys"), ["Hardware", "Keyboard", "Windows", "Apps"]);
  assert.deepEqual(found("inactive windows"), ["General", "Appearance"]);
  assert.deepEqual(found("ultrawide"), ["Windows", "Layouts"]);
  assert.deepEqual(found("backup"), ["General", "Import and export"]);
});

test("an empty query keeps every page", () => {
  assert.deepEqual(searchedSidebar(CROS, ""), CROS);
  assert.deepEqual(searchedSidebar(CROS, "  "), CROS);
});

test("a query that finds nothing keeps nothing", () => {
  assert.deepEqual(searchedSidebar(CROS, "zzz"), []);
});

test("a page the platform hides is never found", () => {
  assert.deepEqual(found("inactive", LINUX), []);
  assert.deepEqual(found("tide-tabs", LINUX), ["General", "Tabs in tide's switcher"]);
  assert.deepEqual(found("tide-tabs"), []);
});

test("the page showing stays if kept, else the first kept shows", () => {
  assert.equal(pageAfterSearch("clocks-section", searchedSidebar(CROS, "clock")), "clocks-section");
  assert.equal(pageAfterSearch("mouse", searchedSidebar(CROS, "unread")), "unread");
  assert.equal(pageAfterSearch("mouse", searchedSidebar(CROS, "zzz")), "mouse", "with none kept");
  assert.equal(pageIds(searchedSidebar(CROS, "")).length, pageIds(CROS).length);
});

test("Escape clears a query, then closes", () => {
  assert.equal(escapeDoes("clocks"), "clear");
  assert.equal(escapeDoes(""), "close");
});
