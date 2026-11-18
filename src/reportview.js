// Report a bug's page (SPEC.md §14.7). The worker kept the report in
// session storage and opened this page; it copies the report, then opens
// tide for Chrome's issue page with a short body saying to paste it. A copy
// needs this page to have focus, so if it can't copy at once, its button
// does both. Save as a file downloads the report to attach instead.

import { fileName, REPORT_KEY } from "./bugreport.js";

const $ = (id) => document.getElementById(id);
const say = (text) => {
  $("status").textContent = text;
};

function showError(message) {
  $("errors").hidden = false;
  $("errors").replaceChildren(Object.assign(document.createElement("p"), { textContent: message }));
}

// The copy, then the issue page beside this one. Throws if the copy fails.
async function copyAndOpen(report) {
  await navigator.clipboard.writeText(report.text);
  const here = await chrome.tabs.getCurrent();
  await chrome.tabs.create({ url: report.url, ...(here ? { openerTabId: here.id } : {}) });
  // A reload of this page mustn't open another.
  await chrome.storage.session.set({ [REPORT_KEY]: { ...report, opened: true } });
  say("The report is on your clipboard, and the issue page is open: paste it there.");
}

function save(report) {
  const url = URL.createObjectURL(new Blob([report.text], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName(report.made, report.offset ?? 0) });
  a.click();
  // The download has its own copy once it starts.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function start() {
  const report = (await chrome.storage.session.get(REPORT_KEY))[REPORT_KEY];
  if (!report) {
    say("No report yet. Choose Report a bug in tide's Actions to make one.");
    for (const id of ["copy", "save"]) $(id).disabled = true;
    return;
  }
  $("text").value = report.text;
  $("copy").addEventListener("click", () =>
    copyAndOpen(report).catch((e) => {
      console.error("tide: couldn't copy the report or open the issue page:", e);
      showError(`Couldn't copy the report: ${e.message}. Select it below and copy it yourself.`);
    }),
  );
  $("save").addEventListener("click", () => save(report));
  if (report.opened) {
    say("The issue page is already open: paste the report there, or copy it again.");
    return;
  }
  try {
    await copyAndOpen(report);
  } catch (e) {
    // Most often this page didn't have focus yet; the button has it.
    console.info("tide: couldn't copy the report on opening, so the button will:", e?.message ?? e);
    say("Choose Copy and open the issue page, then paste the report there.");
  }
}

start().catch((e) => {
  console.error("tide: couldn't show the report:", e);
  showError(`Couldn't show the report: ${e.message}`);
});
