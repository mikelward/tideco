// Tests for heldswap.js: the held swap with the master's choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { commit, PAUSE, press } from "./heldswap.js";

// Focus on `win`, on workspace "in" on display "d", whose tiled windows are
// 1, 2 and 3 in layout order, 1 the master.
const at = (win, more = {}) => ({ win, ws: "in", display: "d", order: [1, 2, 3], ...more });

test("the pause is half a second", () => {
  assert.equal(PAUSE, 500);
});

test("the first press notes the window and moves nothing", () => {
  const { cycle, focus } = press(null, at(3));
  assert.equal(focus, null);
  assert.equal(cycle.stepped, false);
});

test("each further press moves focus on in layout order, round from the end", () => {
  let { cycle } = press(null, at(3));
  let r = press(cycle, at(3));
  assert.equal(r.focus, 1, "round to the master");
  r = press(r.cycle, at(1));
  assert.equal(r.focus, 2);
  assert.equal(r.cycle.stepped, true);
});

test("a press from a window outside the order goes to the master", () => {
  const { cycle } = press(null, at(9));
  assert.equal(press(cycle, at(9)).focus, 1);
});

test("a lone window has nowhere to step", () => {
  const one = { order: [1] };
  const { cycle } = press(null, at(1, one));
  const r = press(cycle, at(1, one));
  assert.equal(r.focus, null);
  assert.equal(r.cycle.stepped, false, "so the pause is still a tap");
});

test("a press on another workspace or display starts again", () => {
  const { cycle } = press(null, at(3));
  for (const other of [at(3, { ws: "re" }), at(3, { display: "e" })]) {
    const r = press(cycle, other);
    assert.equal(r.focus, null);
    assert.equal(r.cycle.ws, other.ws);
  }
});

test("a tap is the swap with the master, even on the master", () => {
  assert.equal(commit(press(null, at(3)).cycle, at(3)), "swap");
  assert.equal(commit(press(null, at(1)).cycle, at(1)), "swap");
});

test("after a step, the window focus stopped on becomes the master unless it is already", () => {
  let { cycle } = press(null, at(3));
  ({ cycle } = press(cycle, at(3)));
  assert.equal(commit(cycle, at(1)), "none", "stopped on the master");
  ({ cycle } = press(cycle, at(1)));
  assert.equal(commit(cycle, at(2)), "swap");
});

test("the pause moves nothing that wasn't chosen with the key", () => {
  const { cycle } = press(null, at(3));
  assert.equal(commit(null, at(3)), "none", "no cycle: a worker that forgot it");
  assert.equal(commit(cycle, null), "none");
  assert.equal(commit(cycle, at(null)), "none", "no window focused");
  assert.equal(commit(cycle, at(3, { ws: "re" })), "none", "another workspace");
  assert.equal(commit(cycle, at(3, { display: "e" })), "none", "another display");
  assert.equal(commit(cycle, at(9)), "none", "a window that doesn't tile");
  assert.equal(commit(cycle, at(2)), "none", "focus moved, but not by the key");
});

test("the pause after a step needs focus where the last press left it", () => {
  let { cycle } = press(null, at(3));
  ({ cycle } = press(cycle, at(3)));
  ({ cycle } = press(cycle, at(1)));
  assert.equal(cycle.at, 2);
  assert.equal(commit(cycle, at(3)), "none");
  assert.equal(commit(cycle, at(2)), "swap");
});
