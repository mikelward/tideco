// The clocks (SPEC.md §8.2), following tide's rules: fixed place labels,
// 24-hour times, a zone that is the local zone hidden, and ±1 on a zone
// whose date differs from local.

export const DEFAULT_CLOCKS = [
  { zone: "Australia/Sydney", label: "SYD", city: "Sydney" },
  { zone: "America/Los_Angeles", label: "LAX", city: "Los Angeles" },
  { zone: "America/New_York", label: "NYC", city: "New York" },
  { zone: "Europe/London", label: "LON", city: "London" },
];

// Building an Intl.DateTimeFormat costs far more than using one, and the
// DST search calls these hundreds of times, so each zone's are kept.
const formats = new Map();
function format(zone, kind, options) {
  const key = `${kind} ${zone}`;
  let f = formats.get(key);
  if (!f) formats.set(key, (f = new Intl.DateTimeFormat("en-US", { timeZone: zone, ...options })));
  return f;
}

function parts(date, zone) {
  const f = format(zone, "parts", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), time: `${p.hour}:${p.minute}` };
}

// Whole days from local's date to the zone's date: -1, 0 or +1 (±2 only
// across the date line).
function dayOffset(a, b) {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

// A bad zone is an error naming it, so settings can report it at load.
export function checkZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new Error(`unknown time zone: ${zone}`);
  }
}

// The clock row: each listed zone, then local with its date in place of a
// label. `clocks` is a list of {zone, label}.
export function clockRow(date, localZone, clocks = DEFAULT_CLOCKS, { dedupeLocal = true } = {}) {
  const local = parts(date, localZone);
  const rows = [];
  for (const c of clocks) {
    if (dedupeLocal && c.zone === localZone) continue;
    const p = parts(date, c.zone);
    rows.push({ label: c.label, time: p.time, day: dayOffset(local, p) });
  }
  const month = new Intl.DateTimeFormat("en-US", { timeZone: localZone, month: "short" }).format(date);
  rows.push({ label: `${month} ${local.d}`, time: local.time, day: 0, local: true });
  return rows;
}

// The clocks the bar shows: every one unless it says `bar: false`, as in
// tide's clocks.json (tide SPEC.md §7.3). The dashboard's clock panel lists
// them all.
export function inBar(clocks) {
  return clocks.filter((c) => c.bar !== false);
}

// The offset from UTC of `zone` at `date`, in minutes.
export function offsetMinutes(date, zone) {
  const name = format(zone, "offset", { timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName").value;
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

// The next time `zone`'s offset changes after `date`, to the minute, within
// `horizon` milliseconds (a year by default), or null. It steps six hours at
// a time, since no zone changes its offset twice that close together, then
// bisects to the minute.
export function nextOffsetChange(date, zone, horizon = 366 * 86400000) {
  const start = offsetMinutes(date, zone);
  const step = 6 * 3600000;
  // Offsets change on the minute, so search on whole minutes: from the
  // minute `date` falls in, which still has its offset, every point below
  // is a whole minute and the bisection always narrows.
  let t = Math.floor(date.getTime() / 60000) * 60000;
  for (const end = t + horizon; t < end; ) {
    const next = Math.min(t + step, end);
    if (offsetMinutes(new Date(next), zone) !== start) {
      let lo = t;
      let hi = next;
      while (hi - lo > 60000) {
        const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
        if (offsetMinutes(new Date(mid), zone) === start) lo = mid;
        else hi = mid;
      }
      return new Date(hi);
    }
    t = next;
  }
  return null;
}

// Abbreviations where Chrome's en-US names say "GMT+1" (SPEC.md §8.2): tzdata's
// [standard, daylight] names for common zones. Others fall back to Chrome's.
const CET = ["CET", "CEST"];
const ABBREVIATIONS = {
  "Europe/London": ["GMT", "BST"],
  "Europe/Dublin": ["GMT", "IST"],
  "Europe/Lisbon": ["WET", "WEST"],
  "Europe/Paris": CET,
  "Europe/Berlin": CET,
  "Europe/Madrid": CET,
  "Europe/Rome": CET,
  "Europe/Amsterdam": CET,
  "Europe/Brussels": CET,
  "Europe/Vienna": CET,
  "Europe/Zurich": CET,
  "Europe/Stockholm": CET,
  "Europe/Oslo": CET,
  "Europe/Copenhagen": CET,
  "Europe/Prague": CET,
  "Europe/Warsaw": CET,
  "Europe/Athens": ["EET", "EEST"],
  "Europe/Helsinki": ["EET", "EEST"],
  "Asia/Kolkata": ["IST", "IST"],
  "Asia/Tokyo": ["JST", "JST"],
  "Asia/Shanghai": ["CST", "CST"],
  "Australia/Sydney": ["AEST", "AEDT"],
  "Australia/Melbourne": ["AEST", "AEDT"],
  "Australia/Brisbane": ["AEST", "AEST"],
  "Pacific/Auckland": ["NZST", "NZDT"],
};

// The zone's standard offset: the smaller of its January and July offsets.
function standardOffset(date, zone) {
  const y = date.getUTCFullYear();
  return Math.min(offsetMinutes(new Date(Date.UTC(y, 0, 1)), zone), offsetMinutes(new Date(Date.UTC(y, 6, 1)), zone));
}

// The zone's abbreviation at `date`, like PDT or BST.
export function abbreviation(date, zone) {
  const pair = ABBREVIATIONS[zone];
  if (pair) return pair[offsetMinutes(date, zone) === standardOffset(date, zone) ? 0 : 1];
  return format(zone, "abbr", { timeZoneName: "short" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName").value;
}

// The zone's city: the clock's own, else the zone ID's last part.
export function city(clock) {
  return clock.city ?? clock.zone.split("/").pop().replaceAll("_", " ");
}

// Hours from local to the zone at `date`, like -9 or 5.5.
export function hoursFromLocal(date, localZone, zone) {
  return (offsetMinutes(date, zone) - offsetMinutes(date, localZone)) / 60;
}

// An offset in hours as people read it: "−9 h", "+5 h 30 m", "−9 h 45 m".
export function formatOffset(hours) {
  const total = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${hours < 0 ? "\u2212" : "+"}${h} h${m ? ` ${m} m` : ""}`;
}

export const DAY = [7, 19];
export const WORK = [9, 17];

// A zone's 24-hour strip, on local's hours: the zone's day and working hours
// as {kind, start, end} in local hours from 0 to 24, split where they wrap
// past midnight (SPEC.md §8.2).
export function strip(date, localZone, zone, { day = DAY, work = WORK } = {}) {
  const shift = -hoursFromLocal(date, localZone, zone);
  const segments = [];
  for (const [kind, [from, to]] of [["day", day], ["work", work]]) {
    const start = (((from + shift) % 24) + 24) % 24;
    const end = start + (to - from);
    if (end <= 24) segments.push({ kind, start, end });
    else segments.push({ kind, start, end: 24 }, { kind, start: 0, end: end - 24 });
  }
  return segments;
}

// Local's hour of the day at `date`, with minutes as a fraction.
export function localHour(date, localZone) {
  const [h, m] = parts(date, localZone).time.split(":").map(Number);
  return h + m / 60;
}

const NOTE_DAYS = 21;

function shortDate(date, zone) {
  return format(zone, "short", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

// The clocks changing in the next three weeks, as a sentence, or null:
// "London moves to GMT on Sun, Oct 25." When two zones change on different
// days, it says how the gap between them is off until the second change.
export function dstNote(date, localZone, clocks = DEFAULT_CLOCKS) {
  const zones = [...clocks.filter((c) => c.zone !== localZone), { zone: localZone, city: "Local" }];
  const changes = [];
  for (const c of zones) {
    const at = nextOffsetChange(date, c.zone, NOTE_DAYS * 86400000);
    if (at) changes.push({ clock: c, at });
  }
  if (changes.length === 0) return null;
  changes.sort((a, b) => a.at - b.at);
  // Zones changing on the same local day read as one clause.
  const days = [];
  for (const ch of changes) {
    const day = shortDate(ch.at, localZone);
    const last = days.at(-1);
    if (last?.day === day) last.changes.push(ch);
    else days.push({ day, at: ch.at, changes: [ch] });
  }
  const clauses = days.map(({ day, changes: cs }) => {
    const names = cs.map((c) => city(c.clock));
    const abbrs = [...new Set(cs.map((c) => abbreviation(c.at, c.clock.zone)))];
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return `${who} ${names.length === 1 ? "moves" : "move"} to ${abbrs.join("/")} on ${day}`;
  });
  let note = `${clauses.join("; ")}.`;
  if (days.length > 1) {
    const a = days[0].changes[0].clock;
    const b = days[1].changes[0].clock;
    const gap = (t) => (offsetMinutes(t, a.zone) - offsetMinutes(t, b.zone)) / 60;
    const during = gap(days[0].at);
    const usual = gap(date);
    if (during !== usual) {
      const side = (h) => `${Math.abs(h)} h ${h >= 0 ? "ahead of" : "behind"}`;
      note += ` Until ${days[1].day}, ${city(a)} is ${side(during)} ${city(b)} instead of ${Math.abs(usual)}.`;
    }
  }
  return note;
}

// Scrolling scrubs time in 15-minute steps (SPEC.md §8.2): the first step
// from an unscrubbed time lands on the next quarter hour that way. A scroll
// with no direction, a trackpad's sideways one, leaves it, as tide's does.
export function scrub(date, direction) {
  if (!direction) return date;
  const q = 15 * 60000;
  const t = date.getTime();
  const next = direction > 0 ? Math.floor(t / q) * q + q : Math.ceil(t / q) * q - q;
  return new Date(next);
}
