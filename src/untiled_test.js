// Tests for untiled.js, launcher.js and extras.js off chromeOS (SPEC.md
// §14.6): the dashboard and launcher work, placing nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_KEY, Untiled } from "./untiled.js";
import { items } from "./launcher.js";
import { EXTRAS, extrasFor } from "./extras.js";

function fake() {
  const calls = [];
  const session = {};
  let next = 100;
  const api = {
    calls,
    session,
    storage: {
      session: {
        get: async (k) => (k in session ? { [k]: session[k] } : {}),
        set: async (o) => Object.assign(session, o),
        remove: async (k) => delete session[k],
      },
      sync: { get: async () => ({}) },
      local: { get: async () => ({}) },
    },
    runtime: { getURL: (p) => `chrome-extension://tileco/${p}` },
    system: { display: { getInfo: async () => [{ id: "a", bounds: { left: 0, top: 0, width: 1920, height: 1080 }, workArea: { left: 0, top: 0, width: 1920, height: 1040 } }] } },
    windows: {
      getAll: async () => [{ id: 1, focused: true, left: 10, top: 10, width: 800, height: 600 }],
      create: async (props) => {
        calls.push(["create", props]);
        return { id: next++ };
      },
      update: async (id, props) => calls.push(["update", id, props]),
      remove: async (id) => calls.push(["remove", id]),
    },
    tabs: { update: async (id, props) => calls.push(["tab", id, props]) },
    power: { requestKeepAwake: () => calls.push(["awake"]), releaseKeepAwake: () => calls.push(["asleep"]) },
    action: { setTitle: async () => {} },
  };
  return api;
}

test("the dashboard opens full screen on your display, and its key closes it", async () => {
  const api = fake();
  const u = new Untiled(api);
  await u.command("popup");
  assert.deepEqual(api.calls, [
    ["create", { url: "chrome-extension://tileco/src/launcher.html?mode=dashboard", type: "popup", focused: true, left: 0, top: 0, width: 1920, height: 1080 }],
    ["update", 100, { state: "fullscreen" }],
  ]);
  assert.equal(api.session[DASHBOARD_KEY], 100);
  await u.command("popup");
  assert.deepEqual(api.calls.at(-1), ["remove", 100]);
  assert.equal(DASHBOARD_KEY in api.session, false);
});

test("a dashboard you closed yourself opens again", async () => {
  const api = fake();
  api.session[DASHBOARD_KEY] = 5;
  api.windows.remove = async () => {
    throw new Error("No window with id: 5.");
  };
  await new Untiled(api).command("popup");
  assert.ok(api.calls.some(([c]) => c === "create"));
});

test("the app keys open their app and place nothing; tiling keys do nothing", async () => {
  const api = fake();
  const u = new Untiled(api);
  for (const c of ["focus-next", "workspace-2", "send-3", "monocle", "float", "grow", "attention"]) await u.command(c);
  assert.deepEqual(api.calls, []);
  await u.command("app-browser");
  await u.command("app-calendar");
  assert.deepEqual(api.calls.map(([c, p]) => [c, Object.keys(p).sort()]), [
    ["create", ["focused"]],
    ["create", ["focused", "type", "url"]],
  ]);
  await u.command("keep-awake");
  assert.deepEqual(api.calls.at(-1), ["awake"]);
});

test("a tab from the launcher comes up with its window", async () => {
  const api = fake();
  await new Untiled(api).activateTab(12, 3);
  assert.deepEqual(api.calls, [
    ["tab", 12, { active: true }],
    ["update", 3, { focused: true }],
  ]);
});

test("off chromeOS the launcher lists only the commands that place nothing", () => {
  const commands = {
    popup: { description: "Open the dashboard (Search+Space)" },
    "focus-next": { description: "Focus the next window in the stack (Search+J)" },
    "keep-awake": { description: "Toggle keep awake (Search+S)" },
    "workspace-1": { description: "Go to workspace 1 (Search+1)" },
  };
  const tabs = [{ id: 1, windowId: 2, title: "Docs", url: "https://docs.example.com/" }];
  const names = (list) => list.filter((i) => i.kind === "command").map((i) => i.command);
  assert.deepEqual(names(items({ commands, tabs })), ["popup", "focus-next", "keep-awake", "workspace-1"]);
  const untiled = items({ commands, tabs, tiling: false });
  assert.deepEqual(names(untiled), ["popup", "keep-awake"]);
  assert.equal(untiled.find((i) => i.kind === "tab").detail, "tab", "no workspace to name");
});

test("off chromeOS only tab search is an extra", () => {
  assert.deepEqual(extrasFor(true).map((e) => e.id), EXTRAS.map((e) => e.id));
  const off = extrasFor(false);
  assert.deepEqual(off.map((e) => e.id), ["tabs"]);
  assert.doesNotMatch(off[0].how, /Secure Shell|workspaces|Search\+/);
});
