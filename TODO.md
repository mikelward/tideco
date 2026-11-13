# TODO

## Named workspaces (SPEC.md §6.1)

Replace the nine numbered workspaces with tide for Linux's named ones, a PR each:

- [x] The model: names in storage, standing ones and home, empty ones
  removed once left, bar order; migrate a stored numbered state by naming
  workspace 1 home and the others by their numbers' order after the
  standing ones *(a guess)*. `src/workspaces.js`, with tests.
- [x] Keys: `Search+1…9` and `Search+Shift+1…9` as the Nth in bar order,
  `Search+Home` and `Search+End`, in `manifest.json` and `src/tide.js`.
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

## Check workspaces spanning displays on a Chromebook

One workspace now shows on every display (SPEC.md §6.1), tested only
against the fake Chrome. On a Chromebook with two displays, check that a
switch, a minimize or restore per window on every display, shows no
visible flicker; that unplugging a display hands its windows to the first
left, and plugging it back returns them; and that a window chromeOS moves
with the unplug isn't read as a drag.

## The overview of every workspace (SPEC.md §6.5)

The MVP is built, as tide for macOS's (its SPEC.md §6.9), tested with
FakeChrome and the smoke test.

- [x] The page (`src/overview.html`), its cards (`src/overview.js`) and the
      `overview` command, which the dashboard finds too.
- [x] Pictures of windows, taken while they show (`src/pictures.js`), with
      all-sites access; icons otherwise, and the page says why.
- [ ] Its key. tide for Linux and macOS put it on `Super+W` for now, but
      here `Search+W` is the name prompt (§6.1), so it has none: bind one
      at `chrome://extensions/shortcuts`. Not settled; see *Decisions
      needing review*.
- [ ] Try it on a Chromebook: the captures, their timing and look (§6.5's
      unchecked list).
- [ ] This workspace's windows alone, as tide for macOS's Ctrl+Down does.
- [ ] Pictures as their own extra, if sharing the dim's access is wrong.

## Decisions needing review

Guesses made on autopilot (2026-10-24), each cheap to undo.

- **The dim defaults to 12%, as tide for Linux's** (2026-11-13), up from
  10%. A strength you set yourself stays. Reversible: `dimStrength` in
  `src/settings.js`.
- **The settings page's sidebar names and groups Chrome's own pages**
  (2026-11-08). tide for Linux's names where the page is the same: Keys
  is Keyboard, Dim is Appearance, Unread counts is Notifications, and the
  "on this Chromebook" titles lose it. Chrome's own: Apps under Windows,
  as the app keys open windows; Extras, Tabs in tide's switcher (Linux
  only), Setup checklist and Import and export at the end of General, as
  tide for macOS puts its Setup checklist. The layout each workspace
  starts in and each layout's main windows moved from Workspaces to
  Layouts, as on tide for Linux, above this Chromebook's ultrawide and
  widths. Their icons are tide for macOS's nearest: Apps "open", Extras
  "more", Tabs in tide's switcher "floating", Import and export "folder".
  What holds for every page ("Changes apply as you make them", and off
  chromeOS what doesn't work there) sits at the sidebar's foot; errors
  sit over the page showing. The logo, keep awake and a fresh visit open
  the first page. Reversible: `SETTINGS_SECTIONS` in `src/launcher.js`,
  `src/options.html`.
- **The settings search uses Launch's words for each page**
  (2026-11-08): the options page's search finds a page by
  `SETTINGS_SECTIONS`'s name and `covers`, so the page and Launch find
  the same pages, rather than a second keyword table. "world clocks"
  joined Clocks' words. Esc in an empty field closes the settings tab
  with `window.close()`, which Chrome allows an extension page whatever
  the tab's history (tried in Chromium's smoke test). Reversible:
  `src/optionssearch.js`, the search in `src/optionsview.js`.
- **Start from is a guide, kept per Chromebook** (2026-11-08): Chrome lets
  no extension set its keys, so a preset changes only the keys the
  checklist suggests, in `storage.local` beside the setup ticks.
  `home_or_back` (dwm's Super+Tab) is dropped, as no command here toggles
  home and back; attention keeps Search+Tab. Of a binding's keys the first
  Chrome can bind is used, so i3's focus up and dwm's and xmonad's grow
  are Search+L, which chromeOS's lock holds until it's removed in the
  Shortcuts app; the checklist doesn't say so. Under a preset the summary
  also counts commands on keys other than its, though they still count as
  done. Reversible: `COMMANDS` and `suggestions` in `src/presets.js`,
  `renderKeys` in `src/optionsview.js`.
- **A pinned app's closed window reopens after a second, at most 3
  times a minute** (2026-11-04), at the end of its workspace's stack, and
  not while that workspace still has a window of the app. The delay lets
  a browser closing end the worker first. Reversible: `REOPEN_DELAY`,
  `REOPEN_LIMIT` and `reopen` in `src/tide.js`.
- **A window keeps one place in its workspace's single stack across
  displays** (2026-11-02): a part's order is the stack's order filtered by
  display, so a window handed to the first display and back keeps its
  place, where tide for macOS moves it to the end of the other display's stack
  and back to its old index. Reversible: `setDisplays` in
  `src/workspaces.js`.
- **A switch focuses the window you were last in on your display** when
  the workspace's remembered window is on another (2026-11-02), so focus
  never jumps displays. Reversible: `showWorkspace` in `src/tide.js`.

- **Launch's empty query lists only the apps; the commands moved to
  Actions** (2026-11-01), so Launch reads as a start menu. A query in
  Launch still finds commands and actions. The alternative is Launch
  listing commands after the apps, as before. Reversible: `EMPTY` in
  `src/launcher.js`.
- **The settings app is "Tide Settings", in the user's words**
  (2026-11-01), though the options page calls itself "tide for Linux settings".
  Its sections are listed by the page's headings, shortened ("Layouts",
  "Mouse", "Start at login"). Reversible: `SETTINGS_APP` and
  `SETTINGS_SECTIONS` in `src/launcher.js`.
- **Actions turns the dim off by pausing it, keeping Chrome's access**
  (2026-11-01), so turning it back on needs no prompt; the options
  page's "Turn off" still gives the access back. Reversible:
  `toggleDim` in `src/launcherview.js`.
- **Named workspaces' keys are `Search+W` and `Search+Shift+W`**
  (2026-11-01), W for workspace, since Chrome can't bind tide for Linux's
  `Super+Return`; `Search+Home` and `Search+End` are tide for Linux's. The
  alternative is no keys for the prompt, only the dashboard's Workspaces
  scope. Reversible: the commands in `manifest.json`.
- **The name prompt is the dashboard's** (2026-11-01), opened on a
  Workspaces scope, since an extension can't draw over another window.
  Esc on a new window's prompt leaves it on home, where tide for Linux's closes it,
  since Chrome can't ask a page to close politely. Reversible: SPEC.md
  §6.1.
- **A new window's default name is its title's first word** (2026-11-01),
  tide for Linux's short name without `namePatterns`, which tide for Chrome has no setting
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
  tide for Linux can't say. The alternative is no workspace there until you pick
  one. Reversible: `freshName` in `src/workspaces.js`.
- **A name prompt's key while one's open swaps it** (2026-11-01):
  `Search+W` again closes its prompt, as `Search+Space` closes the
  dashboard, and `Search+Shift+W` or `Search+Space` puts its own in place,
  rather than waiting its turn as tide for Linux's prompts do. The alternative is
  tide for Linux's queue. Reversible: `dashboard` in `src/tide.js`.
- **`Search+Shift+W`'s prompt keeps to Workspaces** (2026-11-01): no
  Launch or Tabs chip, and Tab stays, so Enter can only ever move the
  window. The alternative is every scope, Enter moving the window only on
  Workspaces. Reversible: `scopes` in `src/launcherview.js`.
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
  the clocks' labels are; tide for Linux refuses a name with space around it. The
  alternative is tide for Linux's refusal. Reversible: `checkStanding` in
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
  as tide for Linux's `inApps` takes web addresses. Reversible: `checkHomeApps` in
  `src/settings.js` and `homeAppOf` in `src/apps.js`.
- **A home app's key shows home** (2026-11-01): its window joins home, and
  since the key focuses it, home comes with it, where any other new home
  app window joins home hidden and your display stays. The alternative
  is the key opening it hidden too, which a focused window can't be.
  Reversible: `app` in `src/tide.js`.
- **Only new windows ask** (2026-11-01): windows open when tide for Chrome first
  runs, and those a restart brings back, even unmatched, never ask, nor
  any window already on home before this change. The alternative asks
  for every window on home's first focus, which a migrated workspace 1
  would turn into a run of prompts. Reversible: `asks` in `Tide.sync`.
- **A waiting prompt opens where you are** (2026-11-01): once the prompt
  before it closes, the next window's opens over whatever workspace
  you're on, home staying hidden if you left it, the field naming the
  window. The alternative brings home back to show the window first.
  Reversible: `ask` in `src/tide.js`.
- **Any open dashboard holds a new window's prompt** (2026-11-01), not
  only another prompt, as one dashboard shows at a time. In practice the
  new window's focus closes the dashboard, which then lets it ask.
  Reversible: `ask` in `src/tide.js`.
- **Esc on an untouched starting name closes the prompt** (2026-11-01),
  where Esc otherwise clears the field first, since that name isn't
  typing. The alternative is two presses. Reversible: the Esc handler in
  `src/launcherview.js`.
- **The short name is only a website's** (2026-11-01): a tab that isn't
  on `http` or `https`, such as the new tab page's "New Tab", starts the
  field empty, and the title is read once, when the prompt opens, where
  tide for Linux's follows a title that changes. The alternative is following the
  title through `storage.onChanged`. Reversible: `ask` in
  `src/tide.js`.
- **A standing name edited on the options page is a new entry**
  (2026-11-01), not a rename: the old workspace keeps its windows as an
  ordinary one, as a name taken out does, so editing home's name makes a
  new, empty home. tide for Linux's page has no edit, only add and remove. The
  alternative is names you can only add and take out, as tide for Linux's.
  Reversible: `standingRow` in `src/optionsview.js`.
- **An app key with no app can still be one of home's** (2026-11-01): its
  box reads "App 3, off" and can be ticked, since `homeApps` names keys,
  so the app you give it later is home's. The alternative is hiding or
  disabling the box until the key has an app. Reversible:
  `renderHomeApps` in `src/optionsview.js`.

- **Keep awake is `Search+S`** (2026-10-31), as tide for Linux's and tide for macOS's
  `Super+S`, though chromeOS has select to speak there, and whether the
  Shortcuts app can remove it is untried. The alternative is `Search+P`,
  free, which tide for Linux gave presenter mode. Reversible: the command's
  description in `manifest.json`; Chrome binds no key for it either way.
- **`Search+S` shows nothing but the cup and the toolbar tooltip**
  (2026-10-31): tide for Linux's OSD has no equivalent, and a notification would
  cost the `notifications` permission's install warning, which disables an
  installed tide for Chrome until the warning is accepted. The alternative is that
  notification, or flashing the toolbar badge. Reversible: `toggle` in
  `src/keepawake.js`.
- **No presenter mode** (2026-10-31): tide for Linux's `Super+P` is keep awake plus
  Do not disturb, and an extension can't reach chromeOS's Do not disturb.
  The alternative is a presenter command that holds keep awake alone, as
  tide for Linux does without its notification server. Reversible: a command.
- **The bar's logo is tide for Linux's two waves** (2026-10-31), so the bar reads
  the same on tide for Linux, tide for macOS and tide for Chrome. Since 2026-11-01 the extension's
  icon is the same waves. Reversible: the SVG in `src/launcher.html`.
- **The extension calls itself tide for Linux** (2026-11-01): name, toolbar tooltip,
  command descriptions, page titles and text. The icon is the waves in
  white on `#3584e4`, tide for Linux's `accent-bg`, the old icon's blue, at 6.5x
  tide for Linux's 16 px paths with a 1.75 stroke so the 16 px icon stays legible;
  the alternative is tide for Linux's 1.5 stroke. Reversible: `manifest.json`, the
  pages, and `icons/tide.svg` plus `make icons`.
- **File names keep tide for Chrome** (2026-11-01): `icons/tide-*.png`,
  `tide.svg`, `tide.js`, the ZIP's name, so nothing a user stored or
  bound moves. `icons/tide-alt.svg`, the old T's alternative, is left as
  it was, unused. The alternative is renaming the icon files to `tide-*`
  and deleting the alt. Reversible: a rename.
- **Console messages keep their `tide:` prefix** (2026-11-01): they're
  for whoever debugs the worker, not shown on a page. The alternative is
  `tide:`. Reversible: a search and replace.
- **Pages get a tab icon** (2026-11-01), `icons/tide-32.png`, so a
  settings or home tab shows the waves. Reversible: the `<link rel="icon">`
  in each page.
- **"tide for Linux on Linux" where a page means the desktop** (2026-11-01), now
  that the extension is tide for Linux too: the setup checklist's lock item and the
  settings' setup and import text. The alternative is plain "tide for Linux".
  Reversible: `src/setup.js` and `src/options.html`.
- **Start at login is per Chromebook, and websites only** (2026-10-31),
  as tide for Linux's `startup.local.json` is per machine; an extension can't run a
  program. The alternative is a synced list. Reversible: move `startup`
  from `PER_MACHINE` to `SHARED` in `src/settings.js`.
- **Start at login opens on the workspace you're on, and checks nothing
  already open** (2026-10-31): tide for Linux opens home's apps on home, which
  tide for Chrome now does too (2026-11-01), and starts a web address whatever runs, so a site
  Chrome restores itself shows twice. The alternatives are a workspace per
  address, or skipping a site with a tab already open, which needs tab
  access and races Chrome's restore. Reversible: `Tide.startAtLogin`.
- **The bar's middle stays a dead space** (2026-10-31): tide for Chrome's title
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
- **No `AGENTS.md` in tide for Chrome yet.** The sibling repos each have one; tide for Chrome
  follows their shared conventions (tide for Linux's especially) without its own copy.
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
  tide for Chrome then tiles and finds as the app's. It never tries
  `chrome.management.launchApp`, which SPEC.md §9.1 leaves unverified for
  web apps. An installed web app's own window is still found and focused.
  The alternative is launching the installed app. Reversible: one function.
- **A page's first title report sets its baseline and marks nothing**, so
  opening, reloading or switching accounts in Gmail with old unread mail
  doesn't mark it; only a rise tide for Chrome sees marks. The alternative marks any
  nonzero first count.
  Reversible: one line in `Tide.title`.
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
  dashboard, so tide for Chrome treats the grant itself as the switch. Turning it off
  undims every page, then gives the access back. Revoking the access at
  `chrome://extensions` instead leaves pages dimmed until they reload, since
  tide for Chrome can no longer reach them. The alternative is a separate stored
  setting. Reversible: `Tide.dimOn` and the settings' Extras list.
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
  centered window is the fallback. Reversible: `Tide.dashboard`.
- **Always-on-top windows aren't tracked at all**: Document
  picture-in-picture and always-on-top popups stay put on every workspace,
  since chromeOS refuses to minimize them. The alternative is tracking them
  as floating windows that stay on one workspace, which can't hide them.
  Reversible: `managed()` in `src/tide.js`.
- **Secure Shell's popup windows tile**, by its extension ID in a built-in
  list, until the options page has tile rules (SPEC.md §5.4). Float rules
  are done (2026-11-13); tile rules aren't, as tide for Linux has none.
  Reversible: `TILED_POPUP_ORIGINS`.
- **Float rules name a site, and cover app windows alone** (2026-11-13).
  A rule is `{"site": origin}`, the key the app keys and unread counts
  already use, since Chrome shows no window class and an installed app's
  ID needs `management`. It covers installed web apps' windows and the
  app popups tide opens, not tab windows, whose site changes with their
  tabs. No title pattern, as tide for Linux's rules have: one could be
  added as `title` later. Reversible: `ruleable` in `src/floating.js`.
- **A rule decides a window once** (2026-11-13), when tide first knows
  its site, marking it `ruled`, so a window you tile by hand stays tiled;
  a changed list floats the open windows it newly covers, as tide for
  Linux's sweep does. Without tab search no window's site shows, so no
  rule applies; allowing it later floats the covered windows then.
  Reversible: `Tide.ruleFloats`.
- **Float rules are shared** (2026-11-13), in `storage.sync`, as tide for
  Linux's `floating.json` is, with no per-Chromebook list like its
  `floating.local.json`. Reversible: `SHARED` in `src/settings.js`.
- **The float question is a small popup window, not a notification**
  (2026-11-13). `chrome.notifications` would be a new permission with a
  warning, which disables an installed copy until you accept it. The
  window opens without focus in the display's bottom-right corner and
  closes itself after 30 seconds, as Not now. Whether chromeOS honors
  `focused: false` for a popup is unchecked. A site is asked about once
  per browser session (`storage.session`), as tide for Linux asks once
  per login. The alternative is asking in the dashboard, which takes the
  whole screen. Reversible: `Tide.askAlways`, `src/floatask.html`.
- **Always float on Floating now adds the rule at once** (2026-11-13),
  where tide for Linux's fills the fields to trim a title first: a site
  has nothing to trim. Edit rule… in the question fills the field
  instead, for Enter. *Also floating* and *More about this window* aren't
  ported. Reversible: `renderFloatingNow` in `src/optionsview.js`.
- **A restart is when every stored window ID is gone**, and windows match
  by shared tab URLs, closest fit first (SPEC.md §14.2). A session with
  one window whose tabs all changed comes back unmatched, on the showing
  workspace. The alternative is `runtime.onStartup` as the signal, which
  can arrive after the first window event. Reversible: `Tide.restarted`
  and `src/restart.js`.
- **The wait for restored windows ends at your first command**, not after
  a time. A window that never returns is forgotten then; one opened before
  you press a key, with a matching tab, takes the old window's place. The
  alternative is a timeout. To decide after trying it on a device.
  Reversible: `Tide.command`.
- **Two restart edge cases are deferred, not fixed** (Codex on PR 14): a
  restored window that closes before the rest return drops the placements
  still waiting, and a window first seen on a placeholder page such as
  `about:blank` is never matched again. Eight findings came from matching
  incrementally; the alternative is rematching every window against a saved
  snapshot on each sync until the first command, which deletes the class.
  To decide after trying restarts on a device. Reversible: `Tide.restarted`.

- **A restart with no window yet is told from closing them all by
  `chrome.storage.session`** (2026-10-31): a flag set at the first window
  each browser session; a browser restart empties it. Reloading or updating
  tide for Chrome empties it too, so a reload with no Chrome window open keeps the
  old places waiting until your first command. The alternative is
  `runtime.onStartup`, which can arrive after the first window event.
  Reversible: `SEEN_KEY` in `src/tide.js`.

- **Off chromeOS, the dashboard and launcher stay; tiling goes**
  (2026-11-01, per the maintainer): every command that lays out, focuses
  or moves a window, or switches workspaces, does nothing, and the bar
  shows no workspaces. Sub-choices, each reversible in `src/platform.js`'s
  `worksUntiled` or the pages:
  - Keep awake and the app keys work there too: they place nothing. The
    alternative is chromeOS only, which tide for Linux and tide for macOS don't need.
  - The dim, unread counts and start at login are chromeOS only: they mark,
    shade or open windows on tide for Chrome's workspaces. Their settings hide.
  - The suggested keys stay bound off chromeOS (`Alt+Shift+J/K/U/Space`).
    Chrome refuses a suggested key with no `default` there, and dropping
    them would unbind them on chromeOS too. `Alt+Shift+Space` (the
    dashboard) doesn't overlap tide for Linux's `Super+Space`. The tiling ones do
    nothing, so unbind them at `chrome://extensions/shortcuts` if a page
    needs the keys.
  - The toolbar button opens the dashboard everywhere, and its tooltip off
    chromeOS says tiling and workspaces work only on chromeOS.
- **The Linux tab list is one Allow for `tabs` and `nativeMessaging`
  together** (2026-11-01), rather than reusing tab search's `tabs` grant:
  one switch with one meaning. Reversible: `ACCESS` in `src/tabsbridge.js`.
- **The whole tab list goes on every change**, gathered over 100 ms, rather
  than diffs: a few KB per change, and nothing to get out of step after a
  reconnect. Reversible: the protocol, with tide for Linux's `tide-tabs`.
- **No incognito windows in tide for Linux's list**, even where you've allowed tide for Chrome
  in incognito. Reversible: the filter in `tabsMessage`.
- **The overview has no key yet** (2026-11-09). tide for Linux and macOS
  put it on `Super+W` for now, without settling it. Here `Search+W` is
  the name prompt (§6.1), and existing keys don't change yet, so the
  `overview` command suggests none (Chrome allows four suggested keys,
  all taken): you bind one at `chrome://extensions/shortcuts`, or choose
  it in the dashboard, which finds it as "Overview of every workspace's
  windows". The keys checklist lists it as yours to choose. To settle
  across tide for Linux, macOS and Chrome. Reversible: `manifest.json`.
- **The overview's pictures use the dim's all-sites access** (2026-11-09),
  the one access `tabs.captureVisibleTab` takes besides activeTab, which
  lasts only for a tab you clicked tide's button in. So turning the dim
  on allows pictures, and turning it off, which gives the access back,
  stops them. The alternative is a fourth extra for pictures alone, which
  would also turn the dim on, as granting all-sites access does now.
  Reversible: `ACCESS` in `src/pictures.js` and the grant handling in
  `src/background.js`.
- **When pictures are taken** (2026-11-09): the window you were in, just
  before a switch hides it; the window you're in as the overview opens;
  and in the background, every window showing whose picture is over 15
  seconds old, 600 ms apart (Chrome allows two a second), never while a
  page of tide's covers them. A switch never waits for more than one
  capture, and a second switch within 600 ms takes none. Each is shrunk
  to 480 px wide and kept in `storage.session` until its window closes or
  the browser restarts. An unfocused window's picture carries the dim.
  Reversible: `src/pictures.js` and `Tide.apply`.
- **Waiting: a `key` in the manifest** (needs the maintainer). Without it an
  unpacked copy's ID comes from its folder's path, so `setup` allows both
  that ID and the store's. The store item's public key (dashboard ›
  Package › View public key) in `manifest.json`'s `key` would make every
  copy `ajcfbfgjfglgofbepnkiimmmnaidfedl`; `make zip` would then have to
  drop it, since the store has refused packages with one (from memory,
  unchecked).

## Later

- **Choose the bar's items on the Bar page** (SPEC.md §8.1, §13). The
  Bar page has only Position (top or bottom). Next: which items the
  dashboard's bar shows (keep awake, the layout symbol, the title, say)
  and their order, as tide for Linux's Bar page is to choose its status
  icons (its TODO.md), in the same settings key so one file serves both.

- **Attention from notifications, not unread counts** (SPEC.md §10.3).
  tide for Linux and tide for macOS stopped marking windows whose title's unread count
  rises: Gmail's "(3) Inbox" goes up with every message, so it marked all
  day. They mark a window when it notifies, rings the bell or activates
  itself. tide for Chrome still marks only on a rising count. Parked: nobody is
  using tide for Chrome for now. What to try:
  - **A script in the page** on the sites already allowed for Unread
    counts, injected at `document_start` in the `MAIN` world, wrapping
    `window.Notification` and `ServiceWorkerRegistration.prototype.showNotification`.
    It tells the isolated content script, which tells tide for Chrome, which marks
    that tab's window as a rising count does now: amber badge, bar mark,
    `drawAttention`. Nothing from the notification's text leaves the page.
  - **Check on a Chromebook first:** how often Gmail and Chat notify from
    a push their service worker handles without the page calling either.
    A content script can't reach a service worker, so those would mark
    nothing. If that's most of them, this isn't worth it.
  - **Then** drop the title counts, or keep them only for a site whose
    page never notifies itself. Rename the Unread counts setting to say
    what it does then.
  - **Fallback:** keep title counts but drop Gmail from `DEFAULT_SITES`,
    since Chat's and Calendar's counts move less.
  - **No bell:** Linux (Crostini) windows, kitty's among them, are
    invisible to the extension, and Secure Shell's bell only shows its own
    notification, which tide for Chrome can't see.

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
