// The clocks as HTML, shared by the popup and the home window: the row, and
// the popup's detail with each zone's strip, the next DST change and a month
// calendar (SPEC.md §8.2).

import { isoWeek, monthGrid, monthTitle } from "./calendar.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import {
  abbreviation,
  city,
  clockRow,
  dstNote,
  inBar,
  formatOffset,
  hoursFromLocal,
  localHour,
  strip,
} from "./clocks.js";

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// `scrubbed` marks a time you've scrolled to rather than now.
// `settings` are tileco's (src/settings.js): its clocks and hours.
export function renderClocks(ol, now = new Date(), scrubbed = false, { clocks } = DEFAULT_SETTINGS) {
  ol.replaceChildren();
  ol.classList.toggle("scrubbed", scrubbed);
  for (const c of clockRow(now, localZone(), inBar(clocks))) {
    const li = el("li");
    li.append(el("span", "label", c.label), c.time);
    if (c.day !== 0) li.append(el("sup", null, c.day > 0 ? `+${c.day}` : `−${-c.day}`));
    ol.append(li);
  }
}

// `calendar` is the month shown, {year, month}, and `step(by)` moves it.
export function renderDetail(section, now = new Date(), scrubbed = false, settings = DEFAULT_SETTINGS, calendar = null, step = () => {}) {
  const { clocks } = settings;
  const local = localZone();
  section.replaceChildren();
  section.classList.toggle("scrubbed", scrubbed);
  const times = clockRow(now, local, clocks);
  const zones = [...clocks.filter((c) => c.zone !== local), { zone: local, label: "—", city: "Local" }];
  const nowAt = `${(localHour(now, local) / 24) * 100}%`;
  zones.forEach((c, i) => {
    section.append(el("span", "label", c.label));
    const name = el("span", "city", city(c));
    name.append(" ", el("span", "abbr", abbreviation(now, c.zone)));
    section.append(name, el("span", "time", times[i].time));
    const bar = el("div", "strip");
    for (const s of strip(now, local, c.zone, settings)) {
      const seg = el("div", s.kind);
      seg.style.left = `${(s.start / 24) * 100}%`;
      seg.style.width = `${((s.end - s.start) / 24) * 100}%`;
      bar.append(seg);
    }
    const line = el("div", "now");
    line.style.left = nowAt;
    bar.append(line);
    section.append(bar, el("span", "offset", c.zone === local ? "" : formatOffset(hoursFromLocal(now, local, c.zone))));
  });
  const axis = el("div", "axis");
  for (const h of [0, 6, 12, 18, 24]) axis.append(el("span", null, String(h)));
  section.append(axis);
  const note = dstNote(now, local, clocks);
  if (note) {
    const p = el("p", "note");
    p.append(el("strong", null, "Clocks change soon. "), note);
    section.append(p);
  }
  if (calendar) section.append(renderCalendar(calendar, step));
}

// Today's local date, the one the calendar marks.
export function today(at = new Date()) {
  return { year: at.getFullYear(), month: at.getMonth(), date: at.getDate() };
}

function renderCalendar({ year, month }, step) {
  const now = today();
  const head = el("div", "month");
  const move = (by, text, label) => {
    const b = el("button", null, text);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.addEventListener("click", () => step(by));
    return b;
  };
  head.append(move(-1, "‹", "Previous month"), el("strong", null, monthTitle(year, month)), move(1, "›", "Next month"));
  head.append(el("span", "week", `week ${isoWeek(now.year, now.month, now.date)}`));
  const grid = el("div", "days");
  for (const d of ["", "M", "T", "W", "T", "F", "S", "S"]) grid.append(el("span", "dow", d));
  for (const w of monthGrid(year, month, now)) {
    grid.append(el("span", "wk", String(w.week)));
    for (const d of w.days) {
      const cell = el("span", [d.outside && "outside", d.today && "today"].filter(Boolean).join(" "), String(d.date));
      if (d.today) cell.setAttribute("aria-current", "date");
      grid.append(cell);
    }
  }
  const cal = el("div", "calendar");
  cal.append(head, grid);
  return cal;
}
