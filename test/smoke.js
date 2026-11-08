// The smoke test (SPEC.md §17): loads the unpacked extension in Chromium and
// opens its pages, which the node tests can't reach. Tiling, workspaces and
// keys need chromeOS's windows, so FakeChrome covers those instead.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const EXTENSION = fileURLToPath(new URL("..", import.meta.url));

let context;
let worker;
let base;

before(async () => {
  context = await chromium.launchPersistentContext("", {
    headless: false,
    args: ["--headless=new", `--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  // The pages are chromeOS's unless a test says otherwise (SPEC.md §14.6):
  // this Chromium runs on Linux, where the settings show only tide's tab list.
  await context.addInitScript(() => {
    const query = new URLSearchParams(location.search);
    if (location.protocol !== "chrome-extension:" || query.has("real-platform")) return;
    // ?os=linux shows a page as another platform would.
    const info = { os: query.get("os") ?? "cros", arch: "x86-64", nacl_arch: "x86-64" };
    Object.defineProperty(chrome.runtime, "getPlatformInfo", { value: () => Promise.resolve(info), configurable: true });
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // The worker asks the platform at each event, so it tiles from here on;
  // only its startup, which set the toolbar's Linux title, saw Linux.
  await worker.evaluate(() => {
    const info = { os: "cros", arch: "x86-64", nacl_arch: "x86-64" };
    Object.defineProperty(chrome.runtime, "getPlatformInfo", { value: () => Promise.resolve(info), configurable: true });
  });
  base = new URL(".", worker.url()).href.replace(/src\/$/, "");
});

after(async () => {
  await context?.close();
});

// Opens one of the extension's pages, failing on any error it throws.
async function open(path) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + path);
  return { page, errors };
}

// The settings show one page at a time (§13): this turns to page `id` by
// its sidebar button, as a click would.
async function turnTo(page, id) {
  await page.locator(`#sidebar [data-page="${id}"]`).click();
  await page.waitForSelector(`section.page.current#${id}`);
}

// The sidebar as it reads: each group's heading, then its pages.
const sidebarText = (page) => page.locator("#sidebar > :not([hidden])").evaluateAll((l) => l.map((e) => e.textContent));

test("the background worker starts", async () => {
  assert.match(worker.url(), /^chrome-extension:\/\/[a-p]{32}\//);
  // It answers once its module has loaded and its listeners are in place.
  assert.equal(await worker.evaluate(() => typeof chrome.commands.onCommand.hasListeners), "function");
  assert.equal(await worker.evaluate(() => chrome.commands.onCommand.hasListeners()), true);
});

// A new install opens the settings on Extras (§13, §14.1), as this
// Chromium's did when the extension loaded.
test("a new install opens the settings on Extras", async () => {
  // Its tab may open blank and then load the page, at any time.
  const page = await new Promise((resolve) => {
    const watch = (p) =>
      p.waitForURL(/options\.html/, { timeout: 0 }).then(
        () => {
          context.off("page", watch);
          resolve(p);
        },
        // A page closed without loading it isn't the one: wait for the rest.
        (e) => console.debug("not the settings:", e.message),
      );
    context.pages().forEach(watch);
    context.on("page", watch);
  });
  await page.waitForSelector("section.page.current#extras");
  assert.equal(await page.locator('#sidebar [aria-current="page"]').innerText(), "Extras");
  await page.close();
});

// The extension shows itself as tide (SPEC.md, top), rendered text included,
// with tide's logo as each tab's icon.
test("every page says tide, not tideco, under tide's logo", async () => {
  for (const [path, ready] of [["src/options.html", "#sidebar button"], ["src/launcher.html?mode=dashboard", "#logo"], ["src/mouse.html", "body"]]) {
    const { page, errors } = await open(path);
    await page.waitForSelector(ready);
    assert.match(await page.title(), /^tide\b/, path);
    assert.doesNotMatch(await page.locator("body").innerText(), /tideco/i, path);
    const width = await page.evaluate(() => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth);
      img.onerror = () => resolve(0);
      img.src = document.querySelector('link[rel="icon"]')?.href ?? "";
    }));
    assert.equal(width, 32, `${path}'s tab icon doesn't load`);
    assert.deepEqual(errors, [], path);
    await page.close();
  }
});

// The real platform here is the machine's own, Linux in CI but macOS or
// Windows on a developer's machine, and never chromeOS. Off chromeOS the
// settings hide what only tiling uses and the dashboard lists no
// workspaces; only Linux offers tide's tab list.
const HOST_OS = { linux: "Linux", darwin: "macOS", win32: "Windows" }[process.platform];
const ON_LINUX = process.platform === "linux";

// Linux's own page, wherever the test runs.
test("on Linux, the settings offer tide's tab list", async () => {
  const { page, errors } = await open("src/options.html?os=linux");
  await page.waitForSelector('#sidebar [data-page="linux"]');
  await turnTo(page, "linux");
  assert.equal(await page.locator("h2:visible").innerText(), "Tabs in tide's switcher");
  assert.match(await page.locator("#untiled").innerText(), /only on chromeOS, so on Linux/);
  await page.waitForFunction(() => document.getElementById("bridge-state").innerText === "Off");
  assert.equal(await page.locator("#bridge-toggle").innerText(), "Allow");
  assert.equal(await page.locator("#setup").isVisible(), false);
  assert.deepEqual(errors, []);
  await page.close();
});

// The search field (SPEC.md §13), as tide for Linux's and macOS's: focused
// on open, it keeps the pages a query finds under their headings, never
// one the platform hides; the first kept shows if the one showing isn't;
// Up and Down move among those kept; Esc clears, then closes.
test("the settings search keeps the pages it finds", async () => {
  const { page, errors } = await open("src/options.html?os=linux");
  await page.waitForSelector('#sidebar [data-page="linux"]');
  const all = await sidebarText(page);
  const heading = () => page.locator("h2:visible").innerText();
  assert.equal(await page.evaluate(() => document.activeElement.id), "search", "the keyboard starts in the field");
  const search = page.locator("#search");
  assert.equal(await search.getAttribute("placeholder"), "Search settings");
  assert.equal(await heading(), "Keyboard");
  await page.keyboard.type("time zone");
  assert.deepEqual(await sidebarText(page), ["General", "Clocks"]);
  assert.equal(await heading(), "Clocks", "the first kept shows");
  assert.equal(await page.locator("#no-match").isVisible(), false);
  // Up and Down in the field move among the pages kept.
  await search.fill("keys");
  assert.deepEqual(await sidebarText(page), ["Hardware", "Keyboard", "Windows", "Apps"]);
  assert.equal(await heading(), "Keyboard");
  await search.press("ArrowDown");
  assert.equal(await heading(), "Apps");
  await search.press("ArrowDown");
  assert.equal(await heading(), "Apps", "stopping at the end");
  assert.equal(await page.evaluate(() => document.activeElement.id), "search");
  // Appearance is chromeOS's, so off it nothing is found; Apps stays.
  await search.fill("inactive windows");
  assert.deepEqual(await sidebarText(page), []);
  assert.equal(await page.locator("#no-match").innerText(), "No settings match");
  assert.equal(await heading(), "Apps");
  // Esc clears, listing every page and keeping the one showing.
  await search.press("Escape");
  assert.equal(await search.inputValue(), "");
  assert.deepEqual(await sidebarText(page), all);
  assert.equal(await page.locator("#no-match").isVisible(), false);
  assert.equal(await heading(), "Apps");
  // With nothing typed, Esc closes the settings, as tide's do.
  // The press can't hear back from a page that closed under it.
  const closed = page.waitForEvent("close");
  await search.press("Escape").catch((e) => assert.match(e.message, /closed/));
  await closed;
  assert.deepEqual(errors, []);
});

test("off chromeOS, the settings and dashboard keep only what places no window", async () => {
  const { page, errors } = await open("src/options.html?real-platform");
  await page.waitForSelector("#untiled:not([hidden])");
  await page.waitForSelector("#sidebar button");
  assert.deepEqual(await sidebarText(page), ["Hardware", "Keyboard", "Windows", "Apps", "General", "Clocks", "Extras", ...(ON_LINUX ? ["Tabs in tide's switcher"] : []), "Import and export"]);
  // The first page shows.
  assert.equal(await page.locator("h2:visible").innerText(), "Keyboard");
  assert.match(await page.locator("#untiled").innerText(), new RegExp(`only on chromeOS, so on ${HOST_OS}`));
  if (ON_LINUX) {
    await turnTo(page, "linux");
    await page.waitForFunction(() => document.getElementById("bridge-state").innerText === "Off");
    assert.equal(await page.locator("#bridge-toggle").innerText(), "Allow");
  }
  await turnTo(page, "extras");
  await page.waitForSelector("#permissions li");
  assert.equal(await page.locator("#permissions li").count(), 1, "tab search alone");
  await turnTo(page, "keys-section");
  await page.waitForSelector("#keys tbody tr");
  const keys = await page.locator("#keys tbody td:first-child").allInnerTexts();
  assert.ok(!keys.some((k) => /to workspace|stack|layout|monocle/i.test(k)), keys.join(", "));
  assert.doesNotMatch(await page.locator("body").innerText(), /tideco/i);
  // The worker started here, so the toolbar says the tiling keys don't work.
  const title = new RegExp(`work only on chromeOS, not ${HOST_OS}`);
  await page.waitForFunction(async (source) => new RegExp(source).test(await chrome.action.getTitle({})), title.source);
  assert.deepEqual(errors, []);
  await page.close();

  const dash = await open("src/launcher.html?mode=dashboard&real-platform");
  await dash.page.waitForFunction(() => /only on chromeOS/.test(document.getElementById("title").innerText));
  assert.equal(await dash.page.locator("#workspaces button").count(), 0);
  assert.deepEqual(await dash.page.locator(".scopes button:visible").allInnerTexts(), ["Launch", "Tabs", "Actions"], "no Workspaces scope");
  // Actions keeps to what works here: no dim.
  await dash.page.locator('[data-scope="actions"]').click();
  assert.deepEqual((await dash.page.locator("#results .title").allInnerTexts()).slice(0, 2), ["Keep awake", "Reload tide"]);
  await dash.page.locator('[data-scope="launch"]').click();
  await dash.page.locator("#query").fill("work");
  assert.doesNotMatch(await dash.page.locator("#results").innerText(), /Go to workspace/);
  assert.deepEqual(dash.errors, []);
  await dash.page.close();
});

test("the options page renders every page and saves changes", async () => {
  const { page, errors } = await open("src/options.html");
  await page.waitForSelector("#sidebar button");
  // As tide for Linux's sidebar, with Chrome's own pages (§13).
  assert.deepEqual(await sidebarText(page), [
    "Hardware", "Mouse", "Keyboard",
    "Windows", "Layouts", "Workspaces", "Apps",
    "General", "Appearance", "Notifications", "Clocks", "Start at login", "Extras", "Setup checklist", "Import and export",
  ]);
  // One page shows at a time, the first to start with, under its title.
  assert.deepEqual(await page.locator("h2:visible").allInnerTexts(), ["Mouse"]);
  assert.equal(await page.locator('#sidebar [aria-current="page"]').innerText(), "Mouse");
  // Each page scrolls on its own, the sidebar staying put.
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight), true, "the window scrolls");
  // Up and Down in the sidebar move a page, over the headings.
  await page.locator('#sidebar [data-page="keys-section"]').click();
  await page.keyboard.press("ArrowDown");
  assert.deepEqual(await page.locator("h2:visible").allInnerTexts(), ["Layouts"]);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.page), "layouts");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  assert.deepEqual(await page.locator("h2:visible").allInnerTexts(), ["Mouse"], "stopping at the top");
  assert.ok((await page.locator("#clocks tbody tr").count()) > 0, "no clocks");
  assert.ok((await page.locator("#keys tbody tr").count()) > 0, "no keys");
  assert.ok((await page.locator("#modes tbody tr").count()) > 0, "no layouts");
  // Nothing is allowed yet, so every extra offers to be.
  await turnTo(page, "extras");
  await page.waitForSelector("#permissions li");
  assert.deepEqual(await page.locator("#permissions li button").allInnerTexts(), ["Allow", "Allow", "Allow"]);
  await turnTo(page, "unread");
  assert.equal(await page.locator("#watched li").count(), 3, "Gmail, Chat and Calendar to start with");
  assert.match(await page.locator("#watched").innerText(), /not allowed yet/);
  await turnTo(page, "dim");
  await page.locator("#dim-strength").fill("20");
  await page.locator("#dim-strength").dispatchEvent("change");
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.dimStrength === 0.2);

  await turnTo(page, "mouse");
  await page.locator("#wheel-step").fill("200");
  await page.locator("#wheel-step").dispatchEvent("change");
  await page.waitForFunction(async () => (await chrome.storage.local.get("settings")).settings?.wheelStep === 200);

  await turnTo(page, "setup-section");
  await page.locator("#setup input[type=checkbox]").first().check();
  await page.waitForFunction(async () => ((await chrome.storage.local.get("setup")).setup ?? []).length === 1);

  // Start from changes only the keys suggested, and stays on this Chromebook.
  await turnTo(page, "keys-section");
  await page.locator("#keys-preset").selectOption("dwm");
  await page.waitForFunction(async () => (await chrome.storage.local.get("keysPreset")).keysPreset === "dwm");
  const keyFor = (title) => page.locator("#keys tbody tr", { has: page.locator(`td:first-child:text-is("${title}")`) }).locator("td:nth-child(2)");
  await page.waitForFunction(() => /Search\+P/.test(document.getElementById("keys").innerText));
  assert.equal(await keyFor("Toggle monocle").innerText(), "Search+M");
  assert.match(await keyFor("Swap the window with the master").innerText(), /^Search\+Shift\+M Chrome can't bind dwm's Search\+Enter$/);
  await page.locator("#keys-preset").selectOption("tide");
  await page.waitForFunction(async () => (await chrome.storage.local.get("keysPreset")).keysPreset === undefined);

  assert.deepEqual(errors, []);
  assert.equal(await page.locator("#errors").isHidden(), true, await page.locator("#errors").innerText());
});

// The standing workspaces and home's apps show in their fields (§13), so a
// save from another field keeps what's stored.
test("a save from the form keeps the standing workspaces and home's apps", async () => {
  await worker.evaluate(() => chrome.storage.sync.set({ settings: { standing: ["mail", "code"], homeApps: ["app-meet"] } }));
  const { page, errors } = await open("src/options.html#workspaces");
  await page.waitForSelector("#home-apps input");
  await page.waitForFunction(() => /"app-meet"/.test(document.getElementById("json")?.value ?? ""));
  assert.deepEqual(await page.locator("#standing tbody input").evaluateAll((l) => l.map((i) => i.value)), ["mail", "code"]);
  assert.deepEqual(await page.locator("#home-apps input:checked").evaluateAll((l) => l.map((i) => i.dataset.command)), ["app-meet"]);
  await turnTo(page, "dim");
  await page.locator("#dim-strength").fill("30");
  await page.locator("#dim-strength").dispatchEvent("change");
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.dimStrength === 0.3);
  const { settings } = await worker.evaluate(() => chrome.storage.sync.get("settings"));
  assert.deepEqual([settings.standing, settings.homeApps], [["mail", "code"], ["app-meet"]]);
  assert.deepEqual(errors, []);
  await worker.evaluate(() => chrome.storage.sync.remove("settings"));
  await page.close();
});

// The Workspaces section (§13): the standing list, home first, and a box
// for each of home's apps, called by its app's name.
test("the standing workspaces and home's apps are edited, saved and kept", async () => {
  const { page, errors } = await open("src/options.html#workspaces");
  await page.waitForSelector("#home-apps input");
  const names = () => page.locator("#standing tbody input").evaluateAll((l) => l.map((i) => i.value));
  const homeMark = () => page.locator("#standing tbody tr").evaluateAll((l) => l.map((tr) => tr.cells[1].textContent));
  const stored = async () => (await worker.evaluate(() => chrome.storage.sync.get("settings"))).settings;
  assert.deepEqual(await names(), ["in", "re", "oc", "me"]);
  assert.deepEqual(await homeMark(), ["home", "", "", ""]);
  assert.deepEqual(await page.locator("#home-apps label").allInnerTexts(), ["Google Calendar", "Google Chat", "Google Meet", "YouTube Music"]);
  // Added at the end, with Enter.
  await page.locator("#standing-name").fill(" docs ");
  await page.locator("#standing-name").press("Enter");
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.standing?.length === 5);
  assert.equal(await page.locator("#standing-name").inputValue(), "");
  // Moved first, it's home.
  const row = (i) => page.locator("#standing tbody tr").nth(i);
  await row(1).getByRole("button", { name: "Move up" }).click();
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.standing?.[0] === "re");
  assert.deepEqual(await homeMark(), ["home", "", "", "", ""]);
  // Edited in place, and taken out.
  await row(2).locator("input").fill("code");
  await row(2).locator("input").dispatchEvent("change");
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.standing?.includes("code"));
  await row(3).getByRole("button", { name: "Remove" }).click();
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.standing?.length === 4);
  assert.deepEqual((await stored()).standing, ["re", "in", "code", "docs"]);
  // Home's apps: Meet in, Chat out.
  await page.locator("#home-apps").getByLabel("Google Meet").check();
  await page.locator("#home-apps").getByLabel("Google Chat").uncheck();
  await page.waitForFunction(async () => JSON.stringify((await chrome.storage.sync.get("settings")).settings?.homeApps) === JSON.stringify(["app-calendar", "app-music", "app-meet"]));
  // A box follows its app's name as it's saved.
  await turnTo(page, "apps-section");
  const meetName = page.locator('#apps tr[data-command="app-meet"] input.name');
  await meetName.fill("Gmail");
  await meetName.dispatchEvent("change");
  await page.waitForFunction(() => [...document.querySelectorAll("#home-apps label")].some((l) => l.textContent === "Gmail"));
  await turnTo(page, "workspaces");
  assert.equal(await page.locator("#home-apps").getByLabel("Gmail", { exact: true }).isChecked(), true);

  // Kept across a reload.
  await page.reload();
  await page.waitForSelector("#home-apps input");
  assert.deepEqual(await names(), ["re", "in", "code", "docs"]);
  assert.deepEqual(await homeMark(), ["home", "", "", ""]);
  assert.deepEqual(await page.locator("#home-apps input:checked").evaluateAll((l) => l.map((i) => i.dataset.command)), ["app-calendar", "app-meet", "app-music"]);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator("#errors").isHidden(), true, await page.locator("#errors").innerText());
  await worker.evaluate(() => chrome.storage.sync.remove("settings"));
  await page.close();
});

// A name twice, ignoring case, a bad name, or no standing workspace at all
// is refused, naming the setting, and what's stored stays.
test("a standing workspace listed twice is refused, saying why, and isn't saved", async () => {
  const { page, errors } = await open("src/options.html#workspaces");
  await page.waitForSelector("#home-apps input");
  const names = () => page.locator("#standing tbody input").evaluateAll((l) => l.map((i) => i.value));
  const stored = async () => (await worker.evaluate(() => chrome.storage.sync.get("settings"))).settings?.standing;
  // Added: refused, and not left in the list.
  await page.locator("#standing-name").fill("RE");
  await page.locator("#standing-name").press("Enter");
  await page.waitForSelector("#errors:not([hidden])");
  assert.equal(await page.locator("#errors").innerText(), 'standing: workspace 5, "RE", is listed already');
  assert.deepEqual(await names(), ["in", "re", "oc", "me"]);
  assert.equal(await page.locator("#standing-name").inputValue(), "RE", "kept to fix");
  // Edited: marked as you type, refused on change.
  const field = page.locator("#standing tbody tr").nth(3).locator("input");
  await field.fill("In");
  assert.equal(await field.getAttribute("aria-invalid"), "true");
  assert.equal(await field.getAttribute("title"), 'workspace 4, "In", is listed already');
  await field.dispatchEvent("change");
  await page.waitForFunction(() => /workspace 4, "In", is listed already/.test(document.getElementById("errors").innerText));
  await field.fill('say "hi"');
  await field.dispatchEvent("change");
  await page.waitForFunction(() => /can't have quotes/.test(document.getElementById("errors").innerText));
  assert.equal(await stored(), undefined, "nothing saved");
  await field.fill("me");
  await field.dispatchEvent("change");
  await page.waitForFunction(() => document.getElementById("errors").hidden);
  assert.equal(await field.getAttribute("aria-invalid"), "false");
  // Taking out the last one is refused and put back.
  for (let left = 4; left > 1; left--) {
    await page.locator("#standing tbody tr").first().getByRole("button", { name: "Remove" }).click();
    await page.waitForFunction(async (n) => (await chrome.storage.sync.get("settings")).settings?.standing?.length === n, left - 1);
  }
  await page.locator("#standing tbody tr").first().getByRole("button", { name: "Remove" }).click();
  await page.waitForFunction(() => /standing: must name at least one workspace/.test(document.getElementById("errors").innerText));
  assert.deepEqual(await names(), ["me"]);
  assert.deepEqual(await stored(), ["me"]);
  assert.deepEqual(errors, []);
  await worker.evaluate(() => chrome.storage.sync.remove("settings"));
  await page.close();
});

// Each standing workspace's settings (§6.1, §13): home alone asks while
// they're unset; a box changed spells the default out, keeping home's.
test("each standing workspace's asking and pinned apps are edited, saved and kept", async () => {
  const { page, errors } = await open("src/options.html#workspaces");
  await page.waitForSelector("#workspace-settings fieldset");
  const stored = async () => (await worker.evaluate(() => chrome.storage.sync.get("settings"))).settings?.workspaceSettings;
  assert.deepEqual(await page.locator("#workspace-settings legend").allInnerTexts(), ["in", "re", "oc", "me"]);
  const asks = () => page.locator("#workspace-settings input.ask").evaluateAll((l) => l.map((i) => i.checked));
  assert.deepEqual(await asks(), [true, false, false, false], "home alone asks by default");
  await page.getByLabel("New windows on re ask for a workspace").check();
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.workspaceSettings?.re?.askForName === true);
  assert.deepEqual(await stored(), { in: { askForName: true }, re: { askForName: true } });
  await page.getByLabel("Pin Google Chat on in").check();
  await page.getByLabel("Pin Google Calendar on in").check();
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.workspaceSettings?.in?.pinnedApps?.length === 2);
  await page.getByLabel("New windows on in ask for a workspace").uncheck();
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.workspaceSettings?.in?.askForName === false);
  assert.deepEqual(await stored(), { in: { askForName: false, pinnedApps: ["app-chat", "app-calendar"] }, re: { askForName: true } });
  // A standing workspace added gets its own boxes.
  await page.locator("#standing-name").fill("docs");
  await page.locator("#standing-name").press("Enter");
  await page.waitForSelector('#workspace-settings fieldset[data-name="docs"]');

  await page.reload();
  await page.waitForSelector("#workspace-settings fieldset");
  assert.deepEqual(await asks(), [false, true, false, false, false]);
  assert.deepEqual(await page.locator('#workspace-settings fieldset[data-name="in"] .pinned input:checked').evaluateAll((l) => l.map((i) => i.dataset.command)), ["app-calendar", "app-chat"]);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator("#errors").isHidden(), true, await page.locator("#errors").innerText());
  await worker.evaluate(() => chrome.storage.sync.remove("settings"));
  await page.close();
});

test("Start at login keeps this Chromebook's websites, in order", async () => {
  const { page, errors } = await open("src/options.html#startup-section");
  await page.waitForSelector("#startup-form");
  const add = async (site) => {
    await page.locator("#startup-site").fill(site);
    await page.locator("#startup-form button").click();
  };
  const stored = () => worker.evaluate(async () => (await chrome.storage.local.get("settings")).settings?.startup);
  await add("https://mail.google.com");
  await add("https://chat.google.com/");
  await page.waitForFunction(() => document.querySelectorAll("#startup li").length === 2);
  assert.deepEqual(await stored(), ["https://mail.google.com/", "https://chat.google.com/"]);
  await page.locator('[aria-label="Move https://chat.google.com/ up"]').click();
  await page.waitForFunction(async () => (await chrome.storage.local.get("settings")).settings?.startup?.[0] === "https://chat.google.com/");
  // One listed already is refused, and the list stays as it was.
  await add("https://mail.google.com/");
  await page.waitForSelector("#errors:not([hidden])");
  assert.match(await page.locator("#errors").innerText(), /listed already/);
  assert.equal(await page.locator("#startup li").count(), 2);
  // A removal refused because another of this Chromebook's fields is bad
  // is put back, so fixing that field later doesn't save it unseen.
  await turnTo(page, "mouse");
  await page.locator("#wheel-step").fill("5000");
  await turnTo(page, "startup-section");
  await page.locator('[aria-label="Don\'t open https://mail.google.com/ at login"]').click();
  await page.waitForFunction(() => /wheelStep/.test(document.getElementById("errors").innerText));
  assert.equal(await page.locator("#startup li").count(), 2, "the list shows what's saved");
  await turnTo(page, "mouse");
  await page.locator("#wheel-step").fill("");
  await page.locator("#wheel-step").dispatchEvent("change");
  await page.waitForFunction(() => document.getElementById("errors").hidden);
  await turnTo(page, "startup-section");
  assert.deepEqual(await stored(), ["https://chat.google.com/", "https://mail.google.com/"]);
  await page.locator('[aria-label="Don\'t open https://mail.google.com/ at login"]').click();
  await page.waitForFunction(async () => (await chrome.storage.local.get("settings")).settings?.startup?.length === 1);
  assert.deepEqual(errors, []);
  await worker.evaluate(() => chrome.storage.local.remove("settings"));
});

test("the settings open pages in their own window", async () => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.opened = [];
    chrome.tabs.create = async (props) => window.opened.push(props);
  });
  await page.goto(base + "src/options.html#setup-section");
  await page.waitForSelector("#setup li button");
  await page.locator("#setup li button").first().click();
  await turnTo(page, "keys-section");
  await page.locator("#open-shortcuts").click();
  await page.waitForFunction(() => window.opened.length === 2);
  const here = await page.evaluate(async () => (await chrome.windows.getCurrent()).id);
  for (const o of await page.evaluate(() => window.opened)) assert.equal(o.windowId, here, o.url);
});

test("turning off Gmail, Chat and Calendar takes them out of the list", async () => {
  // As with all sites allowed for dimming, which keeps their access: Chrome
  // grants only from a real click, so the page's view of it is faked.
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    chrome.permissions.contains = async () => true;
    chrome.permissions.remove = async () => true;
  });
  await page.goto(base + "src/options.html#extras");
  await page.waitForFunction(() => document.querySelectorAll("#permissions li button")[1]?.textContent === "Turn off");
  await page.locator("#permissions li button").nth(1).click();
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.watched?.length === 0);
  await page.waitForFunction(() => document.querySelectorAll("#permissions li button")[1]?.textContent === "Allow");
  assert.deepEqual(errors, []);
  await worker.evaluate(() => chrome.storage.sync.remove("settings"));
});

for (const mode of ["home", "dashboard"]) {
  test(`the ${mode} page renders the bar, clocks and launcher`, async () => {
    const { page, errors } = await open(`src/launcher.html?mode=${mode}`);
    await page.waitForSelector("#clocks li");
    assert.ok(await page.locator("#query").isVisible(), "no launcher");
    if (mode === "dashboard") await page.locator("#clocks").click();
    await page.waitForSelector(".calendar .days");
    const month = await page.locator(".calendar .month strong").innerText();
    await page.locator('[aria-label="Next month"]').click();
    assert.notEqual(await page.locator(".calendar .month strong").innerText(), month, "the calendar didn't step");
    assert.deepEqual(errors, []);
  });
}

// The bar names the workspaces in bar order, the standing ones before
// they're made, and a click shows one by name (§6.1).
test("the bar lists the workspaces by name, and a click shows one", async () => {
  const { page, errors } = await open("src/launcher.html?mode=home");
  await page.waitForSelector("#workspaces button");
  assert.deepEqual(await page.locator("#workspaces button").allInnerTexts(), ["in", "re", "oc", "me"]);
  await page.locator("#workspaces button", { hasText: "oc" }).click();
  // This tab is no display's home page, so the stored view says where it went.
  await page.waitForFunction(async () => {
    const { view } = await chrome.storage.local.get("view");
    return Object.values(view?.displays ?? {}).some((d) => d.workspace === "oc");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

// Every point of the bar's logo, chips and clocks, top to bottom, reaches
// one of them: none lands on the bar between or around them.
test("a click anywhere on the bar's logo, chips or clocks reaches one", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#clocks li");
  await page.waitForSelector("#workspaces button");
  const dead = await page.evaluate(() => {
    const chips = document.querySelectorAll("#workspaces button");
    const clocks = document.getElementById("clocks");
    const bar = document.querySelector(".bar").getBoundingClientRect();
    const spans = [
      [bar.left, chips[chips.length - 1].getBoundingClientRect().right, (e) => e.closest("#logo, #workspaces button")],
      [clocks.getBoundingClientRect().left, bar.right, (e) => e.closest("#clocks")],
    ];
    const out = [];
    for (const [from, to, owner] of spans) {
      for (let x = Math.ceil(from); x < to; x++) {
        for (const y of [bar.top, (bar.top + bar.bottom) / 2, bar.bottom - 1]) {
          const e = document.elementFromPoint(x, y);
          if (!e || !owner(e)) out.push(`${x},${y}`);
        }
      }
    }
    // The scope chips meet, too.
    const [launch, tabs] = document.querySelectorAll(".scopes button");
    const y = (launch.getBoundingClientRect().top + launch.getBoundingClientRect().bottom) / 2;
    for (let x = Math.ceil(launch.getBoundingClientRect().left); x < tabs.getBoundingClientRect().right; x++) {
      if (!document.elementFromPoint(x, y)?.closest(".scopes button")) out.push(`scopes ${x},${y}`);
    }
    return out;
  });
  assert.deepEqual(dead.slice(0, 10), [], `${dead.length} dead points`);
  // Under the pointer, even at the bar's corner outside the logo itself,
  // the logo's whole target shows, and still takes the click there.
  await page.mouse.move(0, 0);
  const first = await page.evaluate(() => {
    const logo = document.getElementById("logo");
    const shown = getComputedStyle(logo, "::after");
    return {
      background: shown.backgroundColor,
      top: shown.top,
      left: shown.left,
      corner: document.elementFromPoint(0, 0)?.closest("#logo") === logo,
    };
  });
  assert.notEqual(first.background, "rgba(0, 0, 0, 0)", "no hover shown");
  assert.deepEqual([first.top, first.left], ["-5px", "-8px"], "the whole target, not the logo");
  assert.ok(first.corner, "hovering rounds the shape but loses no clicks");
  // Above the clocks' line of text, in their target.
  const row = await page.locator("#clocks").boundingBox();
  await page.mouse.move(row.x + row.width / 2, 1);
  const clocks = await page.evaluate(() => getComputedStyle(document.getElementById("clocks"), "::after").backgroundColor);
  assert.notEqual(clocks, "rgba(0, 0, 0, 0)", "the clocks row shows as one");
  assert.deepEqual(errors, []);
});

// Search+W's name prompt (§6.1): the dashboard on its Workspaces scope,
// where Enter on a new name makes it and shows it.
test("the Workspaces scope lists the workspaces, and Enter on a new name shows it", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard&scope=workspaces");
  await page.evaluate(() => (window.close = () => {}));
  await page.waitForSelector("#workspaces button");
  assert.equal(await page.locator('.scopes [aria-selected="true"]').innerText(), "Workspaces");
  await page.waitForFunction(() => document.querySelectorAll("#results li").length >= 4);
  assert.deepEqual((await page.locator("#results .title").allInnerTexts()).slice(0, 4), ["in", "re", "oc", "me"]);
  assert.match(await page.locator("#results li").first().locator(".kind").innerText(), /^home · /);
  assert.equal(await page.locator("#query").getAttribute("placeholder"), "Go to the workspace named");
  await page.locator("#query").fill("notes");
  assert.deepEqual(await page.locator('#results li[aria-selected="true"] .title').allInnerTexts(), ["notes"]);
  assert.equal(await page.locator('#results li[aria-selected="true"] .kind').innerText(), "new workspace");
  await page.locator("#query").press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll("#workspaces button")].some((b) => b.textContent === "notes"));
  // Tab steps on to Actions, every action and command, then round to Launch.
  await page.locator("#query").fill("");
  await page.locator("#query").press("Tab");
  assert.equal(await page.locator('.scopes [aria-selected="true"]').innerText(), "Actions");
  const acts = await page.locator("#results .title").allInnerTexts();
  assert.deepEqual(acts.slice(0, 3), ["Keep awake", "Dim inactive windows", "Reload tide"]);
  assert.ok(acts.length > 20, `every command too, not the best eight: ${acts.length}`);
  await page.locator("#query").press("Tab");
  assert.equal(await page.locator('.scopes [aria-selected="true"]').innerText(), "Launch");
  // Back home, so the next tests see the standing workspaces alone.
  await page.locator("#workspaces button", { hasText: /^in$/ }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll("#workspaces button")].some((b) => b.textContent === "notes"));
  assert.deepEqual(errors, []);
  await page.close();
});

// Search+Shift+W's prompt keeps to Workspaces, and offers home.
test("the move prompt keeps to Workspaces and offers home", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard&scope=workspaces&move=1");
  await page.waitForSelector("#workspaces button");
  assert.deepEqual(await page.locator(".scopes button:visible").allInnerTexts(), ["Workspaces"]);
  assert.equal(await page.locator("#query").getAttribute("placeholder"), "Move this window to the workspace named");
  await page.waitForFunction(() => document.querySelectorAll("#results li").length >= 4);
  assert.deepEqual((await page.locator("#results .title").allInnerTexts()).slice(0, 4), ["in", "re", "oc", "me"]);
  await page.locator("#query").fill("IN");
  assert.deepEqual(await page.locator("#results li .title").first().innerText(), "in");
  assert.equal(await page.locator("#results li").first().getAttribute("aria-disabled"), null);
  await page.locator("#query").press("Tab");
  assert.equal(await page.locator('.scopes [aria-selected="true"]').innerText(), "Workspaces");
  assert.equal(await page.locator("#keys").innerText(), "Enter to move the window there · ↑ ↓ to choose · Esc to clear or close");
  assert.deepEqual(errors, []);
  await page.close();
});

// A new window's prompt (§6.1) starts with its short name, selected, and
// offers home.
test("a new window's prompt starts with its name selected, and Esc leaves at once", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard&scope=workspaces&move=1&name=Caf%C3%A9%26co");
  await page.evaluate(() => {
    window.shut = false;
    window.close = () => (window.shut = true);
  });
  await page.waitForSelector("#workspaces button");
  assert.equal(await page.locator("#query").inputValue(), "Café&co");
  assert.deepEqual(await page.locator("#query").evaluate((q) => [q.selectionStart, q.selectionEnd]), [0, 7], "selected");
  assert.deepEqual(await page.locator('#results li[aria-selected="true"] .title').allInnerTexts(), ["Café&co"]);
  assert.equal(await page.locator('#results li[aria-selected="true"] .kind').innerText(), "new workspace");
  // Untouched, it filters nothing: every workspace follows it.
  await page.waitForFunction(() => document.querySelectorAll("#results li").length >= 5);
  assert.deepEqual((await page.locator("#results .title").allInnerTexts()).slice(0, 5), ["Café&co", "in", "re", "oc", "me"]);
  // Typing replaces it; with it gone, home is listed.
  await page.locator("#query").press("Backspace");
  await page.waitForFunction(() => document.querySelectorAll("#results li").length >= 4);
  assert.deepEqual((await page.locator("#results .title").allInnerTexts()).slice(0, 4), ["in", "re", "oc", "me"]);
  await page.locator("#query").pressSequentially("ab");
  await page.locator("#query").press("Escape");
  assert.equal(await page.locator("#query").inputValue(), "", "Esc clears what you typed first");
  assert.equal(await page.evaluate(() => window.shut), false);
  // The name it started with isn't typing: Esc leaves at once.
  await page.locator("#query").fill("Café&co");
  await page.locator("#query").press("Escape");
  assert.equal(await page.evaluate(() => window.shut), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test("the bar's cup turns keep awake on and off, and says which", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  const cup = page.locator("#keep-awake");
  await page.waitForSelector("#clocks li");
  assert.equal(await cup.getAttribute("aria-pressed"), "false");
  assert.equal(await cup.getAttribute("title"), "Not keeping awake");
  await cup.click();
  await page.waitForFunction(() => document.getElementById("keep-awake").getAttribute("aria-pressed") === "true");
  assert.equal(await cup.getAttribute("title"), "Keeping awake");
  assert.equal(await worker.evaluate(async () => (await chrome.storage.session.get("keepAwake")).keepAwake), true);
  // Its target meets the clocks', so the gap between them is no dead click.
  const gap = await page.evaluate(() => {
    const c = document.getElementById("keep-awake").getBoundingClientRect();
    const k = document.getElementById("clocks").getBoundingClientRect();
    const out = [];
    for (let x = Math.ceil(c.right); x < k.left; x++) {
      const e = document.elementFromPoint(x, (c.top + c.bottom) / 2);
      if (!e?.closest("#keep-awake, #clocks")) out.push(x);
    }
    return out;
  });
  assert.deepEqual(gap, [], "dead points between the cup and the clocks");
  await cup.click();
  await page.waitForFunction(() => document.getElementById("keep-awake").getAttribute("aria-pressed") === "false");
  assert.deepEqual(errors, []);
});

test("the logo closes the dashboard, and takes home's launcher back to Launch", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#clocks li");
  await page.evaluate(() => {
    window.closes = 0;
    window.close = () => window.closes++;
  });
  await page.locator("#logo").click();
  assert.equal(await page.evaluate(() => window.closes), 1);
  const home = await open("src/launcher.html?mode=home");
  await home.page.waitForSelector("#clocks li");
  await home.page.locator('.scopes [data-scope="tabs"]').click();
  await home.page.locator("#query").fill("x");
  await home.page.locator("#logo").click();
  assert.equal(await home.page.locator('.scopes [aria-selected="true"]').innerText(), "Launch");
  assert.equal(await home.page.locator("#query").inputValue(), "");
  assert.ok(await home.page.evaluate(() => document.activeElement?.id === "query"), "ready to type");
  assert.deepEqual([...errors, ...home.errors], []);
});

test("the footer names only the keys that work in each scope", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#results li");
  assert.equal(await page.locator("#keys").innerText(), "Enter to run · ↑ ↓ to choose · Tab to switch to Tabs · Esc to clear or close");
  await page.locator('.scopes [data-scope="tabs"]').click();
  assert.equal(await page.locator("#keys").innerText(), "Enter to allow tab search · Tab to switch to Workspaces · Esc to clear or close");
  assert.deepEqual(errors, []);
});

test("without tab access, the dashboard opens on Launch and offers tab search", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#results li");
  assert.equal(await page.locator('.scopes [aria-selected="true"]').innerText(), "Launch");
  await page.locator('.scopes [data-scope="tabs"]').click();
  assert.deepEqual(await page.locator("#results .title").allInnerTexts(), ["Allow tab search"]);
  assert.deepEqual(errors, []);
});

test("the dashboard offers the extras still off until you dismiss it", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#extras li");
  assert.deepEqual(await page.locator("#extras li strong").allInnerTexts(), [
    "Find any tab in a keystroke",
    "Show unread counts for Gmail, Chat and Calendar",
    "Dim inactive windows",
  ]);
  await page.locator("#dismiss-extras").click();
  assert.equal(await page.locator("#extras").isHidden(), true);
  const again = await open("src/launcher.html?mode=dashboard");
  await again.page.waitForSelector("#clocks li");
  assert.equal(await again.page.locator("#extras").isHidden(), true, "dismissed stays dismissed");
  const home = await open("src/launcher.html?mode=home");
  await home.page.waitForSelector("#clocks li");
  assert.equal(await home.page.locator("#extras").isHidden(), true, "only on the dashboard");
  assert.deepEqual([...errors, ...again.errors, ...home.errors], []);
  await worker.evaluate(() => chrome.storage.local.remove("extrasDismissed"));
});

test("the dashboard's footer lines up, and its Settings button opens the settings", async () => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.optionsOpened = 0;
    chrome.runtime.openOptionsPage = async () => window.optionsOpened++;
  });
  await page.goto(base + "src/launcher.html?mode=dashboard");
  await page.waitForSelector("#clocks li");
  const middle = (sel) => page.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; });
  const text = await middle("#keys");
  for (const sel of ["#open-settings"]) assert.ok(Math.abs((await middle(sel)) - text) < 1, `${sel} isn't level with the hint`);
  await page.locator("#open-settings").click();
  await page.waitForFunction(() => window.optionsOpened === 1);
});

test("the dashboard stays open while Chrome asks for an extra's access", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#clocks li");
  // Hold the prompt open, and record closes rather than closing.
  await page.evaluate(() => {
    window.answer = null;
    chrome.permissions.request = () => new Promise((resolve) => (window.answer = resolve));
    window.closes = 0;
    window.close = () => window.closes++;
  });
  await page.locator('[aria-label="Allow: Dim inactive windows"]').click();
  await page.waitForFunction(() => window.answer !== null);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(await page.evaluate(() => window.closes), 0, "closed under the prompt");
  await page.evaluate(() => window.answer(false));
  await page.waitForFunction(() => document.activeElement?.id === "query");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(await page.evaluate(() => window.closes), 1, "didn't close once answered");
  assert.deepEqual(errors, []);
});

test("clocks on another day line up with the rest", async () => {
  // A day apart in all, so whatever the time, one is on another day.
  const clocks = [
    { zone: "Pacific/Kiritimati", label: "KIR", city: "Kiritimati" },
    { zone: "Pacific/Pago_Pago", label: "PPG", city: "Pago Pago" },
    { zone: "Europe/London", label: "LON", city: "London" },
    { zone: "Asia/Tokyo", label: "TYO", city: "Tokyo" },
  ];
  await worker.evaluate((clocks) => chrome.storage.sync.set({ settings: { clocks } }), clocks);
  try {
    const { page, errors } = await open("src/launcher.html?mode=dashboard");
    await page.waitForSelector("#clocks sup");
    const bottoms = await page.locator("#clocks .label").evaluateAll((labels) => labels.map((l) => l.getBoundingClientRect().bottom));
    assert.ok(bottoms.length >= clocks.length, `${bottoms.length} clocks`);
    assert.ok(Math.max(...bottoms) - Math.min(...bottoms) < 1, `labels at ${bottoms}`);
    assert.deepEqual(errors, []);
  } finally {
    await worker.evaluate(() => chrome.storage.sync.remove("settings"));
  }
});

test("the mouse page fills the mouse's ID into the crosh lines", async () => {
  await worker.evaluate(() => chrome.storage.local.set({ settings: { wheelStep: 200 }, mouseId: 7 }));
  try {
    const { page, errors } = await open("src/mouse.html");
    await page.waitForFunction(() => document.getElementById("line-1").textContent.includes("200"));
    assert.equal(await page.locator("#mouse-id").inputValue(), "7", "the last ID isn't offered");
    assert.equal(await page.locator("#line-1").innerText(), 'gesture_prop set 7 "Mouse Scroll Accel Curve" array:double:200,0,0,0,0');
    await page.locator("#mouse-id").fill("12");
    await page.locator("#mouse-id").dispatchEvent("change");
    assert.match(await page.locator("#line-0").innerText(), /^gesture_prop set 12 "Mouse High Resolution Scrolling"/);
    await page.waitForFunction(async () => (await chrome.storage.local.get("mouseId")).mouseId === 12);
    // A step changed on the options page reaches the open page.
    await worker.evaluate(() => chrome.storage.local.set({ settings: { wheelStep: 300 } }));
    await page.waitForFunction(() => document.getElementById("line-1").textContent.includes("array:double:300,"));
    assert.deepEqual(errors, []);
    assert.equal(await page.locator("#errors").isHidden(), true, await page.locator("#errors").innerText());
  } finally {
    await worker.evaluate(() => chrome.storage.local.remove(["settings", "mouseId"]));
  }
});

// Tide Settings (§9.4): Launch lists it with the apps, and finds each of
// its sections by a query; Enter opens the settings at that section.
test("Launch finds a settings section and opens the settings there", async () => {
  const { page, errors } = await open("src/launcher.html?mode=home");
  await page.waitForFunction(() => [...document.querySelectorAll("#results .title")].some((t) => t.textContent === "Tide Settings"));
  assert.ok(!(await page.locator("#results .title").allInnerTexts()).includes("Mouse"), "no section until you type");
  await page.locator("#query").fill("wheel");
  assert.deepEqual(await page.locator('#results li[aria-selected="true"] .title').allInnerTexts(), ["Mouse"]);
  // Chrome brings an open settings tab forward rather than opening another.
  for (const p of context.pages()) if (p.url().includes("options.html")) await p.close();
  const opened = context.waitForEvent("page", (p) => p.url().includes("options.html"));
  await page.locator("#query").press("Enter");
  const options = await opened;
  await options.waitForLoadState();
  await options.waitForSelector("section.page.current#mouse");
  assert.equal(await options.evaluate(async () => (await chrome.storage.session.get("settingsSection")).settingsSection), undefined, "asked once");
  await options.close();
  assert.deepEqual(errors, []);
  await page.close();
});

// A right-click on the bar (§8.1) opens the settings at that item's
// section, in place of Chrome's menu; the logo asks for the top, so an open
// tab that's scrolled goes back up.
test("a right-click on a bar item opens the settings at its section", async () => {
  const { page, errors } = await open("src/launcher.html?mode=home");
  await page.waitForSelector("#clocks li");
  await page.evaluate(() => document.addEventListener("contextmenu", (e) => (window.prevented = e.defaultPrevented)));
  for (const p of context.pages()) if (p.url().includes("options.html")) await p.close();
  const opened = context.waitForEvent("page", (p) => p.url().includes("options.html"));
  await page.locator("#clocks").click({ button: "right" });
  assert.equal(await page.evaluate(() => window.prevented), true, "Chrome's menu shows");
  const options = await opened;
  await options.waitForLoadState();
  const showing = (id) => options.waitForSelector(`section.page.current#${id}`);
  await showing("clocks-section");
  // A page the search left out comes back, with every other.
  await options.locator("#search").fill("clocks");
  await page.locator("#workspaces").click({ button: "right" });
  await showing("workspaces");
  assert.equal(await options.locator("#search").inputValue(), "");
  assert.equal(await options.locator('#sidebar [data-page="import-section"]').isVisible(), true);
  // The logo asks for the first page, clearing a search that left it out.
  await options.locator("#search").fill("clocks");
  await page.locator("#logo").click({ button: "right" });
  await showing("mouse");
  assert.equal(await options.locator("#search").inputValue(), "");
  assert.equal(await options.locator('#sidebar [data-page="mouse"]').isVisible(), true);
  await options.close();
  assert.deepEqual(errors, []);
  await page.close();
});
