// Tests for barlayout.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ITEMS, layoutList, stored, byZone, moved, switched, checkBarLayout, placement } from "./barlayout.js";

const ids = (list) => list.map((e) => `${e.id}:${e.zone}${e.shown ? "" : ":off"}`);

test("with nothing stored, the bar is today's: logo and workspaces left, the name centered, keep awake and clocks right", () => {
  assert.deepEqual(ids(layoutList(undefined)), ["logo:left", "workspaces:left", "title:center", "icons:right"]);
  assert.deepEqual(layoutList(null).map((e) => e.label), ITEMS.map((e) => e.label));
});

test("a stored layout keeps its order and zones, and makes itself whole", () => {
  const list = layoutList([
    { id: "workspaces", zone: "center", shown: true },
    { id: "title", zone: "center", shown: false },
    { id: "bogus", zone: "left", shown: true },
    { id: "workspaces", zone: "right", shown: true },
    { id: "icons", zone: "middle", shown: true },
  ]);
  assert.deepEqual(ids(list), ["logo:left", "workspaces:center", "title:center:off", "icons:right"]);
});

test("the arrows move an item through every place, past its zone's end into the next", () => {
  let list = layoutList(undefined);
  list = layoutList(moved(list, 1, 1));
  assert.deepEqual(ids(byZone(list)), ["logo:left", "workspaces:center", "title:center", "icons:right"]);
  list = layoutList(moved(list, 1, 1));
  assert.deepEqual(ids(byZone(list)), ["logo:left", "title:center", "workspaces:center", "icons:right"]);
  list = layoutList(moved(list, 2, 1));
  assert.deepEqual(ids(byZone(list)), ["logo:left", "title:center", "workspaces:right", "icons:right"]);
  list = layoutList(moved(list, 3, -1));
  assert.deepEqual(ids(byZone(list)), ["logo:left", "title:center", "icons:right", "workspaces:right"]);
  assert.equal(moved(list, 0, -1), null);
  assert.equal(moved(list, 3, 1), null);
  assert.equal(moved(list, 9, 1), null);
});

test("an item moves into an empty zone, and shows or hides", () => {
  let list = layoutList([
    { id: "logo", zone: "left", shown: true },
    { id: "workspaces", zone: "left", shown: true },
    { id: "title", zone: "right", shown: true },
    { id: "icons", zone: "right", shown: true },
  ]);
  list = layoutList(moved(list, 1, 1));
  assert.deepEqual(ids(byZone(list)), ["logo:left", "workspaces:center", "title:right", "icons:right"]);
  list = layoutList(switched(list, 2, false));
  assert.deepEqual(ids(byZone(list)), ["logo:left", "workspaces:center", "title:right:off", "icons:right"]);
  assert.deepEqual(stored(list)[0], { id: "logo", zone: "left", shown: true });
});

test("barLayout is a list of {id, zone, shown}, and anything else fails", () => {
  const ok = [{ id: "workspaces", zone: "center", shown: true }, { id: "gone", zone: "left", shown: false }];
  assert.deepEqual(checkBarLayout(ok), ok, "an id the bar doesn't know is layoutList's to drop");
  for (const bad of ["center", [{ id: "title", shown: true }], [{ id: "title", zone: "middle", shown: true }], [{ id: "title", zone: "center", shown: "no" }], [{ id: "title", zone: "center", shown: true, at: 1 }], [null]]) {
    assert.throws(() => checkBarLayout(bad), /must be a list like/, JSON.stringify(bad));
  }
});

test("the bar's elements go in their item's zone, in order, keep awake and the clocks together", () => {
  assert.deepEqual(placement(undefined), [
    { id: "logo", zone: "left", hidden: false },
    { id: "workspaces", zone: "left", hidden: false },
    { id: "title", zone: "center", hidden: false },
    { id: "keep-awake", zone: "right", hidden: false },
    { id: "clocks", zone: "right", hidden: false },
  ]);
  const p = placement([
    { id: "icons", zone: "left", shown: true },
    { id: "workspaces", zone: "center", shown: true },
    { id: "title", zone: "center", shown: false },
  ]);
  assert.deepEqual(p.map((e) => `${e.id}:${e.zone}${e.hidden ? ":off" : ""}`), ["logo:left", "keep-awake:left", "clocks:left", "workspaces:center", "title:center:off"]);
});
