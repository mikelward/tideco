// Tests for bugreport.js: Report a bug's text, its issue page, and opening it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, clock, fileName, ISSUES, issue, redact, REPORT_COMMAND, REPORT_KEY, REPORT_SPAN, Reporter } from "./bugreport.js";
import { Recent } from "./recent.js";
import { FakeChrome, HD } from "./fake_chrome.js";

const ABOUT = {
  version: "1234",
  install: "from the Chrome Web Store",
  browser: "Google Chrome 160.0.7700.10",
  os: "chromeOS 16533.0.0, x86-64",
  permissions: "storage, system.display, scripting, power, tabs; all sites: no",
  displays: "1: 1920×1080",
};

test("the report covers only the 30 seconds before you asked", () => {
  const at = 1_000_000;
  const text = buildReport({
    at,
    offset: 0,
    about: ABOUT,
    tiling: ["Current workspace: in"],
    changes: [
      { t: at - REPORT_SPAN - 1, text: "workspace in → re", cause: "key: workspace-next" },
      { t: at - 1000, text: "workspace re → in", cause: "window 3 took focus" },
      { t: at + 5, text: "workspace in → oc", cause: "after you asked" },
    ],
    log: [
      { t: at - REPORT_SPAN - 1, level: "info", text: "tide: too old" },
      { t: at - REPORT_SPAN, level: "warn", text: "tide: just in time" },
      { t: at + 5, level: "info", text: "tide: too new" },
    ],
  });
  assert.doesNotMatch(text, /workspace-next|too old|too new|after you asked/);
  assert.match(text, /00:16:39\.000 {2}workspace re → in {2}\(window 3 took focus\)/);
  assert.match(text, /00:16:10\.000 warn tide: just in time/);
  assert.match(text, /last 30 seconds/);
});

test("the report names the port, its version, the browser and the OS, and says what's private", () => {
  const text = buildReport({ at: 0, offset: 0, about: ABOUT, tiling: null, changes: [], log: [] });
  const lines = text.split("\n");
  assert.match(lines[0], /^tide for Chrome bug report/);
  assert.match(lines[1], /app names and window titles/);
  assert.match(text, /tide for Chrome 1234, from the Chrome Web Store/);
  assert.match(text, /Google Chrome 160\.0\.7700\.10/);
  assert.match(text, /chromeOS 16533\.0\.0, x86-64/);
  assert.match(text, /Tiling: off/);
  assert.match(text, /none in the last 30 seconds/);
});

test("times are local, with the zone named once", () => {
  assert.equal(clock(Date.UTC(2026, 10, 18, 23, 5, 6, 7), -8 * 60), "15:05:06.007");
  const text = buildReport({ at: Date.UTC(2026, 10, 18, 23, 5, 6), offset: -8 * 60, about: ABOUT, tiling: null, changes: [], log: [] });
  assert.match(text.split("\n")[0], /2026-11-18 15:05:06 \(UTC-08:00\)/);
});

test("no address, home folder or account name leaves in the report", () => {
  assert.equal(redact("Inbox (3) - someone.else+x@gmail.com - Gmail"), "Inbox (3) - user@example.com - Gmail");
  assert.equal(redact("file:///home/mike/notes.txt"), "file://~/notes.txt");
  assert.equal(redact("/Users/mike/x and /home/chronos/u-0a1b2c/MyFiles"), "~/x and ~/MyFiles");
  assert.equal(redact("C:\\Users\\mike\\x"), "~\\x");
  const text = buildReport({ at: 10, offset: 0, about: ABOUT, tiling: ['in: window 1 "a@b.com"'], changes: [], log: [{ t: 9, level: "info", text: "tide: /home/mike" }] });
  assert.doesNotMatch(text, /a@b\.com|mike/);
});

test("the issue page opens with a title and a short body, the report left to paste", () => {
  const { title, body, url } = issue(ABOUT);
  assert.equal(title, "Bug in tide for Chrome 1234");
  assert.match(body.split("\n")[0], /app names and window titles/, "the privacy note comes first");
  assert.match(body, /The full report is on your clipboard: paste it below\./);
  assert.match(body, /tide for Chrome 1234/);
  assert.ok(url.startsWith(`${ISSUES}?`));
  const params = new URL(url).searchParams;
  assert.equal(params.get("title"), title);
  assert.equal(params.get("body"), body);
  assert.ok(url.length < 6000, `${url.length} characters`);
});

test("the issue page is tide for Chrome's", () => {
  assert.equal(ISSUES, "https://github.com/mikelward/tideco/issues/new");
});

test("a saved report's file is named by when it was made", () => {
  assert.equal(fileName(Date.UTC(2026, 10, 18, 23, 5, 6), -8 * 60), "tide-report-2026-11-18-150506.txt");
});

test("Report a bug keeps the report for its page, then opens the page", async () => {
  const chrome = new FakeChrome({ displays: [HD] });
  let now = 100_000;
  const log = new Recent(null, "log", { now: () => now });
  const changes = new Recent(null, "changes", { now: () => now });
  log.add("tide: long ago");
  now = 160_000;
  log.add("tide: a moment ago");
  changes.add("focus window 1 → window 2", { cause: "window 2 took focus" });
  now = 170_000;
  const reporter = new Reporter(chrome, { log, changes, now: () => now, offset: () => 0, agent: { userAgent: "Mozilla/5.0 (X11; CrOS x86_64 16533.0.0) Chrome/160.0.0.0" } });
  await reporter.open(["Current workspace: in"]);
  const kept = chrome.sessionStore[REPORT_KEY];
  assert.match(kept.text, /a moment ago/);
  assert.doesNotMatch(kept.text, /long ago/);
  assert.match(kept.text, /window 2 took focus/);
  assert.match(kept.text, /Current workspace: in/);
  assert.match(kept.text, /CrOS x86_64 16533\.0\.0/, "the browser from its user agent, without client hints");
  assert.ok(kept.url.startsWith(ISSUES));
  assert.equal(kept.made, 170_000);
  assert.deepEqual(chrome.createdTabs, [{ url: "chrome-extension://tide/src/report.html" }]);
});

test("the browser and OS versions come from client hints where Chrome gives them", async () => {
  const chrome = new FakeChrome({ displays: [HD] });
  const agent = {
    userAgent: "frozen",
    userAgentData: {
      getHighEntropyValues: async () => ({
        fullVersionList: [{ brand: "Not=A?Brand", version: "99.0.0.0" }, { brand: "Chromium", version: "160.0.7700.10" }, { brand: "Google Chrome", version: "160.0.7700.10" }],
        platformVersion: "16533.0.0",
      }),
    },
  };
  const about = await new Reporter(chrome, { agent }).about();
  assert.equal(about.browser, "Google Chrome 160.0.7700.10");
  assert.equal(about.os, "chromeOS 16533.0.0, x86-64");
  assert.equal(about.version, "0");
  assert.equal(about.displays, "1: 1920×1080");
});

test("what the browser won't say is left out, and why is logged", async () => {
  const chrome = new FakeChrome({ displays: [HD] });
  chrome.runtime.getPlatformInfo = async () => {
    throw new Error("no");
  };
  const errors = [];
  const original = console.warn;
  console.warn = (...a) => errors.push(a.join(" "));
  try {
    const about = await new Reporter(chrome, { agent: {} }).about();
    assert.equal(about.os, "unknown");
  } finally {
    console.warn = original;
  }
  assert.ok(errors.some((e) => /couldn't tell the platform/.test(e)), errors.join("\n"));
});

test("Report a bug is a command", () => {
  assert.equal(REPORT_COMMAND, "report-bug");
});
