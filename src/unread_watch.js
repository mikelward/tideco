// Content script on the watched origins (SPEC.md §10.3): tells tide the page
// title whenever it changes, so tide can see an unread count go up. It reads
// nothing else on the page.

// tide may inject it into a page that already has it (§10.3); one watcher
// per page is enough.
// The flag keeps its pre-rename name so a page already watched before an
// update isn't watched twice.
if (!globalThis.ticoWatching) {
  globalThis.ticoWatching = true;
  let last = null;
  function report() {
    if (document.title === last) return;
    // This page's first report sets its baseline, whatever the tab showed before.
    const first = last === null;
    last = document.title;
    // The service worker may be restarting; the next title change reports again.
    chrome.runtime.sendMessage({ title: last, first }).catch(() => {});
  }
  report();
  new MutationObserver(report).observe(document.head ?? document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}
