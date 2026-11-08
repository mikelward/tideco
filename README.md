# tideco

tide for Chrome: tiling on chromeOS, as a Manifest V3 extension that brings the dwm/Krohnkite
tiling of [tide for Linux](https://github.com/mikelward/tide) to Chrome and installed
web app windows on a Chromebook. It adds tide for Linux's named workspaces and key map
on the Search key (or dwm, i3, sway, xmonad or bspwm's, as a guide), an optional dim on inactive windows, and world clocks. A
setup checklist sets the native chromeOS features (lock, launcher,
notifications, screenshots, dark mode) to match.

It tiles only on chromeOS. In Chrome or Brave elsewhere it keeps its
dashboard and launcher but moves no window, and on Linux it lists the
browser's tabs in tide for Linux's switcher ([SPEC.md](SPEC.md) §14.6).

It's called **tide**, with tide's wave logo, in `chrome://extensions`, the
toolbar and its own pages; tideco is the name of this repository.

**Status: milestone 1, the spec.** Start with [SPEC.md](SPEC.md). It
explains what chromeOS lets an extension do, and what it doesn't: Android
and Linux windows, global keys and a top bar are out of reach.

It isn't on the Chrome Web Store yet. Once it's published, it will be at
<https://chromewebstore.google.com/detail/ajcfbfgjfglgofbepnkiimmmnaidfedl>.
Until then, load it unpacked, as [PUBLISHING.md](PUBLISHING.md) §2 says.

Thanks to [chrometile](https://github.com/brockgr/chrometile), which showed
the way.
