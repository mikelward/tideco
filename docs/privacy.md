# tide for Chrome privacy policy

Effective 1 November 2026.

tide for Chrome tiles and arranges your Chrome and web app
windows on chromeOS. This policy says what it reads, what it keeps, and
where that goes.

**In short:** tide for Chrome has no server, no analytics and no ads. It sends nothing
to its developer or to anyone else. What it keeps stays in Chrome's own
extension storage, on your Chromebook. The one exception is your settings,
which Chrome Sync copies to your Google account if you have Sync turned on.

## What tide for Chrome reads

- **Your windows**, through Chrome's `windows` API: each window's
  position, size and state, to tile your windows and put them on
  workspaces.
- **Your tabs, only if you allow tab search** in tide for Chrome's settings: each
  tab's title, address and site icon, through Chrome's `tabs` permission.
  tide for Chrome uses them to find tabs in its launcher, put windows back where they
  were after Chrome restarts, and recognize Secure Shell's windows.
- **Your displays' sizes**, to lay out windows on each one.
- **Page titles on sites you allow for unread counts**: Gmail, Google
  Chat and Google Calendar to start with, and any others you add, each
  only once you allow it in tide for Chrome's settings. On those sites a small script
  reports the page title whenever it changes.
  tide for Chrome reads only the unread count in the title, such as the 3 in
  "Inbox (3)", to mark a window that needs your attention. It doesn't read
  the page's content.
- **Nothing else from the pages you visit.** If you turn on "Dim inactive
  windows", tide for Chrome asks for access to all sites. It uses that access only to place
  a translucent overlay over windows you're not using, and it reads nothing
  from those pages.

- **On Linux, your tabs, only if you allow "Tabs in tide's switcher"** in
  its settings: each normal window's tabs, with their titles and addresses,
  and which is active. tide for Chrome hands them to tide for Linux through
  its `tide-tabs` helper on the same computer, so tide for Linux's switcher can list
  them. They go nowhere else, and tide for Chrome keeps none of them. Incognito
  windows and site icons are left out. On Linux tide for Chrome doesn't tile, and
  reads nothing else.

## What tide for Chrome keeps, and where

- **On your Chromebook**, in `chrome.storage.local`:
  - which windows are on which workspace, and their layouts;
  - with tab search allowed, the addresses of up to 20 tabs per window, so
    windows can return to their workspaces after a restart;
  - the latest unread count for each tab on a site you allowed;
  - this Chromebook's layout and mouse settings, the setup checklist's
    ticks, and the mouse's input device number from its mouse page.

  This data never leaves the Chromebook. Removing tide for Chrome deletes it.
- **In your Chrome settings**, in `chrome.storage.sync`:
  - your clocks and working hours;
  - the names and addresses of the sites on tide for Chrome's app keys;
  - the sites in your unread counts list;
  - your workspace layout settings and how dark inactive windows are
    dimmed.

  If Chrome Sync is on, Chrome copies these to your Google account and your
  other signed-in browsers, as it does for any extension's synced settings.
  That is Chrome's service, covered by
  [Google's privacy policy](https://policies.google.com/privacy). tide for Chrome has
  no access to your account beyond these settings. Removing tide for Chrome, or
  resetting its settings on its options page, deletes them.

## What tide for Chrome sends

Nothing over the network. tide for Chrome makes no network requests of its own. On
Linux, with tide for Linux's tab list allowed, the tabs go to tide for Linux's helper on the
same computer, through Chrome's native messaging, and no further. Showing a tab's site
icon in the launcher loads that icon the way Chrome's own tab strip does.

## Permissions

tide for Chrome asks for the first three when you install it. Chrome shows no warning
for them. It asks for the rest only when you click Allow in its settings,
and you can turn each off there again.

| Permission | Why |
| --- | --- |
| `system.display` | Each display's size, to lay out windows |
| `storage` | Keeping the state and settings above |
| `scripting` | The unread-count script on sites you allow, and the shade over inactive windows |
| `tabs` (optional) | Tab titles and addresses, for tab search, restarts and Secure Shell's windows |
| Each site in your unread counts list (optional) | Its unread count, from the page title |
| All sites (optional) | Only for dimming inactive windows |
| `nativeMessaging` (optional, Linux only) | Handing your tabs to tide for Linux's switcher, on the same computer |

## Changes and contact

Changes to this policy are made in this file, and its history is public in
[tideco's repository](https://github.com/mikelward/tideco/commits/main/docs/privacy.md).
Questions go to [tideco's issues](https://github.com/mikelward/tideco/issues).
