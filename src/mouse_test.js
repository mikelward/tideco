import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeChrome, HD } from "./fake_chrome.js";
import { croshLines, MOUSE_PAGE, remind } from "./mouse.js";
import { SETTINGS_KEY } from "./settings.js";

test("the crosh lines turn off high-resolution scrolling and set a flat curve", () => {
  assert.deepEqual(croshLines(12, 200), [
    'gesture_prop set 12 "Mouse High Resolution Scrolling" array:boolean:false',
    'gesture_prop set 12 "Mouse Scroll Accel Curve" array:double:200,0,0,0,0',
  ]);
});

test("login opens the mouse page only on a Chromebook with a wheel step", async () => {
  const chrome = new FakeChrome({ displays: [HD] });
  assert.equal(await remind(chrome), false);
  assert.deepEqual(chrome.createdTabs, []);
  chrome.store[SETTINGS_KEY] = { wheelStep: 200 };
  assert.equal(await remind(chrome), true);
  assert.deepEqual(chrome.createdTabs, [{ url: `chrome-extension://tide/${MOUSE_PAGE}` }]);
});

test("a bad wheel step opens nothing and says why", async (t) => {
  const chrome = new FakeChrome({ displays: [HD] });
  chrome.store[SETTINGS_KEY] = { wheelStep: -1 };
  const logged = t.mock.method(console, "error", () => {});
  assert.equal(await remind(chrome), false);
  assert.deepEqual(chrome.createdTabs, []);
  assert.match(logged.mock.calls[0].arguments[0], /no mouse reminder: wheelStep/);
});
