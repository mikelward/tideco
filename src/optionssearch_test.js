import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchSections, sectionTerms } from "./optionssearch.js";
import { SETTINGS_SECTIONS } from "./launcher.js";

// The options page's sections, as its HTML has them, all shown, as on chromeOS
// but for Linux's own.
const html = readFileSync(new URL("options.html", import.meta.url), "utf8");
const PAGE = [...html.matchAll(/<section id="([^"]+)"([^>]*)>\s*<h2>([^<]+)<\/h2>/g)].map(([, id, attrs, heading]) => ({
  id,
  heading,
  shown: !/\bhidden\b/.test(attrs),
}));
const found = (query, sections = PAGE) => {
  const { unmatched } = searchSections(sections, query);
  return sections.filter((s) => s.shown && !unmatched.includes(s.id)).map((s) => s.heading);
};

test("every section on the page has terms beyond its heading", () => {
  assert.ok(PAGE.length > 10, "the page's sections are read");
  for (const { id, heading } of PAGE) assert.ok(sectionTerms(id, heading).length > 1, id);
  assert.deepEqual(PAGE.map((s) => s.id).sort(), SETTINGS_SECTIONS.map((s) => s.id).sort());
});

test("a query keeps the sections it finds by heading", () => {
  assert.deepEqual(found("clocks"), ["Clocks"]);
  assert.deepEqual(found("IMPORT"), ["Import and export"]);
  assert.deepEqual(found("chromebook"), ["Start at login on this Chromebook", "Layouts on this Chromebook", "Mouse on this Chromebook"]);
});

test("a query finds sections by the words a person would search for", () => {
  assert.deepEqual(found("time zone"), ["Clocks"]);
  assert.deepEqual(found("world clock"), ["Clocks"]);
  assert.deepEqual(found("shortcuts"), ["Keys"]);
  assert.deepEqual(found("bindings"), ["Keys"]);
  assert.deepEqual(found("inactive windows"), ["Dim"]);
  assert.deepEqual(found("ultrawide"), ["Layouts on this Chromebook"]);
  assert.deepEqual(found("backup"), ["Import and export"]);
});

test("an empty query keeps every section and says nothing", () => {
  assert.deepEqual(searchSections(PAGE, ""), { unmatched: [], none: false });
  assert.deepEqual(searchSections(PAGE, "  "), { unmatched: [], none: false });
});

test("a query that finds nothing says so", () => {
  const { unmatched, none } = searchSections(PAGE, "zzz");
  assert.equal(unmatched.length, PAGE.length);
  assert.equal(none, true);
});

test("a section the platform hides doesn't count as found", () => {
  // Off chromeOS, as the page leaves it: its chromeOS sections hidden.
  const off = PAGE.map((s) => ({ ...s, shown: !["dim", "mouse"].includes(s.id) }));
  assert.deepEqual(searchSections(off, "inactive"), { unmatched: PAGE.map((s) => s.id).filter((id) => id !== "dim"), none: true });
  assert.equal(searchSections(off, "clocks").none, false);
  assert.deepEqual(searchSections([], "clocks"), { unmatched: [], none: false });
});
