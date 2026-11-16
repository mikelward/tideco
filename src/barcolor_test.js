// Tests for barcolor.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BAR_CONTRAST, checkBarColor, contrast, DEFAULT_BAR, hexColor, TEXT } from "./barcolor.js";

test("a color is #rrggbb or #rgb, kept as #rrggbb in lower case", () => {
  assert.equal(hexColor("#DFE3EE"), "#dfe3ee");
  assert.equal(hexColor("#1aF"), "#11aaff");
  for (const bad of ["", "blue", "#12345", 5, null]) assert.equal(hexColor(bad), "");
});

test("a bar color must be one the mode's text reads on", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(checkBarColor(false)("#DFE3EE"), "#dfe3ee");
  assert.equal(checkBarColor(true)("#13303a"), "#13303a");
  assert.equal(checkBarColor(true)(null), null, "null is the page's own");
  assert.throws(() => checkBarColor(true)("#ffffff"), /is too light for the bar's text/);
  assert.throws(() => checkBarColor(false)("#000"), /is too dark for the bar's text/);
  assert.throws(() => checkBarColor(false)("blue"), /must be a color/);
});

test("the page's own bar colors pass their own check", () => {
  for (const mode of ["light", "dark"]) assert.ok(contrast(DEFAULT_BAR[mode], TEXT[mode]) >= BAR_CONTRAST, mode);
});
