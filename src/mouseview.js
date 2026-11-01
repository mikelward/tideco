// The mouse reminder's page (SPEC.md §19.2): the crosh lines for this
// Chromebook's wheel step, with the mouse's ID filled in.

import { croshLines, DEVICES, MOUSE_ID_KEY } from "./mouse.js";
import { load, settingsChanged } from "./settings.js";

const $ = (id) => document.getElementById(id);

function showErrors(list) {
  $("errors").hidden = list.length === 0;
  $("errors").replaceChildren(...list.map((e) => Object.assign(document.createElement("p"), { textContent: e })));
}

let step = null;

function render() {
  const id = $("mouse-id").value.trim() || "<id>";
  croshLines(id, step ?? "<step>").forEach((line, i) => ($(`line-${i}`).textContent = line));
}

// The step as set now, so a change made on the options page while this
// page is open reaches the lines.
async function loadStep() {
  const { settings, errors } = await load(chrome.storage);
  step = settings.wheelStep;
  const found = errors.filter((e) => e.startsWith("wheelStep"));
  if (step === null && found.length === 0) found.push("This Chromebook has no wheel step set; set one in tide's settings, under Mouse.");
  showErrors(found);
  render();
}

$("devices").textContent = DEVICES;
$("mouse-id").value = (await chrome.storage.local.get(MOUSE_ID_KEY))[MOUSE_ID_KEY] ?? "";
await loadStep();
chrome.storage.onChanged.addListener((changes) => {
  if (settingsChanged(changes)) loadStep().catch((e) => showErrors([`Couldn't read the wheel step: ${e.message}`]));
});
$("mouse-id").addEventListener("input", render);
$("mouse-id").addEventListener("change", () => {
  const id = Number($("mouse-id").value);
  if (!Number.isInteger(id) || id < 0) return;
  chrome.storage.local.set({ [MOUSE_ID_KEY]: id }).catch((e) => showErrors([`Couldn't keep the ID: ${e.message}`]));
});
for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", () =>
    navigator.clipboard.writeText($(b.dataset.copy).textContent).then(
      () => (b.textContent = "Copied"),
      (e) => showErrors([`Couldn't copy: ${e.message}`]),
    ),
  );
}
$("done").addEventListener("click", () => window.close());
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
