// tide off chromeOS (SPEC.md §14.6): the dashboard and its launcher, the
// app keys and keep awake, with nothing tiled, moved or put on a workspace.
// The window manager there places what opens.

import { load as loadSettings } from "./settings.js";
import { toggle as toggleKeepAwake } from "./keepawake.js";
import { worksUntiled } from "./platform.js";
import { displayFor } from "./tide.js";

// The dashboard's window, in storage.session so a worker that slept still
// closes it with the key that opened it.
export const DASHBOARD_KEY = "untiledDashboard";

export class Untiled {
  constructor(api) {
    this.api = api;
    this.queue = Promise.resolve();
  }

  run(step) {
    const done = this.queue.then(step);
    this.queue = done.catch((e) => console.error("tide:", e));
    return done;
  }

  // A command the platform can do, else nothing: a tiling key off chromeOS
  // has nothing to act on, and the toolbar's tooltip says why.
  command(name) {
    return this.run(async () => {
      if (!worksUntiled(name)) {
        console.info(`tide: ${name} works only on chromeOS`);
        return;
      }
      if (name === "popup") return this.dashboard();
      if (name === "keep-awake") return toggleKeepAwake(this.api);
      if (name === "app-browser") return this.api.windows.create({ focused: true });
      const { settings } = await loadSettings(this.api.storage);
      const app = settings.apps.find((a) => a.command === name);
      if (app) return this.api.windows.create({ url: app.url, type: "popup", focused: true });
    });
  }

  // The dashboard over the display you're on; the key again closes it.
  async dashboard() {
    const open = (await this.api.storage.session.get(DASHBOARD_KEY))[DASHBOARD_KEY];
    if (open !== undefined) {
      await this.api.storage.session.remove(DASHBOARD_KEY);
      try {
        await this.api.windows.remove(open);
        return;
      } catch (e) {
        // You closed it yourself: open a new one.
        console.info(`tide: the dashboard (window ${open}) had gone:`, e?.message ?? e);
      }
    }
    const displays = await this.api.system.display.getInfo();
    const focused = (await this.api.windows.getAll({})).find((w) => w.focused);
    const id = focused ? displayFor(focused, displays) : displays[0]?.id;
    const d = displays.find((x) => x.id === id) ?? displays[0];
    const props = { url: this.api.runtime.getURL("src/launcher.html?mode=dashboard"), type: "popup", focused: true };
    if (d) Object.assign(props, { left: d.bounds.left, top: d.bounds.top, width: d.bounds.width, height: d.bounds.height });
    const w = await this.api.windows.create(props);
    await this.api.windows.update(w.id, { state: "fullscreen" });
    await this.api.storage.session.set({ [DASHBOARD_KEY]: w.id });
  }

  // A tab chosen in the launcher: it comes forward, and its window.
  activateTab(tabId, windowId) {
    return this.run(async () => {
      await this.api.tabs.update(tabId, { active: true });
      await this.api.windows.update(windowId, { focused: true });
    });
  }
}
