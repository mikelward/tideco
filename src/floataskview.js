// The question after Search+Shift+F floats an app window no rule covers
// (SPEC.md §5.4), in the small window tide opens for it: Always float adds
// the site's rule, Edit rule… opens the Floating page with it filled in,
// and Not now, Esc or leaving it closes it. tide asks about a site once
// until the browser restarts, whatever the answer.

import { askText, checkSite, FILL_KEY, withRule } from "./floating.js";
import { SECTION_KEY } from "./launcher.js";
import { editShared } from "./settings.js";

const $ = (id) => document.getElementById(id);
// Left unanswered this long, it's Not now, as a notification expires.
const EXPIRES = 30_000;

function showError(message) {
  $("errors").hidden = false;
  $("errors").replaceChildren(Object.assign(document.createElement("p"), { textContent: message }));
}

const { site, error } = checkSite(new URLSearchParams(location.search).get("site"));
const expiry = setTimeout(() => window.close(), EXPIRES);
// Once you start answering, it waits for you.
const answering = () => clearTimeout(expiry);

if (error) {
  console.error("tide: the float question has no site:", error);
  showError(`Nothing to ask about: ${error}.`);
  for (const id of ["always", "edit"]) $(id).disabled = true;
} else {
  const { title, body } = askText(site);
  document.title = title;
  $("question").textContent = title;
  $("detail").textContent = body;
}

$("always").addEventListener("click", async () => {
  answering();
  try {
    await editShared(chrome.storage, "floating", (rules) => {
      const out = withRule(rules, site);
      return out.error ? { error: out.error } : { value: out.rules };
    });
    window.close();
  } catch (e) {
    console.error(`tide: couldn't add the float rule for ${site}:`, e);
    showError(`Couldn't add the rule: ${e.message}`);
  }
});

$("edit").addEventListener("click", async () => {
  answering();
  try {
    await chrome.storage.session.set({ [SECTION_KEY]: "floating", [FILL_KEY]: site });
    await chrome.runtime.openOptionsPage();
    window.close();
  } catch (e) {
    console.error("tide: couldn't open the Floating settings:", e);
    showError(`Couldn't open the settings: ${e.message}`);
  }
});

$("later").addEventListener("click", () => window.close());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.close();
});
