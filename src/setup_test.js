import { test } from "node:test";
import assert from "node:assert/strict";
import { ITEMS, progress, SETUP_KEY, tick } from "./setup.js";

test("every item has an id of its own, a title, what to do, and its spec section", () => {
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  for (const i of ITEMS) {
    assert.ok(i.title && i.how && i.ref, i.id);
    assert.ok(i.where === "" || i.where.startsWith("chrome://"), `${i.id}: ${i.where}`);
  }
});

// Only settings that suit anyone; a personal setup (a keyboard layout, the
// shelf's apps, a mouse) isn't tide's to suggest.
test("the list holds no personal settings", () => {
  for (const id of ["shelf", "layout", "capslock", "mouse"]) assert.equal(ITEMS.find((i) => i.id === id), undefined, id);
});

test("focus follows cursor is on the list, at its flag", () => {
  assert.equal(ITEMS.find((i) => i.id === "focus")?.where, "chrome://flags/#focus-follows-cursor");
});

test("progress counts what's ticked, ignoring items that are gone", () => {
  assert.deepEqual(progress(undefined), { done: [], left: ITEMS.length });
  assert.deepEqual(progress(["dark", "gone", "desks"]), { done: ["desks", "dark"], left: ITEMS.length - 2 });
});

test("ticks made together are all kept", async () => {
  const stored = {};
  const area = {
    get: async (key) => ({ [key]: stored[key] }),
    set: async (items) => {
      await new Promise((r) => setImmediate(r));
      Object.assign(stored, items);
    },
  };
  await Promise.all([tick(area, "desks", true), tick(area, "idle", true), tick(area, "dark", true)]);
  assert.deepEqual(progress(stored[SETUP_KEY]).done, ["desks", "idle", "dark"]);
  await tick(area, "idle", false);
  assert.deepEqual(stored[SETUP_KEY], ["desks", "dark"]);
});
