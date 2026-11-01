// Tests for platform.js: which platforms tile, and what the others say.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionTitle, INERT, roleOf, TILE, worksUntiled } from "./platform.js";

test("only chromeOS tiles", () => {
  assert.equal(roleOf("cros"), TILE);
  for (const os of ["linux", "mac", "win", "openbsd", "fuchsia", undefined]) assert.equal(roleOf(os), INERT, os);
  assert.equal(actionTitle({ os: "cros", role: TILE }), "tide");
  assert.equal(actionTitle({ os: "linux", role: INERT }), "tide · tiling and workspaces work only on chromeOS, not Linux");
  assert.equal(actionTitle({ os: "mac", role: INERT }), "tide · tiling and workspaces work only on chromeOS, not macOS");
  // Only the commands that place no window work off chromeOS.
  for (const c of ["popup", "keep-awake", "app-browser", "app-chat"]) assert.ok(worksUntiled(c), c);
  for (const c of ["focus-next", "workspace-1", "send-2", "monocle", "float", "attention", "layout-next"]) assert.ok(!worksUntiled(c), c);
});
