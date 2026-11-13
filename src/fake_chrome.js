// A fake of the parts of `chrome` tide uses, for tests. Windows and displays
// are plain objects the test can read and change; every call returns a
// promise, like MV3's chrome.* APIs.

export class FakeChrome {
  constructor({ displays, windows = [] }) {
    this.displaysList = displays;
    this.wins = windows.map((w) => ({ type: "normal", state: "normal", focused: false, alwaysOnTop: false, ...w }));
    this.store = {};
    this.syncStore = {};
    // storage.session, which a browser restart empties.
    this.sessionStore = {};
    this.updates = [];
    this.refuse = new Set();
    this.created = [];
    this.removed = [];
    const fake = this;
    this.system = { display: { getInfo: async () => structuredClone(fake.displaysList) } };
    this.storage = {
      local: {
        get: async (key) => (key in fake.store ? { [key]: structuredClone(fake.store[key]) } : {}),
        set: async (items) => {
          for (const [k, v] of Object.entries(items)) fake.store[k] = structuredClone(v);
        },
      },
      sync: {
        get: async (key) => (key in fake.syncStore ? { [key]: structuredClone(fake.syncStore[key]) } : {}),
        set: async (items) => {
          for (const [k, v] of Object.entries(items)) fake.syncStore[k] = structuredClone(v);
        },
      },
      session: {
        get: async (key) =>
          key === null || key === undefined
            ? structuredClone(fake.sessionStore)
            : key in fake.sessionStore
              ? { [key]: structuredClone(fake.sessionStore[key]) }
              : {},
        set: async (items) => {
          for (const [k, v] of Object.entries(items)) fake.sessionStore[k] = structuredClone(v);
        },
        remove: async (keys) => {
          for (const k of [keys].flat()) delete fake.sessionStore[k];
        },
      },
    };
    // Each window's one tab. A window given `pendingUrl` is still loading its
    // first page, so its tab has no address yet, only where it's going.
    // As Chrome, a tab's address and title show only with tab search, or
    // access to its site ("origin/*" patterns, or all sites).
    this.tabOf = (w) => {
      const tab = w.pendingUrl
        ? { id: w.id * 10, active: true, url: "", pendingUrl: w.pendingUrl, title: w.title ?? "" }
        : { id: w.id * 10, active: true, url: w.url ?? "chrome://newtab/", title: w.title ?? "" };
      const address = w.pendingUrl ?? tab.url;
      const shown = fake.grantedPermissions.has("tabs") || fake.granted || [...fake.grantedOrigins].some((p) => address.startsWith(p.slice(0, -1)));
      if (shown) return tab;
      return { id: tab.id, active: true };
    };
    // A window given `moreTabs`, addresses, has those tabs after its first,
    // `id * 10 + 1` on, not active.
    this.tabsOf = (w) => [
      fake.tabOf(w),
      ...(w.moreTabs ?? []).map((url, i) => ({ id: w.id * 10 + 1 + i, active: false, url, title: "" })),
    ];
    this.windows = {
      getAll: async ({ windowTypes, populate } = {}) =>
        structuredClone(
          fake.wins
            .filter((w) => !windowTypes || windowTypes.includes(w.type))
            .map((w) => (populate ? { ...w, tabs: fake.tabsOf(w) } : w)),
        ),
      create: async ({ url, type = "normal", focused = false, left = 100, top = 100, width = 800, height = 600 } = {}) => {
        const id = Math.max(0, ...fake.wins.map((w) => w.id)) + 1;
        fake.created.push({ id, url, type });
        fake.open({ id, url, type, left, top, width, height });
        if (focused) fake.focus(id);
        return structuredClone(fake.win(id));
      },
      update: async (id, props) => {
        const w = fake.win(id);
        // Like Document picture-in-picture, a window can refuse a state.
        if (props.state && fake.refuse.has(id)) throw new Error(`Window ${id} can't be ${props.state}`);
        fake.updates.push({ id, ...props });
        if (props.focused) {
          for (const o of fake.wins) o.focused = false;
          if (w.state === "minimized") w.state = "normal";
        }
        Object.assign(w, props);
        return structuredClone(w);
      },
      remove: async (id) => {
        fake.win(id);
        fake.removed.push(id);
        fake.wins = fake.wins.filter((w) => w.id !== id);
      },
    };
    this.runtime = { getURL: (path) => `chrome-extension://tide/${path}` };
    // Each window has one tab, `id * 10`; `dimmed` is the set of tabs
    // showing the dim overlay.
    this.dimmed = new Set();
    this.strength = new Map();
    this.granted = false;
    // `granted` is all-sites access; `grantedOrigins` holds narrower grants.
    this.grantedOrigins = new Set();
    // API permissions, such as tabs; tab search is allowed unless a test
    // takes it away.
    this.grantedPermissions = new Set(["tabs"]);
    this.permissions = {
      contains: async ({ origins = [], permissions = [] }) =>
        permissions.every((p) => fake.grantedPermissions.has(p)) && (fake.granted || origins.every((o) => fake.grantedOrigins.has(o))),
    };
    this.registered = new Map();
    this.injected = [];
    this.scripting = {
      getRegisteredContentScripts: async ({ ids } = {}) =>
        structuredClone([...fake.registered.values()].filter((s) => !ids || ids.includes(s.id))),
      registerContentScripts: async (scripts) => {
        for (const s of scripts) {
          if (fake.registered.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
          fake.registered.set(s.id, structuredClone(s));
        }
      },
      unregisterContentScripts: async ({ ids }) => {
        for (const id of ids) fake.registered.delete(id);
      },
      executeScript: async ({ target, args, files }) => {
        const w = fake.wins.find((x) => x.id * 10 === target.tabId);
        if (!w) throw new Error(`No tab with id: ${target.tabId}.`);
        if ((w.url ?? "chrome://newtab/").startsWith("chrome")) throw new Error("Cannot access a chrome:// URL");
        if (files) {
          fake.injected.push({ tabId: target.tabId, files });
          return [{ result: undefined }];
        }
        if (args[0]) {
          fake.dimmed.add(target.tabId);
          fake.strength.set(target.tabId, args[1]);
        }
        else fake.dimmed.delete(target.tabId);
        return [{ result: undefined }];
      },
    };
    // chrome.power's request: "display", "system" or null for none.
    this.awake = null;
    this.power = {
      requestKeepAwake: (level) => {
        fake.awake = level;
      },
      releaseKeepAwake: () => {
        fake.awake = null;
      },
    };
    this.actionTitle = "";
    this.badge = "";
    this.badgeColor = null;
    this.action = {
      setBadgeText: async ({ text }) => {
        fake.badge = text;
      },
      setBadgeBackgroundColor: async ({ color }) => {
        fake.badgeColor = color;
      },
      setTitle: async ({ title }) => {
        fake.actionTitle = title;
      },
    };
    this.tabUpdates = [];
    this.createdTabs = [];
    // Each capture's window, in order. A picture is "data:<window>,<n>",
    // `n` counting captures, so a test can tell a fresh one.
    this.captures = [];
    this.tabs = {
      // As Chrome: all-sites access, a window that shows, and a page that
      // isn't Chrome's own.
      captureVisibleTab: async (id) => {
        const w = fake.win(id);
        if (!fake.granted) throw new Error("Either the '<all_urls>' or 'activeTab' permission is required.");
        if (w.state === "minimized") throw new Error("Failed to capture tab: view is invisible");
        if ((w.url ?? "chrome://newtab/").startsWith("chrome")) throw new Error("Cannot access contents of url");
        fake.captures.push(id);
        return `data:${id},${fake.captures.length}`;
      },
      create: async (props) => {
        fake.createdTabs.push(props);
      },
      update: async (id, props) => {
        fake.tabUpdates.push({ id, ...props });
      },
      // Patterns here are "origin/*", so a prefix match is enough.
      query: async ({ url = [] } = {}) =>
        fake.wins
          .filter((w) => url.some((p) => (w.url ?? "").startsWith(p.slice(0, -1))))
          .map((w) => ({ id: w.id * 10, windowId: w.id, url: w.url })),
    };
  }

  win(id) {
    const w = this.wins.find((x) => x.id === id);
    if (!w) throw new Error(`no window ${id}`);
    return w;
  }

  open(w) {
    this.wins.push({ type: "normal", state: "normal", focused: false, alwaysOnTop: false, ...w });
  }

  focus(id) {
    for (const o of this.wins) o.focused = o.id === id;
  }

  box(id) {
    const w = this.win(id);
    return { x: w.left, y: w.top, w: w.width, h: w.height };
  }
}

export const HD = { id: "hd", bounds: { left: 0, top: 0, width: 1920, height: 1080 }, workArea: { left: 0, top: 0, width: 1920, height: 1032 } };
export const UW = { id: "uw", bounds: { left: 1920, top: 0, width: 3440, height: 1440 }, workArea: { left: 1920, top: 0, width: 3440, height: 1392 } };
