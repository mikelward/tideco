// Tests for recent.js: the worker's ring buffers for a bug report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capture, Recent } from "./recent.js";

// chrome.storage.session, which outlives the worker but not the browser.
function session() {
  const store = {};
  const writes = [];
  return {
    store,
    writes,
    get: async (key) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
    set: async (items) => {
      writes.push(structuredClone(items));
      Object.assign(store, structuredClone(items));
    },
  };
}

test("it keeps the newest entries, up to its limit", async () => {
  let now = 1000;
  const r = new Recent(null, "k", { limit: 3, now: () => now });
  for (const text of ["a", "b", "c", "d"]) {
    r.add(text);
    now += 1;
  }
  await r.ready();
  assert.deepEqual(r.since(0).map((e) => e.text), ["b", "c", "d"]);
});

test("it forgets entries older than it keeps", async () => {
  let now = 0;
  const r = new Recent(null, "k", { keep: 60_000, now: () => now });
  r.add("old");
  now = 30_000;
  r.add("newer");
  now = 70_000;
  r.add("newest");
  assert.deepEqual(r.since(0).map((e) => e.text), ["newer", "newest"]);
});

test("since gives only the entries from then on, each with its time and details", async () => {
  let now = 100;
  const r = new Recent(null, "k", { now: () => now });
  r.add("before", { cause: "key" });
  now = 200;
  r.add("after", { cause: "click" });
  assert.deepEqual(r.since(200), [{ t: 200, text: "after", cause: "click" }]);
});

test("a restarted worker keeps what the last one recorded, then adds to it", async () => {
  const storage = session();
  let now = 0;
  const first = new Recent(storage, "recentLog", { now: () => now });
  first.add("one");
  now = 1;
  await first.add("two");
  // The worker stops; a new one starts on the same session storage.
  now = 2;
  const second = new Recent(storage, "recentLog", { now: () => now });
  second.add("three");
  await second.ready();
  assert.deepEqual(second.since(0).map((e) => e.text), ["one", "two", "three"]);
  await second.flush();
  assert.deepEqual(storage.store.recentLog.map((e) => e.text), ["one", "two", "three"], "and stores them all");
});

test("entries added while a write is under way go in one more write", async () => {
  const storage = session();
  const r = new Recent(storage, "k", { now: () => 0 });
  await r.ready();
  for (let i = 0; i < 5; i++) r.add(String(i));
  await r.flush();
  assert.ok(storage.writes.length <= 2, `${storage.writes.length} writes`);
  assert.deepEqual(storage.store.k.map((e) => e.text), ["0", "1", "2", "3", "4"]);
});

test("a write that fails is reported, not thrown, and the next one tries again", async () => {
  const storage = session();
  const warned = [];
  let fail = true;
  const set = storage.set;
  storage.set = async (items) => {
    if (fail) throw new Error("quota");
    return set(items);
  };
  const r = new Recent(storage, "k", { now: () => 0, warn: (...a) => warned.push(a.join(" ")) });
  await r.add("a");
  assert.equal(warned.length, 1);
  assert.match(warned[0], /couldn't keep/);
  fail = false;
  await r.add("b");
  assert.deepEqual(storage.store.k.map((e) => e.text), ["a", "b"]);
});

test("capture copies each console line to the buffer, with its level, and still prints it", () => {
  const printed = [];
  const fake = { info: (...a) => printed.push(a), error: (...a) => printed.push(a) };
  const r = new Recent(null, "k", { now: () => 5 });
  capture(fake, r, ["info", "error"]);
  fake.info("tide: started", 3);
  fake.error("tide: couldn't:", new Error("gone"));
  assert.equal(printed.length, 2);
  assert.deepEqual(r.since(0), [
    { t: 5, text: "tide: started 3", level: "info" },
    { t: 5, text: "tide: couldn't: Error: gone", level: "error" },
  ]);
});

test("capture returns the console's own functions, which don't record", () => {
  const fake = { warn: () => {} };
  const r = new Recent(null, "k", { now: () => 0 });
  const original = capture(fake, r, ["warn"]);
  original.warn("not recorded");
  assert.deepEqual(r.since(0), []);
});
