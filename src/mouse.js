// The mouse reminder (SPEC.md §19.2). A longer wheel step needs two
// `gesture_prop` lines in crosh, which nothing keeps across a reboot and no
// extension can run, so with `wheelStep` set tide opens a page with them,
// ready to copy, at each login.

import { load } from "./settings.js";

export const MOUSE_PAGE = "src/mouse.html";
// The ID the page last used, as a hint: an ID can change between boots.
export const MOUSE_ID_KEY = "mouseId";

export const DEVICES = "gesture_prop devices";

// The lines for device `id`, each run on its own (crosh runs only a paste's
// first line). The curve's first term is the step per click; it applies
// only with high-resolution scrolling off.
export function croshLines(id, step) {
  return [
    `gesture_prop set ${id} "Mouse High Resolution Scrolling" array:boolean:false`,
    `gesture_prop set ${id} "Mouse Scroll Accel Curve" array:double:${step},0,0,0,0`,
  ];
}

// Opens the page if this Chromebook has a wheel step; `chrome` is the
// extension API. Resolves to whether it opened.
export async function remind(chrome) {
  const { settings, errors } = await load(chrome.storage);
  // A bad wheelStep keeps the default, off; say why there's no page.
  for (const e of errors) if (e.startsWith("wheelStep")) console.error(`tide: no mouse reminder: ${e}`);
  if (settings.wheelStep === null) return false;
  await chrome.tabs.create({ url: chrome.runtime.getURL(MOUSE_PAGE) });
  return true;
}
