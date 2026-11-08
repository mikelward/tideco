// The options page's sidebar (SPEC.md §13), as tide for Linux's settings
// panel has it (tide's shell/lib/settings.mjs): each group's heading, which
// can't be chosen, then its pages, with one page showing at a time. Pure;
// optionsview.js draws it.

import { SETTINGS_GROUPS } from "./launcher.js";

// The sidebar, top to bottom, for `pages`, the SETTINGS_SECTIONS shown here:
// each group's heading ({heading}), then its pages ({page, label, icon}). A
// group with no page shown has no heading.
export function sidebarRows(pages) {
  const rows = [];
  for (const group of SETTINGS_GROUPS) {
    const mine = pages.filter((p) => p.group === group.id);
    if (mine.length === 0) continue;
    rows.push({ heading: group.label });
    for (const p of mine) rows.push({ page: p.id, label: p.name, icon: p.icon });
  }
  return rows;
}

// The pages among `rows`, by id, in order.
export function pageIds(rows) {
  return rows.filter((r) => typeof r.page === "string").map((r) => r.page);
}

// The page to show for `id` among `ids`: it, or the first for one the
// sidebar doesn't have; null with none.
export function pageToShow(id, ids) {
  return ids.includes(id) ? id : (ids[0] ?? null);
}

// The page `step` pages on from `current` through `ids`, passing over the
// headings and stopping at either end, as tide's Up and Down do. From a
// page not in `ids`, the first; with none, `current`.
export function movedPage(current, step, ids) {
  if (ids.length === 0) return current;
  const at = ids.indexOf(current);
  if (at < 0) return ids[0];
  return ids[Math.max(0, Math.min(ids.length - 1, at + step))];
}
