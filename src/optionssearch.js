// The options page's search (SPEC.md §13), as tide for Linux's settings
// panel's and tide for macOS's settings window's: the field at the top of
// the sidebar keeps the pages a query finds, by name and by what each
// covers, as Launch finds them (§9.4). Pure; optionsview.js draws it.

import { SETTINGS_SECTIONS } from "./launcher.js";
import { searchedRows } from "./settingssearch.js";
import { pageIds } from "./optionspages.js";

const BY_ID = new Map(SETTINGS_SECTIONS.map((s) => [s.id, s]));

// What a query finds page `id` by: its name and what it covers.
export function pageTerms(id) {
  const s = BY_ID.get(id);
  return s ? [s.name, s.covers] : [id];
}

// The sidebar's rows (optionspages.js's sidebarRows) that `query` keeps:
// the pages it finds, each under its group's heading, and no heading left
// with no page under it.
export function searchedSidebar(rows, query) {
  return searchedRows(rows, query, (r) => r.page === undefined, (r) => pageTerms(r.page));
}

// The page to show once the sidebar keeps `kept` (rows): the one `showing`
// if it's kept, else the first kept; with none kept, the one showing stays.
export function pageAfterSearch(showing, kept) {
  const ids = pageIds(kept);
  return ids.length === 0 || ids.includes(showing) ? showing : ids[0];
}

// What Escape in the field does: clear a query, else close the settings,
// as tide for Linux's panel and tide for macOS's window do.
export function escapeDoes(query) {
  return query === "" ? "close" : "clear";
}
