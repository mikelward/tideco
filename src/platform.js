// What tileco does where it runs (SPEC.md §14.6). It tiles only on chromeOS,
// the one platform whose windows Chrome's window API can lay out as a desktop.
// Elsewhere the desktop has its own window manager, so tileco lays out and
// moves nothing, but keeps its dashboard, launcher, app keys and keep awake
// (untiled.js). tide's own connector, not tileco, lists tabs in tide's
// switcher on Linux (tide's SPEC.md §8.3).

export const TILE = "tile";
export const INERT = "inert";

// `os` is chrome.runtime.getPlatformInfo()'s `os`.
export function roleOf(os) {
  if (os === "cros") return TILE;
  return INERT;
}

const NAMES = { mac: "macOS", win: "Windows", linux: "Linux", cros: "chromeOS", android: "Android", openbsd: "OpenBSD", fuchsia: "Fuchsia" };

export function osName(os) {
  return NAMES[os] ?? "this system";
}

// This platform's os and role. A platform Chrome can't name tiles nothing:
// moving windows on a desktop that has its own window manager would fight it.
export async function platform(api) {
  try {
    const { os } = await api.runtime.getPlatformInfo();
    return { os, role: roleOf(os) };
  } catch (e) {
    console.error("tileco: couldn't tell which platform this is, so tiling is off:", e);
    return { os: undefined, role: INERT };
  }
}

// The toolbar button's tooltip: off chromeOS it says what's missing, since
// a tiling key there does nothing to show it.
export function actionTitle({ os, role }) {
  if (role === TILE) return "tide";
  return `tide · tiling and workspaces work only on chromeOS, not ${osName(os)}`;
}

// The commands that work off chromeOS too: none of them lays out or moves a
// window. The dashboard, the launcher, the app keys and keep awake do;
// every tiling, focus and workspace command needs chromeOS.
export function worksUntiled(command) {
  return command === "popup" || command === "keep-awake" || /^app-/.test(command);
}
