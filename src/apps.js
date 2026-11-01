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

// The one of home's apps, `homeApps` naming their keys, that a window
// belongs to, by its site as appOf finds it, or null.
export function homeAppOf(win, apps = DEFAULT_APPS, homeApps = DEFAULT_HOME_APPS) {
  const app = appOf(win, apps);
  return app && homeApps.includes(app.command) ? app : null;
}
