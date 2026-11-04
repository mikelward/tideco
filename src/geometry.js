// Window geometry for the tileco layouts (SPEC.md §5.2), kept free of any
// chrome.* API so it tests in plain Node. A port of tide's
// hypr/tide/geometry.lua; the tests share its fixtures.
//
// Every function takes the work area as a box {x, y, w, h} and returns one
// box per tiled window, in window order: masters first, then the stack.
// Boxes are on whole pixels and neighbors share an edge, so the tiles cover
// the area exactly with no gaps and no overlap.

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Cut [start, start + len) into pieces weighted by `weights`, on integer
// edges. Rounding each edge rather than each size keeps the pieces
// contiguous and their total exactly `len`.
function spans(start, len, weights) {
  const total = weights.reduce((a, w) => a + w, 0);
  const out = [];
  let acc = 0;
  let prev = Math.floor(start + 0.5);
  for (const wt of weights) {
    acc += wt;
    const edge = Math.floor(start + (len * acc) / total + 0.5);
    out.push({ pos: prev, size: edge - prev });
    prev = edge;
  }
  return out;
}

function equal(n) {
  return new Array(n).fill(1);
}

// Boxes for columns across `area`, weighted by `weights`.
export function columns(area, weights) {
  const ys = spans(area.y, area.h, [1])[0];
  return spans(area.x, area.w, weights).map((s) => ({ x: s.pos, y: ys.pos, w: s.size, h: ys.size }));
}

// `n` equal rows down `area`.
export function rows(area, n) {
  const xs = spans(area.x, area.w, [1])[0];
  return spans(area.y, area.h, equal(n)).map((s) => ({ x: xs.pos, y: s.pos, w: xs.size, h: s.size }));
}

// The width fraction for a lone window. `rules` is a list of
// {minAspect, width}; the rule with the largest minAspect that the area's
// aspect ratio reaches wins, and nothing matching means full width.
export function singleWidth(area, rules) {
  const aspect = area.h > 0 ? area.w / area.h : 0;
  let best = -1;
  let width = 1.0;
  for (const r of rules || []) {
    if (aspect >= r.minAspect && r.minAspect > best) {
      best = r.minAspect;
      width = r.width;
    }
  }
  return clamp(width, 0.1, 1.0);
}

// A lone window, centered at `singleWidth` of the area.
export function single(area, rules) {
  const f = singleWidth(area, rules);
  if (f >= 1.0) return columns(area, [1]);
  const side = (1 - f) / 2;
  return [columns(area, [side, f, side])[1]];
}

// Master column on the left, stack on the right (dwm "tile").
export function tile(area, n, o) {
  if (n <= 0) return [];
  const m = clamp(o.nmaster ?? 1, 0, n);
  if (m === 0 || m === n) return rows(area, n);
  const cols = columns(area, [o.mfact, 1 - o.mfact]);
  return [...rows(cols[0], m), ...rows(cols[1], n - m)];
}

// Master centered with a stack either side. With a single stack window
// there is nothing to balance, so it is master + one column. Stack windows
// alternate right, left, right... so adding one never moves the others to
// the other side.
export function threecol(area, n, o) {
  if (n <= 0) return [];
  const m = clamp(o.nmaster ?? 1, 1, n);
  const s = n - m;
  if (s === 0) return rows(area, n);
  if (s === 1) {
    const cols = columns(area, [o.mfact, 1 - o.mfact]);
    return [...rows(cols[0], m), cols[1]];
  }
  const side = (1 - o.mfact) / 2;
  const cols = columns(area, [side, o.mfact, side]);
  const nright = Math.ceil(s / 2);
  const right = rows(cols[2], nright);
  const left = rows(cols[0], s - nright);
  const boxes = rows(cols[1], m);
  let r = 0;
  let l = 0;
  for (let k = 1; k <= s; k++) {
    boxes.push(k % 2 === 1 ? right[r++] : left[l++]);
  }
  return boxes;
}

// Masters as full-height columns side by side, the rest stacked on the
// right. With no stack the masters share the whole width.
export function twocol(area, n, o) {
  if (n <= 0) return [];
  const m = clamp(o.nmaster ?? 2, 1, n);
  if (m === n) return columns(area, equal(n));
  const weights = [...new Array(m).fill(o.mfact / m), 1 - o.mfact];
  const cols = columns(area, weights);
  return [...cols.slice(0, m), ...rows(cols[m], n - m)];
}

// Every window fills the area; the focused one is in front.
export function monocle(area, n) {
  return Array.from({ length: n }, () => columns(area, [1])[0]);
}

const MODES = { tile, threecol, twocol, monocle };
export const modes = Object.keys(MODES);

// Boxes for `n` windows in `mode`. A lone window follows the single-window
// rule in every mode.
export function arrange(mode, area, n, o, singleRules) {
  if (n === 1) return single(area, singleRules);
  const f = MODES[mode];
  if (!f) throw new Error(`unknown layout mode: ${mode}`);
  return f(area, n, o || {});
}

// The width fraction a lone window takes when you drag one of its edges
// from box `was` to box `now` (§5.3), each {x, w}. It stays centered, so the
// edge that moved sets the half-width, the right edge if both did. Null if
// neither moved.
export function singleWidthFor(area, was, now) {
  if (area.w <= 0) return null;
  const cx = area.x + area.w / 2;
  let f;
  if (now.x + now.w !== was.x + was.w) f = (2 * (now.x + now.w - cx)) / area.w;
  else if (now.x !== was.x) f = (2 * (cx - now.x)) / area.w;
  else return null;
  return Math.round(clamp(f, 0.1, 1.0) * 1000) / 1000;
}

// The main share that puts window `i`'s `edge` ("left" or "right") at `x`,
// for a window you resized by dragging that edge (§5.3), or null if that
// edge doesn't move with the share: a screen edge, a lone window, monocle.
// Every layout's edges move one way as the share grows, so bisection finds
// the shares that put the edge on pixel `x`, and the middle one is taken.
export function mfactFor(mode, area, n, o, singleRules, i, edge, x) {
  const at = (mfact) => {
    const b = arrange(mode, area, n, { ...o, mfact }, singleRules)[i];
    return edge === "left" ? b.x : b.x + b.w;
  };
  const [lo, hi] = [0.05, 0.95];
  if (at(lo) === at(hi)) return null;
  const sign = at(hi) > at(lo) ? 1 : -1;
  // The least share whose edge is at or past `target`, in the edge's
  // direction of travel.
  const first = (target) => {
    let [a, b] = [lo, hi];
    if (sign * at(a) >= sign * target) return a;
    for (let k = 0; k < 40; k++) {
      const mid = (a + b) / 2;
      if (sign * at(mid) >= sign * target) b = mid;
      else a = mid;
    }
    return b;
  };
  const mfact = (first(x) + first(x + sign)) / 2;
  return Math.round(mfact * 1000) / 1000;
}
