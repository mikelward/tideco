import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { movedPage, pageIds, pageToShow, sidebarRows } from "./optionspages.js";
import { settingsSections, SETTINGS_GROUPS, SETTINGS_SECTIONS } from "./launcher.js";

const html = readFileSync(new URL("options.html", import.meta.url), "utf8");
const labels = (rows) => rows.map((r) => r.heading ?? r.label);

// The sidebar (§13), as tide for Linux's settings panel's: its groups and,
// where the page is the same, its names, in its order.
test("on chromeOS the sidebar lists every page under tide's group headings", () => {
  assert.deepEqual(labels(sidebarRows(settingsSections({ tiling: true }))), [
    "Hardware", "Mouse", "Keyboard",
    "Windows", "Layouts", "Workspaces", "Apps",
    "General", "Appearance", "Notifications", "Clocks", "Start at login", "Extras", "Setup checklist", "Import and export",
  ]);
});

test("off chromeOS the sidebar leaves out the pages the platform hides", () => {
  assert.deepEqual(labels(sidebarRows(settingsSections({ tiling: false, linux: true }))), [
    "Hardware", "Keyboard", "Windows", "Apps", "General", "Clocks", "Extras", "Tabs in tide's switcher", "Import and export",
  ]);
  // A group with no page shown has no heading.
  const general = settingsSections({ tiling: false }).filter((s) => s.group === "general");
  assert.deepEqual(labels(sidebarRows(general)), ["General", "Clocks", "Extras", "Import and export"]);
});

test("every page is in a group, with an icon, and on the options page under its name", () => {
  const groups = SETTINGS_GROUPS.map((g) => g.id);
  for (const s of SETTINGS_SECTIONS) {
    assert.ok(groups.includes(s.group), `${s.id} is in no group`);
    assert.ok(s.icon, `${s.id} has no icon`);
    const m = new RegExp(`<section class="page" id="${s.id}"[^>]*>\\s*<h2>([^<]+)</h2>`).exec(html);
    assert.ok(m, `no page ${s.id} on the options page`);
    assert.equal(m[1], s.name, `${s.id}'s title`);
  }
  assert.equal([...html.matchAll(/<section /g)].length, SETTINGS_SECTIONS.length, "a page the sidebar doesn't list");
});

test("a page asked for shows, else the first", () => {
  const ids = pageIds(sidebarRows(settingsSections({ tiling: true })));
  assert.equal(pageToShow("extras", ids), "extras");
  assert.equal(pageToShow("linux", ids), "mouse", "hidden here");
  assert.equal(pageToShow(null, ids), "mouse");
  assert.equal(pageToShow("extras", []), null);
});

test("Up and Down move a page, passing over the headings and stopping at either end", () => {
  const ids = pageIds(sidebarRows(settingsSections({ tiling: true })));
  assert.equal(movedPage("keys-section", 1, ids), "layouts", "over Windows' heading");
  assert.equal(movedPage("layouts", -1, ids), "keys-section");
  assert.equal(movedPage("mouse", -1, ids), "mouse");
  assert.equal(movedPage("import-section", 1, ids), "import-section");
  assert.equal(movedPage("linux", 1, ids), "mouse", "from one not listed, the first");
  assert.equal(movedPage("mouse", 1, []), "mouse");
});
