import { test } from "node:test";
import assert from "node:assert/strict";
import { appLabel, appOf, homeAppOf, withHomeApp } from "./apps.js";

test("a window belongs to the app whose origin its tab is on", () => {
  assert.equal(appOf({ tabs: [{ url: "https://meet.google.com/abc-defg-hij" }] }).command, "app-meet");
  assert.equal(appOf({ tabs: [{ url: "https://google.com/" }] }), null);
  assert.equal(appOf({ tabs: [{ url: "chrome://newtab/" }] }), null);
  assert.equal(appOf({ tabs: [] }), null);
  assert.equal(appOf({}), null);
});

test("a window is one of home's apps by its active tab's site, as app keys match", () => {
  const win = (...urls) => ({ tabs: urls.map((url, i) => ({ url, active: i === urls.length - 1 })) });
  assert.equal(homeAppOf(win("https://calendar.google.com/calendar/r/week")).command, "app-calendar");
  assert.equal(homeAppOf(win("https://music.youtube.com/watch?v=x")).command, "app-music");
  // Meet is an app, but not one of home's by default.
  assert.equal(appOf(win("https://meet.google.com/abc")).command, "app-meet");
  assert.equal(homeAppOf(win("https://meet.google.com/abc")), null);
  // The active tab decides, not the first.
  assert.equal(homeAppOf(win("https://chat.google.com/", "https://example.com/")), null);
  assert.equal(homeAppOf(win("https://example.com/", "https://chat.google.com/")).command, "app-chat");
  // A tab still loading has only where it's going.
  assert.equal(homeAppOf({ tabs: [{ url: "", pendingUrl: "https://chat.google.com/", active: true }] }).command, "app-chat");
  // The settings' apps and home's list decide which.
  const apps = [{ command: "app-meet", name: "Gmail", url: "https://mail.google.com/" }];
  assert.equal(homeAppOf(win("https://mail.google.com/mail/u/0/"), apps, ["app-meet"]).name, "Gmail");
  assert.equal(homeAppOf(win("https://mail.google.com/"), apps, ["app-chat"]), null);
  assert.equal(homeAppOf(win("https://calendar.google.com/"), apps), null, "an app not in the settings is none");
});

test("an app key is called by its app's name, or its number while it has none", () => {
  assert.equal(appLabel("app-music"), "YouTube Music");
  const apps = [{ command: "app-meet", name: "Gmail", url: "https://mail.google.com/" }];
  assert.equal(appLabel("app-meet", apps), "Gmail");
  assert.equal(appLabel("app-calendar", apps), "App 1, off");
  assert.equal(appLabel("app-music", apps), "App 4, off");
});

test("ticking one of home's apps adds it last, and unticking keeps the rest's order", () => {
  assert.deepEqual(withHomeApp(["app-music", "app-calendar"], "app-meet", true), ["app-music", "app-calendar", "app-meet"]);
  assert.deepEqual(withHomeApp(["app-music", "app-calendar"], "app-music", false), ["app-calendar"]);
  assert.deepEqual(withHomeApp(["app-chat"], "app-chat", true), ["app-chat"], "never twice");
  assert.deepEqual(withHomeApp([], "app-chat", false), []);
});
