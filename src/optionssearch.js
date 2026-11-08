// The options page's search field (SPEC.md §13): a query keeps the sections
// it finds, by heading and by what each covers, as Launch finds them (§9.4).
// Pure; optionsview.js does the hiding.

import { SETTINGS_SECTIONS } from "./launcher.js";
import { matches } from "./settingssearch.js";

const COVERS = new Map(SETTINGS_SECTIONS.map((s) => [s.id, [s.name, s.covers]]));

// What a query can find a section by: its heading on the page, and its name
// and what it covers in SETTINGS_SECTIONS.
export function sectionTerms(id, heading) {
  return [heading, ...(COVERS.get(id) ?? [])];
}

// Which of `sections`, each {id, heading, shown}, `query` leaves out, by id,
// and whether it found none of those the platform shows. A section the
// platform hides stays hidden whatever the query, so it can't count as found.
export function searchSections(sections, query) {
  const unmatched = sections.filter((s) => !matches(query, sectionTerms(s.id, s.heading))).map((s) => s.id);
  const none = sections.some((s) => s.shown) && sections.every((s) => !s.shown || unmatched.includes(s.id));
  return { unmatched, none };
}
