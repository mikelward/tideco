// The app keys (SPEC.md §9.1): each opens a new window of its app. A window
// or tab belongs to an app by its origin, which the launcher's tab search
// uses to find a tab by its app's name (§9.4).

// The manifest's app keys, which settings can give any web app or
// extension page. The first four are named for their defaults; Chrome keeps
// a command's name with its key, so they stay.
export const APP_COMMANDS = ["app-chat", "app-calendar", "app-meet", "app-music", "app-5", "app-6", "app-7", "app-8"];

// Secure Shell's terminal page, app 5's default: chromeOS's Terminal app is
// a chrome-untrusted:// page, which Chrome won't let an extension open.
export const SECURE_SHELL = "chrome-extension://iodihamcpbpeioajjeobimgagajmlibd/html/nassh.html";

export const DEFAULT_APPS = [
  { command: "app-chat", name: "Google Chat", url: "https://chat.google.com/" },
  { command: "app-calendar", name: "Google Calendar", url: "https://calendar.google.com/" },
  { command: "app-meet", name: "Google Meet", url: "https://meet.google.com/" },
  { command: "app-music", name: "YouTube Music", url: "https://music.youtube.com/" },
  { command: "app-5", name: "Secure Shell", url: SECURE_SHELL },
];

// The schemes an app's address may have: a website's, or an extension's
// page, which a popup window opens as well.
export const APP_SCHEMES = ["https:", "http:", "chrome-extension:"];

// The site `url` belongs to: a website's origin, or an extension's
// "chrome-extension://<id>", or null for anything else (chrome:// pages,
// blank tabs), which no app is.
export function appOrigin(url) {
  try {
    const u = new URL(url);
    if (!APP_SCHEMES.includes(u.protocol) || !u.host) return null;
    return u.protocol === "chrome-extension:" ? `${u.protocol}//${u.host}` : u.origin;
  } catch {
    // An address that doesn't parse names no site.
    return null;
  }
}
const origin = appOrigin;

// The app a URL belongs to, by its origin, or null.
export function appOfUrl(url, apps = DEFAULT_APPS) {
  const o = url && origin(url);
  if (!o) return null;
  return apps.find((a) => a.url && origin(a.url) === o) ?? null;
}

// The app a window belongs to, by its active tab's origin, or null. A tab
// still loading its first page has only the address it's going to.
export function appOf(win, apps = DEFAULT_APPS) {
  const tab = win.tabs?.find((t) => t.active) ?? win.tabs?.[0];
  return appOfUrl(tab?.url || tab?.pendingUrl, apps);
}

// Home's apps by default (§6.1): the app keys' Chat, Calendar and YouTube
// Music, the apps you keep open all day. Meet's calls come and go.
export const DEFAULT_HOME_APPS = ["app-chat", "app-calendar", "app-music"];

// What the options page calls app key `command`: its app's name, or its
// number among the keys (as the manifest's "Open app 1") while it has none.
export function appLabel(command, apps = DEFAULT_APPS) {
  return apps.find((a) => a.command === command)?.name ?? `App ${APP_COMMANDS.indexOf(command) + 1}, off`;
}

// What the keys checklist and the launcher call app key `command`'s
// command: "Open" and its app's name, or its number while it has none. The
// manifest's description can't follow the settings (§9.1).
export function appKeyTitle(command, apps = DEFAULT_APPS) {
  const app = apps.find((a) => a.command === command);
  return app ? `Open ${app.name}` : `${appLabel(command, apps)}`;
}

// `homeApps` with app key `command` in or out, as its box on the options
// page is ticked: one put in goes last, and the rest keep their order, so a
// list you imported isn't reordered.
export function withHomeApp(homeApps, command, on) {
  const rest = homeApps.filter((c) => c !== command);
  return on ? [...rest, command] : rest;
}

// The one of home's apps, `homeApps` naming their keys, that a window
// belongs to, by its site as appOf finds it, or null.
export function homeAppOf(win, apps = DEFAULT_APPS, homeApps = DEFAULT_HOME_APPS) {
  const app = appOf(win, apps);
  return app && homeApps.includes(app.command) ? app : null;
}
