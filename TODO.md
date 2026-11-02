# TODO

## Named workspaces (SPEC.md §6.1)

Replace the nine numbered workspaces with tide's named ones, a PR each:

- [x] The model: names in storage, standing ones and home, empty ones
  removed once left, bar order; migrate a stored numbered state by naming
  workspace 1 home and the others by their numbers' order after the
  standing ones *(a guess)*. `src/workspaces.js`, with tests.
- [x] Keys: `Search+1…9` and `Search+Shift+1…9` as the Nth in bar order,
  `Search+Home` and `Search+End`, in `manifest.json` and `src/tileco.js`.
  The bar and badge by name came with them.
- [x] The `Search+W` / `Search+Shift+W` commands, the dashboard's
  Workspaces scope and the name prompt. Home refuses every window moved
  by the prompt until its apps are listed.
- [x] Home's apps, and the prompt for a new window on home. The
  `homeApps` setting, its options-page fields still to come.
- [x] Options: the standing list and home's apps, in the Workspaces
  section.

All five are built, tested with FakeChrome and the smoke test; what's left
is trying them on a Chromebook, with M2's device checks.

## One workspace across every display, as in tide and tilemo

tide and tilemo now show one workspace on every display at once, each
display with its own part of it and its own layout (tide SPEC.md §6.5,
tilemo SPEC.md §6.1); tileco still shows one workspace per display from a
shared pool (SPEC.md §6.1, its parity table says **partial**). Bring
tileco to the same model:

- First, check on a Chromebook with two displays whether chromeOS lets an
  extension show a workspace on every display together without a visible
  flicker: tileco shows and hides windows itself, so a switch is one
  minimize or restore per window, on every display.
- Then: each window keeps its display within its workspace; a switch
  shows every display's part, focus staying on the display it was on;
  the bar and the launcher's Workspaces list each workspace once; a
  display that goes away hands its windows to the first one left, and
  gets them back when it returns. tide's `hypr/tide/span.lua` and
  tilemo's `wm.lua` are the models to follow.

## Decisions needing review

Guesses made on autopilot (2026-10-24), each cheap to undo.

- **Launch's empty query lists only the apps; the commands moved to
  Actions** (2026-11-01), so Launch reads as a start menu. A query in
  Launch still finds commands and actions. The alternative is Launch
  listing commands after the apps, as before. Reversible: `EMPTY` in
  `src/launcher.js`.
- **The settings app is "Tide Settings", in the user's words**
  (2026-11-01), though the options page calls itself "tide settings".
  Its sections are listed by the page's headings, shortened ("Layouts",
  "Mouse", "Start at login"). Reversible: `SETTINGS_APP` and
  `SETTINGS_SECTIONS` in `src/launcher.js`.
- **Actions turns the dim off by pausing it, keeping Chrome's access**
  (2026-11-01), so turning it back on needs no prompt; the options
  page's "Turn off" still gives the access back. Reversible:
  `toggleDim` in `src/launcherview.js`.
- **Named workspaces' keys are `Search+W` and `Search+Shift+W`**
  (2026-11-01), W for workspace, since Chrome can't bind tide's
  `Super+Return`; `Search+Home` and `Search+End` are tide's. The
  alternative is no keys for the prompt, only the dashboard's Workspaces
  scope. Reversible: the commands in `manifest.json`.
- **The name prompt is the dashboard's** (2026-11-01), opened on a
  Workspaces scope, since an extension can't draw over another window.
  Esc on a new window's prompt leaves it on home, where tide's closes it,
  since Chrome can't ask a page to close politely. Reversible: SPEC.md
  §6.1.
- **A new window's default name is its title's first word** (2026-11-01),
  tide's short name without `namePatterns`, which tileco has no setting
  for yet. Reversible: SPEC.md §6.1.
- **A stored numbered state keeps its numbers as names** (2026-11-01):
  workspace 1 becomes home, and each other one holding a window or showing
  becomes a made workspace named by its number, after the standing ones,
  so nothing moves; the empty hidden ones go. The alternative is moving
  every window to home, or numbered ones onto the standing names in order.
  Reversible: `migrate` in `src/workspaces.js`.
- **A display with nothing left to show gets the lowest free number**
  (2026-11-01): when every listed workspace already shows on another
  display, a new one shows a new workspace named "1", "2", and so on, as
  tide can't say. The alternative is no workspace there until you pick
  one. Reversible: `freshName` in `src/workspaces.js`.
- **A name prompt's key while one's open swaps it** (2026-11-01):
  `Search+W` again closes its prompt, as `Search+Space` closes the
  dashboard, and `Search+Shift+W` or `Search+Space` puts its own in place,
  rather than waiting its turn as tide's prompts do. The alternative is
  tide's queue. Reversible: `dashboard` in `src/tileco.js`.
- **`Search+Shift+W`'s prompt keeps to Workspaces** (2026-11-01): no
  Launch or Tabs chip, and Tab stays, so Enter can only ever move the
  window. The alternative is every scope, Enter moving the window only on
  Workspaces. Reversible: `scopes` in `src/launcherview.js`.
- **Home isn't listed in `Search+Shift+W`'s prompt** (2026-11-01), as in
  tide's, but for a window of one of home's apps, and typing its name
  shows "home holds only its own apps". The
  alternative is listing it, greyed, with that reason. Reversible:
  `workspaceRows` in `src/launcher.js`.
- **Tab cycles Launch, Tabs, Workspaces, and Shift+Tab goes back**
  (2026-11-01), so Tab from Tabs now goes to Workspaces, not back to
  Launch. The alternative is Tab flipping Launch and Tabs, with Workspaces
  reached only by its chip or `Search+W`. Reversible: `nextScope` in
  `src/launcher.js`.
- **A name dropped from the standing list is an ordinary workspace**
  (2026-11-01): it stays, after the standing ones, while it holds a window
  or shows, then goes. The alternative is moving its windows home.
  Reversible: `tidy` in `src/workspaces.js`.
- **Standing names are trimmed, not refused for spaces** (2026-11-01), as
  the clocks' labels are; tide refuses a name with space around it. The
  alternative is tide's refusal. Reversible: `checkStanding` in
  `src/settings.js`.
- **`Search+End` remembers the workspaces you show** (2026-11-01): a key,
  a click or a window brought up, but not one a swap moves onto the other
  display. The alternative counts every display's changes. Reversible:
  `show` in `src/workspaces.js`.
- **Home's apps are app keys** (2026-11-01): `homeApps` names the app keys
  (`app-calendar`, `app-chat`, `app-music` by default), so a window is one
  by its active tab's site, as the launcher finds an app's tabs. §6.1's
  "mail where §9.1 lists it" adds nothing, since no app key is mail until
  you give one its site. The alternative is a list of sites of its own,
  as tide's `inApps` takes web addresses. Reversible: `checkHomeApps` in
  `src/settings.js` and `homeAppOf` in `src/apps.js`.
- **A home app's key shows home** (2026-11-01): its window joins home, and
  since the key focuses it, home comes with it, where any other new home
  app window joins home hidden and your display stays. The alternative
  is the key opening it hidden too, which a focused window can't be.
  Reversible: `app` in `src/tileco.js`.
- **Only new windows ask** (2026-11-01): windows open when tileco first
  runs, and those a restart brings back, even unmatched, never ask, nor
  any window already on home before this change. The alternative asks
  for every window on home's first focus, which a migrated workspace 1
  would turn into a run of prompts. Reversible: `asks` in `Tileco.sync`.
- **A waiting prompt opens where you are** (2026-11-01): once the prompt
  before it closes, the next window's opens over whatever workspace
  you're on, home staying hidden if you left it, the field naming the
  window. The alternative brings home back to show the window first.
  Reversible: `ask` in `src/tileco.js`.
- **Any open dashboard holds a new window's prompt** (2026-11-01), not
  only another prompt, as one dashboard shows at a time. In practice the
  new window's focus closes the dashboard, which then lets it ask.
  Reversible: `ask` in `src/tileco.js`.
- **Esc on an untouched starting name closes the prompt** (2026-11-01),
  where Esc otherwise clears the field first, since that name isn't
  typing. The alternative is two presses. Reversible: the Esc handler in
  `src/launcherview.js`.
- **The short name is only a website's** (2026-11-01): a tab that isn't
  on `http` or `https`, such as the new tab page's "New Tab", starts the
  field empty, and the title is read once, when the prompt opens, where
  tide's follows a title that changes. The alternative is following the
  title through `storage.onChanged`. Reversible: `ask` in
  `src/tileco.js`.
- **A standing name edited on the options page is a new entry**
  (2026-11-01), not a rename: the old workspace keeps its windows as an
  ordinary one, as a name taken out does, so editing home's name makes a
  new, empty home. tide's page has no edit, only add and remove. The
  alternative is names you can only add and take out, as tide's.
  Reversible: `standingRow` in `src/optionsview.js`.
- **An app key with no app can still be one of home's** (2026-11-01): its
  box reads "App 3, off" and can be ticked, since `homeApps` names keys,
  so the app you give it later is home's. The alternative is hiding or
  disabling the box until the key has an app. Reversible:
  `renderHomeApps` in `src/optionsview.js`.

- **Keep awake is `Search+S`** (2026-10-31), as tide's and tilemo's
  `Super+S`, though chromeOS has select to speak there, and whether the
  Shortcuts app can remove it is untried. The alternative is `Search+P`,
  free, which tide gave presenter mode. Reversible: the command's
  description in `manifest.json`; Chrome binds no key for it either way.
- **`Search+S` shows nothing but the cup and the toolbar tooltip**
  (2026-10-31): tide's OSD has no equivalent, and a notification would
  cost the `notifications` permission's install warning, which disables an
  installed tileco until the warning is accepted. The alternative is that
  notification, or flashing the toolbar badge. Reversible: `toggle` in
  `src/keepawake.js`.
- **No presenter mode** (2026-10-31): tide's `Super+P` is keep awake plus
  Do not disturb, and an extension can't reach chromeOS's Do not disturb.
  The alternative is a presenter command that holds keep awake alone, as
  tide does without its notification server. Reversible: a command.
- **The bar's logo is tide's two waves** (2026-10-31), so the bar reads
  the same on tide, tilemo and tileco. Since 2026-11-01 the extension's
  icon is the same waves. Reversible: the SVG in `src/launcher.html`.
- **The extension calls itself tide** (2026-11-01): name, toolbar tooltip,
  command descriptions, page titles and text. The icon is the waves in
  white on `#3584e4`, tide's `accent-bg`, the old icon's blue, at 6.5x
  tide's 16 px paths with a 1.75 stroke so the 16 px icon stays legible;
  the alternative is tide's 1.5 stroke. Reversible: `manifest.json`, the
  pages, and `icons/tileco.svg` plus `make icons`.
- **File names keep tileco** (2026-11-01): `icons/tileco-*.png`,
  `tileco.svg`, `tileco.js`, the ZIP's name, so nothing a user stored or
  bound moves. `icons/tileco-alt.svg`, the old T's alternative, is left as
  it was, unused. The alternative is renaming the icon files to `tide-*`
  and deleting the alt. Reversible: a rename.
- **Console messages keep their `tileco:` prefix** (2026-11-01): they're
  for whoever debugs the worker, not shown on a page. The alternative is
  `tide:`. Reversible: a search and replace.
- **Pages get a tab icon** (2026-11-01), `icons/tileco-32.png`, so a
  settings or home tab shows the waves. Reversible: the `<link rel="icon">`
  in each page.
- **"tide on Linux" where a page means the desktop** (2026-11-01), now
  that the extension is tide too: the setup checklist's lock item and the
  settings' setup and import text. The alternative is plain "tide".
  Reversible: `src/setup.js` and `src/options.html`.
- **Start at login is per Chromebook, and websites only** (2026-10-31),
  as tide's `startup.local.json` is per machine; an extension can't run a
  program. The alternative is a synced list. Reversible: move `startup`
  from `PER_MACHINE` to `SHARED` in `src/settings.js`.
- **Start at login opens on the workspace you're on, and checks nothing
  already open** (2026-10-31): tide opens home's apps on home, which
  tileco now does too (2026-11-01), and starts a web address whatever runs, so a site
  Chrome restores itself shows twice. The alternatives are a workspace per
  address, or skipping a site with a tab already open, which needs tab
  access and races Chrome's restore. Reversible: `Tileco.startAtLogin`.
- **The bar's middle stays a dead space** (2026-10-31): tileco's title
  does nothing on a click, so the room between the chips and the clocks
  isn't given to either; the clocks reach 7px left, half their own gap.
  The alternative is to split that room between the layout symbol and the
  clocks. Reversible: `#clocks::before` in `launcher.css`.
- **Hover is a translucent overlay, darker in light and lighter in dark**
  (2026-10-31): `--hover` is black at 8% on the light bar and white at
  10% on the dark one, since a darker gray doesn't show on a near-black
  bar. It tints a current (accent) chip too. The alternative is opaque
  grays per theme, which would hide a chip's own color. Reversible: the
  `--hover` token in `launcher.css`.
- **No `AGENTS.md` in tileco yet.** The sibling repos each have one; tileco
  follows their shared conventions (tide's especially) without its own copy.
  The alternative is a short one pointing at `SPEC.md` and those
  conventions. Reversible: add the file.
- **Plain Node, no build step, and no runtime dependencies.** Tests use
  `node --test` on Node 22 (CI pins major 22), ES modules throughout, so the
  extension loads the same files it tests. Playwright is the one dev
  dependency, for the smoke test (maintainer, 2026-10-24). The alternative
  is TypeScript or a bundler. Reversible: nothing yet depends on the
  toolchain.
- **The four suggested keys are `Search+J`, `Search+K`, `Search+Space` (the
  dashboard) and `Search+Tab`**, each with an `Alt+Shift+` default so the
  manifest installs off chromeOS too. Attention's default is `Alt+Shift+U`,
  not `Alt+Shift+Tab`, which Windows and most Linux desktops take for window
  switching. `Search+.` (next layout) lost its suggestion to make room.
  Swap-with-master moved off `Search+Space` to `Search+Shift+M`, bound by
  hand; `Search+Z` was the first idea, but it's chromeOS's layout menu.
  Reversible: edit `manifest.json`.
- **A maximized or fullscreen window on a workspace you leave is minimized
  like the rest, and comes back normal**, losing its maximize. The
  alternative is remembering the state and restoring it. Reversible: a
  per-window field.
- **An app key with no window opens the site in a `popup` window**, which
  tileco then tiles and finds as the app's. It never tries
  `chrome.management.launchApp`, which SPEC.md §9.1 leaves unverified for
  web apps. An installed web app's own window is still found and focused.
  The alternative is launching the installed app. Reversible: one function.
- **A page's first title report sets its baseline and marks nothing**, so
  opening, reloading or switching accounts in Gmail with old unread mail
  doesn't mark it; only a rise tileco sees marks. The alternative marks any
  nonzero first count.
  Reversible: one line in `Tileco.title`.
- **Gmail, Chat and Calendar are always watched**, in the manifest's
  `content_scripts`; the options page adds other sites, each with its own
  host permission asked for on that Chromebook, and the same title watcher
  registered at runtime. Settings sync but grants don't, so a site added on
  one Chromebook shows "needs access here" on the next. Only https sites.
  The alternative is making the built-in three removable. Reversible:
  `src/watchers.js`.
- **Granting all-sites access turns the dim on**, and the switch is under
  Extras in the settings. The dashboard only offers it, with the other
  extras, until you dismiss the offer; its prompt takes focus and closes the
  dashboard, so tileco treats the grant itself as the switch. Turning it off
  undims every page, then gives the access back. Revoking the access at
  `chrome://extensions` instead leaves pages dimmed until they reload, since
  tileco can no longer reach them. The alternative is a separate stored
  setting. Reversible: `Tileco.dimOn` and the settings' Extras list.
- **The clock detail opens on a click** of the dashboard's clocks, and is
  always open on the home page, where there's room. Day is 07–19 and work is
  09–17 in every zone, and the DST note looks three weeks ahead. Zone
  abbreviations come from a small built-in table of common zones, since
  Chrome names London "GMT+1"; others show Chrome's form. The alternatives
  are an always-open detail and settings for the hours. Reversible:
  `src/launcherview.js` and `src/clocks.js`.
- **The launcher's ranking**: a home-grown fuzzy match (letters in order,
  word starts and runs score higher), ties broken by `tab.lastAccessed`, and
  a query with no match in its scope searching both. Tabs only, not windows
  as such, since every window's tabs are listed. The alternative is a
  library such as fzf's algorithm. Reversible: `src/launcher.js`.
- **The dashboard opens full screen every time**, not as Chrome's toolbar
  popup. If chromeOS shows its full-screen bubble on each open, a large
  centered window is the fallback. Reversible: `Tileco.dashboard`.
- **Always-on-top windows aren't tracked at all**: Document
  picture-in-picture and always-on-top popups stay put on every workspace,
  since chromeOS refuses to minimize them. The alternative is tracking them
  as floating windows that stay on one workspace, which can't hide them.
  Reversible: `managed()` in `src/tileco.js`.
- **Secure Shell's popup windows tile**, by its extension ID in a built-in
  list, until the options page has tile and float rules (SPEC.md §5.4).
  Reversible: `TILED_POPUP_ORIGINS`.
- **A restart is when every stored window ID is gone**, and windows match
  by shared tab URLs, closest fit first (SPEC.md §14.2). A session with
  one window whose tabs all changed comes back unmatched, on the showing
  workspace. The alternative is `runtime.onStartup` as the signal, which
  can arrive after the first window event. Reversible: `Tileco.restarted`
  and `src/restart.js`.
- **The wait for restored windows ends at your first command**, not after
  a time. A window that never returns is forgotten then; one opened before
  you press a key, with a matching tab, takes the old window's place. The
  alternative is a timeout. To decide after trying it on a device.
  Reversible: `Tileco.command`.
- **Two restart edge cases are deferred, not fixed** (Codex on PR 14): a
  restored window that closes before the rest return drops the placements
  still waiting, and a window first seen on a placeholder page such as
  `about:blank` is never matched again. Eight findings came from matching
  incrementally; the alternative is rematching every window against a saved
  snapshot on each sync until the first command, which deletes the class.
  To decide after trying restarts on a device. Reversible: `Tileco.restarted`.

- **A restart with no window yet is told from closing them all by
  `chrome.storage.session`** (2026-10-31): a flag set at the first window
  each browser session; a browser restart empties it. Reloading or updating
  tileco empties it too, so a reload with no Chrome window open keeps the
  old places waiting until your first command. The alternative is
  `runtime.onStartup`, which can arrive after the first window event.
  Reversible: `SEEN_KEY` in `src/tileco.js`.

- **Off chromeOS, the dashboard and launcher stay; tiling goes**
  (2026-11-01, per the maintainer): every command that lays out, focuses
  or moves a window, or switches workspaces, does nothing, and the bar
  shows no workspaces. Sub-choices, each reversible in `src/platform.js`'s
  `worksUntiled` or the pages:
  - Keep awake and the app keys work there too: they place nothing. The
    alternative is chromeOS only, which tide and tilemo don't need.
  - The dim, unread counts and start at login are chromeOS only: they mark,
    shade or open windows on tileco's workspaces. Their settings hide.
  - The suggested keys stay bound off chromeOS (`Alt+Shift+J/K/U/Space`).
    Chrome refuses a suggested key with no `default` there, and dropping
    them would unbind them on chromeOS too. `Alt+Shift+Space` (the
    dashboard) doesn't overlap tide's `Super+Space`. The tiling ones do
    nothing, so unbind them at `chrome://extensions/shortcuts` if a page
    needs the keys.
  - The toolbar button opens the dashboard everywhere, and its tooltip off
    chromeOS says tiling and workspaces work only on chromeOS.
- **The Linux tab list is one Allow for `tabs` and `nativeMessaging`
  together** (2026-11-01), rather than reusing tab search's `tabs` grant:
  one switch with one meaning. Reversible: `ACCESS` in `src/tabsbridge.js`.
- **The whole tab list goes on every change**, gathered over 100 ms, rather
  than diffs: a few KB per change, and nothing to get out of step after a
  reconnect. Reversible: the protocol, with tide's `tide-tabs`.
- **No incognito windows in tide's list**, even where you've allowed tileco
  in incognito. Reversible: the filter in `tabsMessage`.
- **Waiting: a `key` in the manifest** (needs the maintainer). Without it an
  unpacked copy's ID comes from its folder's path, so `setup` allows both
  that ID and the store's. The store item's public key (dashboard ›
  Package › View public key) in `manifest.json`'s `key` would make every
  copy `ajcfbfgjfglgofbepnkiimmmnaidfedl`; `make zip` would then have to
  drop it, since the store has refused packages with one (from memory,
  unchecked).

## Later

- **Set the PRO 2 LIGHTSPEED's DPI from Linux** (SPEC.md §19.2, fix 1).
  The mouse keeps its DPI in onboard profile memory, so a setting written
  there carries to the Chromebook. Solaar 1.1.20 refuses it: "no onboard
  profiles that Solaar supports". Findings from the mouse (2026-10-25):
  - It has `ONBOARD PROFILES {8100}`. Its description is
    `01 07 01 05 01 08 10 00ff 0a`: writable flash (`01`), but profile
    **format 7**, and Solaar's `OnboardProfiles.from_device` accepts 1–5
    only. Five profile slots, 8 buttons, 255-byte profiles.
  - No user profiles yet: the flash header (`hdr0`) is all `ff`, and it
    runs its ROM profile at sector `0x0101`.
  - With the format check relaxed, `bin/solaar profiles` reads it but
    misplaces the fields. Format 7's DPI table starts at byte 4 as five
    steps of X u16, Y u16 and one more byte, probably lift-off distance:
    400, 800 (current), 1600, 3200, 6400. Formats ≤5 have five plain u16s.
    The button table also sits about 16 bytes later.

  Plan, a Solaar PR (pwr-Solaar/Solaar):
  1. Map the whole format-7 profile: dump the ROM profile's raw sector,
     and check each field against what G HUB or the mouse shows (report
     rate, DPI steps, buttons, lighting, name, checksum).
  2. Add a format-7 decoder and encoder beside the existing one in
     `lib/logitech_receiver/hidpp20.py`, with a unit test from the dump.
  3. Test on the mouse: copy the ROM profile into a flash sector, change
     one DPI step to 1600, write it, power-cycle, read back, then check
     the Chromebook. The CRC protects against a bad write; the mouse falls
     back to ROM.
  4. Ask before opening the PR upstream; it posts under your account.

  Until then: a DPI button under the mouse, if it has one, steps through
  the profile's 400–6400; or G HUB once on Windows or a Mac.

- Frame offsets (SPEC.md §5.3): tiles use the bounds as given; measuring
  and correcting each window type's frame waits for a device.
- Profile keys (SPEC.md §9.2).
- Check the setup checklist's `chrome://os-settings` addresses on a
  Chromebook: desktop Chromium has no such pages, so they're unverified.
- Upload each release to the Chrome Web Store from the `release` workflow,
  through the Chrome Web Store API: it needs the listing created by hand
  first, and an OAuth client ID, secret and refresh token as repository
  secrets.
