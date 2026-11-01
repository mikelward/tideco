// The app keys (SPEC.md §9.1): each opens a new window of its app. A window
// or tab belongs to an app by its origin, which the launcher's tab search
// uses to find a tab by its app's name (§9.4).

// The manifest's app keys, which settings can give any web app.
export const APP_COMMANDS = ["app-calendar", "app-chat", "app-meet", "app-music"];

export const DEFAULT_APPS = [
  { command: "app-calendar", name: "Google Calendar", url: "https://calendar.google.com/" },
  { command: "app-chat", name: "Google Chat", url: "https://chat.google.com/" },
  { command: "app-meet", name: "Google Meet", url: "https://meet.google.com/" },
  { command: "app-music", name: "YouTube Music", url: "https://music.youtube.com/" },
];

function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    // chrome:// pages and blank tabs have no origin worth matching
    return null;
  }
}

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

// Home's apps by default (§6.1): the app keys' Calendar, Chat and YouTube
// Music, the apps you keep open all day. Meet's calls come and go.
export const DEFAULT_HOME_APPS = ["app-calendar", "app-chat", "app-music"];

// What the options page calls app key `command`: its app's name, or its
// number among the keys (as the manifest's "Open app 1") while it has none.
export function appLabel(command, apps = DEFAULT_APPS) {
  return apps.find((a) => a.command === command)?.name ?? `App ${APP_COMMANDS.indexOf(command) + 1}, off`;
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
