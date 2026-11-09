// Tests for pictures.js against a fake chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPTURE_GAP, FRESH, Pictures, pictureKey, picturesIn } from "./pictures.js";
import { FakeChrome, HD } from "./fake_chrome.js";

const SITE = "https://example.com/";

// Pictures with a clock and timer the test drives: `fire` runs what's due
// once the clock has moved on by `ms`.
function setup(windows = [{ id: 1, url: SITE }, { id: 2, url: SITE }, { id: 3, url: SITE }]) {
  const chrome = new FakeChrome({ displays: [HD], windows });
  chrome.granted = true;
  let t = 1_000_000;
  const pending = [];
  const pictures = new Pictures(chrome, {
    now: () => t,
    later: (f, ms) => pending.push({ f, at: t + ms }),
    shrink: async (raw) => `small ${raw}`,
  });
  const fire = async (ms = 0) => {
    t += ms;
    for (const p of pending.splice(0)) {
      if (p.at <= t) await p.f();
      else pending.push(p);
    }
  };
  return { chrome, pictures, pending, fire, tick: (ms) => (t += ms) };
}

test("a picture is kept shrunk in storage.session, by window", async () => {
  const { chrome, pictures } = setup();
  assert.equal(await pictures.take(1), "taken");
  assert.deepEqual(chrome.sessionStore[pictureKey(1)], { url: "small data:1,1", at: 1_000_000 });
  assert.deepEqual(picturesIn(chrome.sessionStore), { 1: { url: "small data:1,1", at: 1_000_000 } });
});

test("captures keep to Chrome's two a second", async () => {
  const { chrome, pictures, tick } = setup();
  assert.equal(await pictures.take(1), "taken");
  assert.equal(await pictures.take(2), "busy", "too soon after the last");
  tick(CAPTURE_GAP);
  assert.equal(await pictures.take(2), "taken");
  assert.deepEqual(chrome.captures, [1, 2]);
});

test("without all-sites access, or on a page Chrome keeps, there's no picture", async () => {
  const { chrome, pictures, tick } = setup([{ id: 1, url: SITE }, { id: 2 }]);
  chrome.granted = false;
  assert.equal(await pictures.take(1), "failed");
  chrome.granted = true;
  tick(CAPTURE_GAP);
  assert.equal(await pictures.take(2), "failed", "a new tab page is chrome://");
  assert.deepEqual(picturesIn(chrome.sessionStore), {});
});

test("shown windows are taken in turn, spaced out, and only while they show", async () => {
  const { chrome, pictures, fire } = setup();
  const shown = new Set([1, 2, 3]);
  pictures.refresh([1, 2, 3], (id) => shown.has(id));
  await fire();
  assert.deepEqual(chrome.captures, [1]);
  await fire(CAPTURE_GAP - 1);
  assert.deepEqual(chrome.captures, [1], "not before the gap");
  shown.delete(2);
  await fire(1);
  await fire(CAPTURE_GAP);
  assert.deepEqual(chrome.captures, [1, 3], "2 went before its turn");
});

test("a fresh picture isn't taken again until it's old", async () => {
  const { chrome, pictures, fire } = setup();
  pictures.refresh([1], () => true);
  await fire();
  pictures.refresh([1], () => true);
  await fire(CAPTURE_GAP);
  assert.deepEqual(chrome.captures, [1]);
  await fire(FRESH);
  pictures.refresh([1], () => true);
  await fire(CAPTURE_GAP);
  assert.deepEqual(chrome.captures, [1, 1]);
});

test("a window's turn taken by another capture waits for the next", async () => {
  const { chrome, pictures, fire, tick } = setup();
  pictures.refresh([1], () => true);
  // tide takes 2 before a switch, just before 1's turn.
  tick(CAPTURE_GAP);
  await pictures.take(2);
  await fire();
  assert.deepEqual(chrome.captures, [2]);
  await fire(CAPTURE_GAP);
  assert.deepEqual(chrome.captures, [2, 1]);
});

test("a closed window's picture goes", async () => {
  const { chrome, pictures, tick } = setup();
  await pictures.take(1);
  tick(CAPTURE_GAP);
  await pictures.take(2);
  await pictures.forget(new Set([2]));
  assert.deepEqual(Object.keys(picturesIn(chrome.sessionStore)), ["2"]);
});

test("a closed window's picture goes, even one an earlier worker took", async () => {
  const { chrome, pictures } = setup();
  // An earlier worker, which Chrome stopped, kept these.
  chrome.sessionStore[pictureKey(1)] = { url: "data:image/jpeg;base64,", at: 0 };
  chrome.sessionStore[pictureKey(2)] = { url: "data:image/jpeg;base64,", at: 0 };
  chrome.sessionStore.other = 1;
  await pictures.forget(new Set([2]));
  assert.deepEqual(Object.keys(picturesIn(chrome.sessionStore)), ["2"]);
  assert.equal(chrome.sessionStore.other, 1);
});
