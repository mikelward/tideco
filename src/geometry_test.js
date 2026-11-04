// Tests for geometry.js. The fixtures and expected boxes are tide's
// hypr/tide/layout_test.lua, so the two desktops tile alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as geometry from "./geometry.js";

// The boxes cover `area` exactly: all inside it, no two overlapping, and
// their areas summing to its area.
function covers(area, boxes, what) {
  let sum = 0;
  boxes.forEach((b, i) => {
    assert.ok(b.w > 0 && b.h > 0, `${what}: box ${i} is empty`);
    assert.ok(
      b.x >= area.x && b.y >= area.y && b.x + b.w <= area.x + area.w && b.y + b.h <= area.y + area.h,
      `${what}: box ${i} leaves the area`,
    );
    for (const [j, c] of boxes.entries()) {
      if (j <= i) continue;
      const overlap = b.x < c.x + c.w && c.x < b.x + b.w && b.y < c.y + c.h && c.y < b.y + b.h;
      assert.ok(!overlap, `${what}: boxes ${i} and ${j} overlap`);
    }
    sum += b.w * b.h;
  });
  assert.equal(sum, area.w * area.h, `${what}: boxes cover ${sum} px, area is ${area.w * area.h}`);
}

// Work areas below a 34 px bar.
const UW = { x: 0, y: 34, w: 3440, h: 1406 }; // 3440x1440, aspect ~2.45
const HD = { x: 0, y: 34, w: 1920, h: 1046 }; // 1920x1080, aspect ~1.84
const SUW = { x: 0, y: 34, w: 5120, h: 1406 }; // 5120x1440, aspect ~3.64
const RULES = [
  { minAspect: 2.1, width: 0.8 },
  { minAspect: 3.2, width: 0.6 },
];

test("tile puts the master left at mfact and stacks the rest", () => {
  const b = geometry.tile(UW, 4, { mfact: 0.55, nmaster: 1 });
  assert.deepEqual(b[0], { x: 0, y: 34, w: 1892, h: 1406 });
  assert.deepEqual(b[1], { x: 1892, y: 34, w: 1548, h: 469 });
  assert.deepEqual(b[2], { x: 1892, y: 503, w: 1548, h: 468 });
  assert.deepEqual(b[3], { x: 1892, y: 971, w: 1548, h: 469 });
  covers(UW, b, "tile");
});

test("tile with nmaster 0 or nmaster >= n is plain rows", () => {
  covers(HD, geometry.tile(HD, 3, { mfact: 0.55, nmaster: 0 }), "nmaster 0");
  const b = geometry.tile(HD, 2, { mfact: 0.55, nmaster: 2 });
  assert.equal(b[0].w, 1920);
  covers(HD, b, "nmaster 2");
});

test("threecol centers the master with 25% sides", () => {
  const b = geometry.threecol(UW, 3, { mfact: 0.5, nmaster: 1 });
  assert.deepEqual(b[0], { x: 860, y: 34, w: 1720, h: 1406 });
  assert.deepEqual(b[1], { x: 2580, y: 34, w: 860, h: 1406 }, "first stack window goes right");
  assert.deepEqual(b[2], { x: 0, y: 34, w: 860, h: 1406 }, "second goes left");
});

test("threecol with two windows is master + one column, 50/50", () => {
  const b = geometry.threecol(UW, 2, { mfact: 0.5, nmaster: 1 });
  assert.deepEqual(b[0], { x: 0, y: 34, w: 1720, h: 1406 });
  assert.deepEqual(b[1], { x: 1720, y: 34, w: 1720, h: 1406 });
});

test("threecol alternates stack windows right, left, right", () => {
  const b = geometry.threecol(UW, 5, { mfact: 0.5, nmaster: 1 });
  assert.equal(b[1].x, 2580);
  assert.equal(b[2].x, 0);
  assert.equal(b[3].x, 2580);
  assert.equal(b[4].x, 0);
  assert.ok(b[1].y < b[3].y, "right column in order");
  assert.ok(b[2].y < b[4].y, "left column in order");
  covers(UW, b, "threecol 5");
});

test("adding a window to threecol never moves one to the other side", () => {
  for (let n = 3; n <= 7; n++) {
    const a = geometry.threecol(UW, n, { mfact: 0.5, nmaster: 1 });
    const c = geometry.threecol(UW, n + 1, { mfact: 0.5, nmaster: 1 });
    for (let i = 0; i < n; i++) assert.equal(c[i].x, a[i].x, `window ${i} of ${n} keeps its column`);
  }
});

test("twocol puts two masters side by side and stacks the rest", () => {
  const b = geometry.twocol(UW, 5, { mfact: 0.72, nmaster: 2 });
  assert.equal(b[0].h, 1406);
  assert.equal(b[1].h, 1406);
  assert.ok(b[0].x < b[1].x, "masters side by side");
  assert.equal(b[2].x, b[3].x, "stack shares a column");
  assert.equal(b[2].x, b[1].x + b[1].w, "stack right of the masters");
  covers(UW, b, "twocol 5");
});

test("twocol with no stack shares the width equally", () => {
  const b = geometry.twocol(HD, 2, { mfact: 0.72, nmaster: 2 });
  assert.deepEqual(b[0], { x: 0, y: 34, w: 960, h: 1046 });
  assert.deepEqual(b[1], { x: 960, y: 34, w: 960, h: 1046 });
});

test("monocle gives every window the whole area", () => {
  for (const b of geometry.monocle(UW, 3)) assert.deepEqual(b, UW);
});

test("a lone window is 80% on an ultrawide, 60% on 32:9, 100% on 16:9", () => {
  assert.deepEqual(geometry.single(UW, RULES)[0], { x: 344, y: 34, w: 2752, h: 1406 });
  assert.deepEqual(geometry.single(SUW, RULES)[0], { x: 1024, y: 34, w: 3072, h: 1406 });
  assert.deepEqual(geometry.single(HD, RULES)[0], HD);
});

test("the single-window rule applies in every mode", () => {
  for (const mode of geometry.modes) {
    assert.deepEqual(
      geometry.arrange(mode, UW, 1, { mfact: 0.5, nmaster: 1 }, RULES)[0],
      { x: 344, y: 34, w: 2752, h: 1406 },
      mode,
    );
  }
});

test("every mode covers the area for 2 to 9 windows on odd sizes", () => {
  const odd = { x: 7, y: 33, w: 2561, h: 1397 };
  const opts = {
    tile: { mfact: 0.55, nmaster: 1 },
    threecol: { mfact: 0.5, nmaster: 1 },
    twocol: { mfact: 0.72, nmaster: 2 },
  };
  for (const [mode, o] of Object.entries(opts)) {
    for (let n = 2; n <= 9; n++) covers(odd, geometry.arrange(mode, odd, n, o, RULES), `${mode} n=${n}`);
  }
});

test("an unknown mode is an error", () => {
  assert.throws(() => geometry.arrange("spiral", UW, 2, {}, RULES));
});

const AREA = { x: 0, y: 0, w: 1000, h: 800 };

test("a dragged edge between master and stack sets the main share", () => {
  const o = { mfact: 0.55, nmaster: 1 };
  // Tile: the master's right edge, or the stack's left, is the border.
  assert.equal(geometry.mfactFor("tile", AREA, 3, o, [], 0, "right", 700), 0.7);
  assert.equal(geometry.mfactFor("tile", AREA, 3, o, [], 2, "left", 300), 0.3);
  // Three columns: the master is centered, so either of its edges sets
  // the width, and so do the stacks' inner edges.
  assert.equal(geometry.mfactFor("threecol", AREA, 3, o, [], 0, "left", 200), 0.6);
  assert.equal(geometry.mfactFor("threecol", AREA, 3, o, [], 0, "right", 900), 0.8);
  assert.equal(geometry.mfactFor("threecol", AREA, 3, o, [], 2, "right", 100), 0.8);
  // Two columns: the masters share the main width.
  assert.equal(geometry.mfactFor("twocol", AREA, 3, { mfact: 0.72, nmaster: 2 }, [], 0, "right", 400), 0.8);
});

test("a dragged edge the share doesn't move sets nothing", () => {
  const o = { mfact: 0.55, nmaster: 1 };
  assert.equal(geometry.mfactFor("tile", AREA, 2, o, [], 0, "left", 100), null, "the screen's edge");
  assert.equal(geometry.mfactFor("tile", AREA, 1, o, [], 0, "right", 700), null, "a lone window");
  assert.equal(geometry.mfactFor("monocle", AREA, 2, o, [], 0, "right", 700), null);
  assert.equal(geometry.mfactFor("tile", AREA, 2, { mfact: 0.55, nmaster: 0 }, [], 0, "right", 700), null, "no master");
});

test("a lone window's dragged edge sets its width, centered", () => {
  const was = { x: 100, w: 800 };
  // The center is at 500; the edge that moved sets the half-width.
  assert.equal(geometry.singleWidthFor(AREA, was, { x: 100, w: 700 }), 0.6, "the right edge");
  assert.equal(geometry.singleWidthFor(AREA, was, { x: 300, w: 600 }), 0.4, "the left edge");
  assert.equal(geometry.singleWidthFor(AREA, was, { x: 100, w: 2000 }), 1.0, "no wider than the area");
  assert.equal(geometry.singleWidthFor(AREA, was, { x: 490, w: 410 }), 0.1, "nor narrower than 10%");
  assert.equal(geometry.singleWidthFor(AREA, was, { x: 100, w: 800 }), null, "no edge moved");
});

test("a share dragged past its bounds stops at them", () => {
  const o = { mfact: 0.55, nmaster: 1 };
  assert.equal(geometry.mfactFor("tile", AREA, 2, o, [], 0, "right", 990), 0.95);
  assert.equal(geometry.mfactFor("tile", AREA, 2, o, [], 1, "left", 5), 0.05);
});
