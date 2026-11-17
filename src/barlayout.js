// The bar's layout (SPEC.md §8.1), as tide's shell/lib/barlayout.mjs has it:
// which of its items show, and where, in three zones, left, center and
// right, each in the order you give, kept as the barLayout setting. The
// center zone sits on the bar's true middle, moved over only as far as the
// sides need (launcher.css's .zone).

export const ZONES = Object.freeze(["left", "center", "right"]);
export const ZONE_LABELS = Object.freeze({ left: "Left", center: "Center", right: "Right" });

// The items, in today's bar's order: each one's id (tide's), the name the
// options page gives it, its zone and whether it shows unless you say, and
// the bar's elements it moves. The clocks are an item of their own, as on
// tide, so they go left, center or right as the workspaces do. They were
// once one item with keep awake (`from`): a stored list from then, which
// doesn't name them, has them where keep awake is, shown as it is.
export const ITEMS = Object.freeze([
  Object.freeze({ id: "logo", label: "Logo", zone: "left", shown: true, elements: ["logo"] }),
  Object.freeze({ id: "workspaces", label: "Workspaces", zone: "left", shown: true, elements: ["workspaces"] }),
  Object.freeze({ id: "title", label: "Workspace name", zone: "center", shown: true, elements: ["title"] }),
  Object.freeze({ id: "icons", label: "Keep awake", zone: "right", shown: true, elements: ["keep-awake"] }),
  Object.freeze({ id: "clocks", label: "Clocks", zone: "right", shown: true, elements: ["clocks"], from: "icons" }),
]);

// A stored list (barLayout) as every item of ITEMS once, [{id, label, zone,
// shown}], in the stored order: an id it doesn't know or names twice is
// dropped, a zone it doesn't know is the item's default, and an item it
// leaves out goes in after the one it follows by default, or first.
// Anything but a list is the default.
export function layoutList(stored) {
  const known = new Map(ITEMS.map((e) => [e.id, e]));
  const out = [];
  for (const v of Array.isArray(stored) ? stored : []) {
    const e = v !== null && typeof v === "object" ? known.get(v.id) : undefined;
    if (e === undefined || out.some((o) => o.id === e.id)) continue;
    out.push({
      id: e.id,
      label: e.label,
      zone: ZONES.includes(v.zone) ? v.zone : e.zone,
      shown: typeof v.shown === "boolean" ? v.shown : e.shown,
    });
  }
  ITEMS.forEach((e, i) => {
    if (out.some((o) => o.id === e.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const found = out.findIndex((o) => o.id === ITEMS[j].id);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    const was = e.from && out.find((o) => o.id === e.from);
    out.splice(at, 0, { id: e.id, label: e.label, zone: was ? was.zone : e.zone, shown: was ? was.shown : e.shown });
  });
  return out;
}

// The list as barLayout stores it: [{id, zone, shown}].
export function stored(list) {
  return list.map((e) => ({ id: e.id, zone: e.zone, shown: e.shown }));
}

// The list as the options page shows it: by zone, left, center, right, and
// in the stored order within each.
export function byZone(list) {
  return ZONES.reduce((out, z) => out.concat(list.filter((e) => e.zone === z)), []);
}

// The page's list (byZone) with the item at `i` moved `step` places, as
// barLayout stores it, or null when that would move it off either end. A
// step past the first or last item of its zone moves it into the next
// zone, at that zone's near end, so the arrows reach every place.
export function moved(list, i, step) {
  const shown = byZone(list);
  const item = shown[i];
  if (item === undefined) return null;
  const zone = ZONES.indexOf(item.zone);
  const inZone = shown.filter((e) => e.zone === item.zone);
  const at = inZone.indexOf(item);
  const next = shown.slice();
  if ((step < 0 && at > 0) || (step > 0 && at < inZone.length - 1)) {
    next.splice(i, 1);
    next.splice(i + step, 0, item);
    return stored(next);
  }
  const to = zone + Math.sign(step);
  if (to < 0 || to >= ZONES.length) return null;
  next.splice(i, 1);
  const into = { ...item, zone: ZONES[to] };
  const others = next.filter((e) => e.zone === ZONES[to]);
  let where;
  if (step < 0) {
    where = others.length > 0 ? next.indexOf(others[others.length - 1]) + 1 : next.findIndex((e) => ZONES.indexOf(e.zone) > to);
  } else {
    where = others.length > 0 ? next.indexOf(others[0]) : next.findIndex((e) => ZONES.indexOf(e.zone) > to);
  }
  next.splice(where < 0 ? next.length : where, 0, into);
  return stored(byZone(next));
}

// The list with the item at `i` of the page's list (byZone) shown or not,
// as barLayout stores it.
export function switched(list, i, shown) {
  const item = byZone(list)[i];
  return stored(list.map((e) => (e === item ? { ...e, shown } : e)));
}

// Checks a barLayout setting: a list of {id, zone, shown}, an id that's a
// lowercase name, a zone of left, center or right, shown true or false, and
// nothing else. An id the bar doesn't know is layoutList's to drop, so a
// newer tide's list loads.
export function checkBarLayout(v) {
  const ok =
    Array.isArray(v) &&
    v.every(
      (e) =>
        e !== null &&
        typeof e === "object" &&
        !Array.isArray(e) &&
        typeof e.id === "string" &&
        /^[a-z]+$/.test(e.id) &&
        ZONES.includes(e.zone) &&
        typeof e.shown === "boolean" &&
        Object.keys(e).length === 3,
    );
  if (!ok) throw new Error('must be a list like [{"id": "workspaces", "zone": "center", "shown": true}]');
  return v;
}

// Where each of the bar's elements goes, by id: {zone, hidden}, in order
// within its zone, from a stored barLayout.
export function placement(storedLayout) {
  const out = [];
  for (const e of byZone(layoutList(storedLayout))) {
    for (const id of ITEMS.find((i) => i.id === e.id).elements) out.push({ id, zone: e.zone, hidden: !e.shown });
  }
  return out;
}
