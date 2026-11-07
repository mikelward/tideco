// The setup checklist (SPEC.md §3.4): the chromeOS settings that bring the
// OS closer to tide. Settings can't be scripted, so each item says where to
// go and what to set, and you tick it off; the ticks are this Chromebook's
// own, kept in storage.local. The keys have their own list (src/keys.js).

import { serialized } from "./watchers.js";

export const SETUP_KEY = "setup";

// Each item's `where` is the settings page to open, `how` what to set there
// and why, and `ref` the spec section that wants it.
export const ITEMS = [
  {
    id: "desks",
    title: "Remove all but one native desk",
    where: "",
    how: "In Overview, close every desk but one, so a stray Search+] has nowhere to go.",
    ref: "§6.3",
  },
  {
    id: "idle",
    title: "Set what happens when idle",
    where: "chrome://os-settings/power",
    how: "Choose sleep, display off or keep on, on charger and on battery.",
    ref: "§11",
  },
  {
    id: "lock",
    title: "Lock when sleeping",
    where: "chrome://os-settings/osPrivacy/lockScreen",
    how: "Turn on \u201cLock when sleeping or lid is closed\u201d, as tide for Linux locks before sleep.",
    ref: "§11",
  },
  {
    id: "dark",
    title: "Dark mode follows the sun",
    where: "chrome://personalization",
    how: "Set Dark mode to Auto, so it switches at sunset and sunrise.",
    ref: "§11",
  },
  {
    id: "focus",
    title: "Turn on focus follows cursor",
    where: "chrome://flags/#focus-follows-cursor",
    how: "Set \u201cFocus follows cursor\u201d to Enabled and restart, so the window under the pointer takes focus without a click, as in KDE. It doesn't raise the window.",
    ref: "§10.2",
  },
];

// What's done, from what's stored: only ticks for items that still exist.
export function progress(stored) {
  const done = new Set(Array.isArray(stored) ? stored : []);
  const ticked = ITEMS.filter((i) => done.has(i.id)).map((i) => i.id);
  return { done: ticked, left: ITEMS.length - ticked.length };
}

// Ticks or unticks an item in `area`, a chrome.storage area. One at a time,
// so two boxes ticked quickly don't each write over the other's list.
export const tick = serialized(async (area, id, on) => {
  const done = progress((await area.get(SETUP_KEY))[SETUP_KEY]).done.filter((d) => d !== id);
  if (on) done.push(id);
  await area.set({ [SETUP_KEY]: done });
});
