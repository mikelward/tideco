// Report a bug (SPEC.md §14.7): its key, Search+Shift+B, or the launcher's
// action makes a plain-text report of what tide for Chrome is, where it
// runs, and what it did in the 30 seconds before you asked, keeps it in
// chrome.storage.session for the report page (reportview.js), and opens
// that page, which copies it and opens tide for Chrome's issue page.
// Nothing is sent anywhere: you read it and submit the issue yourself.

import { osName } from "./platform.js";

export const REPORT_COMMAND = "report-bug";
// The report, for its page: {text, title, url, made, opened}.
export const REPORT_KEY = "bugReport";
// What the report covers: the log and the changes from this long before
// you asked, which the ring buffers (recent.js) keep more of.
export const REPORT_SPAN = 30_000;
export const ISSUES = "https://github.com/mikelward/tideco/issues/new";
const PORT = "tide for Chrome";
const PRIVACY = "The report may show app names and window titles; nothing was sent anywhere, so check it before you submit.";

const INSTALLS = { normal: "from the Chrome Web Store", development: "loaded unpacked", admin: "installed by your admin", sideload: "installed by another program", other: "installed another way" };

// No account, home folder or user name leaves in a report: an address is
// user@example.com and a home folder ~. The machine's name isn't known to
// an extension, so it can't leak.
export function redact(text) {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "user@example.com")
    .replace(/\/home\/chronos\/u-[0-9a-f]+(?=[/\s"']|$)/g, "~")
    .replace(/\/(?:home|Users)\/[^/\s"']+(?=[/\s"']|$)/g, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+(?=[\\\s"']|$)/g, "~");
}

const pad = (n, width = 2) => String(n).padStart(width, "0");
// `offset` is minutes east of UTC, as -Date.getTimezoneOffset() gives.
const local = (t, offset) => new Date(t + offset * 60_000);

// A time of day, local, to the millisecond.
export function clock(t, offset) {
  const d = local(t, offset);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

function date(t, offset) {
  const d = local(t, offset);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function zone(offset) {
  const a = Math.abs(offset);
  return `UTC${offset < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// The file Save as a file names: when the report was made.
export function fileName(made, offset) {
  return `tide-report-${date(made, offset)}-${clock(made, offset).slice(0, 8).replaceAll(":", "")}.txt`;
}

// The report's text. `at` is when you asked; `about` is Reporter.about()'s;
// `tiling` is tide's workspaces as lines (Tide.describe()), or null off
// chromeOS; `changes` and `log` are the ring buffers' entries, of which
// only those in the REPORT_SPAN before `at` are kept.
export function buildReport({ at, offset, about, tiling, changes, log }) {
  const recent = (entries) => entries.filter((e) => e.t >= at - REPORT_SPAN && e.t <= at);
  const seconds = REPORT_SPAN / 1000;
  const out = [
    `${PORT} bug report, made ${date(at, offset)} ${clock(at, offset).slice(0, 8)} (${zone(offset)})`,
    PRIVACY,
    "",
    `${PORT} ${about.version}, ${about.install}`,
    `Browser: ${about.browser}`,
    `OS: ${about.os}`,
    `Permissions: ${about.permissions}`,
    `Displays: ${about.displays}`,
    tiling ? "Tiling: on" : "Tiling: off, as tide tiles only on chromeOS",
    ...(tiling ?? []).map((l) => `  ${l}`),
    "",
    `Workspace and focus changes, last ${seconds} seconds, oldest first:`,
  ];
  const changed = recent(changes);
  if (changed.length === 0) out.push(`  none in the last ${seconds} seconds`);
  for (const e of changed) out.push(`${clock(e.t, offset)}  ${e.text}${e.cause ? `  (${e.cause})` : ""}`);
  out.push("", `tide's log, last ${seconds} seconds, oldest first:`);
  const lines = recent(log);
  if (lines.length === 0) out.push(`  none in the last ${seconds} seconds`);
  for (const e of lines) out.push(`${clock(e.t, offset)} ${e.level ?? "log"} ${e.text}`);
  return redact(out.join("\n")) + "\n";
}

// The issue page's title and short body, the report itself left on the
// clipboard to paste, so the address stays far under the ~6000 characters
// a browser or GitHub takes.
export function issue(about) {
  const title = `Bug in ${PORT} ${about.version}`;
  const body = redact([
    PRIVACY,
    "",
    `${PORT} ${about.version} (${about.install}), ${about.browser}, ${about.os}.`,
    "",
    "What happened, and what did you expect?",
    "",
    "",
    "The full report is on your clipboard: paste it below.",
    "",
  ].join("\n"));
  return { title, body, url: `${ISSUES}?${new URLSearchParams({ title, body })}` };
}

// The browser's name and version, from client hints where Chrome gives
// them, else its user agent, which Chrome freezes past the major version.
function browserOf(hints, agent) {
  const brands = (hints?.fullVersionList ?? []).filter((b) => !/not.?a.?brand/i.test(b.brand));
  const b = brands.find((x) => x.brand !== "Chromium") ?? brands[0];
  return b ? `${b.brand} ${b.version}` : agent?.userAgent ?? "unknown";
}

export class Reporter {
  // `log` and `changes` are recent.js's buffers; `agent` is the worker's
  // navigator; `offset` gives minutes east of UTC.
  constructor(api, { log = null, changes = null, now = () => Date.now(), offset = () => -new Date().getTimezoneOffset(), agent = globalThis.navigator } = {}) {
    this.api = api;
    this.log = log;
    this.changes = changes;
    this.now = now;
    this.offset = offset;
    this.agent = agent;
  }

  // What a report says about where it runs. Whatever Chrome won't say is
  // "unknown", and why is logged.
  async about() {
    const ask = async (what, f, fallback) => {
      try {
        return await f();
      } catch (e) {
        console.warn(`tide: the bug report couldn't tell ${what}:`, e);
        return fallback;
      }
    };
    const manifest = await ask("its version", () => this.api.runtime.getManifest(), {});
    const self = await ask("how it was installed", () => this.api.management?.getSelf?.() ?? null, null);
    const platform = await ask("the platform", () => this.api.runtime.getPlatformInfo(), null);
    const hints = await ask("the browser's version", () => this.agent?.userAgentData?.getHighEntropyValues?.(["fullVersionList", "platformVersion"]) ?? null, null);
    const granted = await ask("its permissions", () => this.api.permissions.getAll?.() ?? null, null);
    const displays = await ask("the displays", () => this.api.system.display.getInfo(), []);
    let os = "unknown";
    if (platform) os = [osName(platform.os), hints?.platformVersion].filter(Boolean).join(" ") + (platform.arch ? `, ${platform.arch}` : "");
    const origins = granted?.origins ?? [];
    const permissions = granted
      ? `${(granted.permissions ?? []).join(", ")}; all sites: ${origins.includes("<all_urls>") ? "yes" : "no"}; ${origins.filter((o) => o !== "<all_urls>").length} other sites`
      : "unknown";
    return {
      version: manifest?.version ?? "unknown",
      install: INSTALLS[self?.installType] ?? "installed, but how is unknown",
      browser: browserOf(hints, this.agent),
      os,
      permissions,
      displays: displays.length === 0 ? "unknown" : `${displays.length}: ${displays.map((d) => `${d.bounds.width}×${d.bounds.height}${d.isPrimary ? " (main)" : ""}`).join(", ")}`,
    };
  }

  // The report as of now, kept for its page, which then opens. `tiling` is
  // Tide.describe()'s lines, or null off chromeOS.
  async open(tiling = null) {
    const at = this.now();
    const offset = this.offset();
    const about = await this.about();
    await Promise.all([this.log?.ready(), this.changes?.ready()]);
    const since = at - REPORT_SPAN;
    const text = buildReport({ at, offset, about, tiling, changes: this.changes?.since(since) ?? [], log: this.log?.since(since) ?? [] });
    const { title, url } = issue(about);
    await this.api.storage.session.set({ [REPORT_KEY]: { text, title, url, made: at, offset, opened: false } });
    await this.api.tabs.create({ url: this.api.runtime.getURL("src/report.html") });
  }
}
