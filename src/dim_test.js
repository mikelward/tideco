import { test } from "node:test";
import assert from "node:assert/strict";
import { overlay } from "./dim.js";

// Just enough of a page for overlay(): one element slot by ID.
function fakePage() {
  const els = new Map();
  globalThis.document = {
    getElementById: (id) => els.get(id) ?? null,
    createElement: () => {
      const el = { style: {}, remove: () => els.delete(el.id) };
      return el;
    },
    documentElement: { append: (el) => els.set(el.id, el) },
  };
  return els;
}

test("the overlay is 12% black, ignores the pointer, and sits on top", () => {
  const els = fakePage();
  overlay(true);
  const css = els.get("tico-dim").style.cssText;
  assert.match(css, /background:rgba\(0,0,0,0\.12\)/);
  assert.match(css, /pointer-events:none/);
  assert.match(css, /z-index:2147483647/);
});

test("the overlay goes on once and comes off", () => {
  const els = fakePage();
  overlay(true);
  const first = els.get("tico-dim");
  overlay(true);
  assert.equal(els.get("tico-dim"), first, "a second call adds nothing");
  overlay(false);
  assert.equal(els.size, 0);
  overlay(false);
});

test("a dimmed page takes a new strength without a second overlay", () => {
  const els = fakePage();
  overlay(true, 0.25);
  assert.match(els.get("tico-dim").style.cssText, /background:rgba\(0,0,0,0\.25\)/);
  overlay(true, 0.05);
  assert.equal(els.get("tico-dim").style.background, "rgba(0,0,0,0.05)");
  assert.equal(els.size, 1);
});

test("the overlay keeps its pre-rename ID, so an update can lift a dim already on a page", () => {
  const els = fakePage();
  const old = { id: "tico-dim", style: {}, remove: () => els.delete("tico-dim") };
  els.set("tico-dim", old);
  overlay(false);
  assert.equal(els.has("tico-dim"), false);
});
