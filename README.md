# tileco

Tiling on chromeOS: a Manifest V3 extension that brings the dwm/Krohnkite
tiling of [tide](https://github.com/mikelward/tide) to Chrome and installed
web app windows on a Chromebook. It adds nine workspaces, tide's key map on
the Search key, an optional dim on inactive windows, and world clocks. A
setup checklist sets the native chromeOS features (lock, launcher,
notifications, screenshots, dark mode) to match.

On the Chromebook it calls itself **tide**, with tide's wave logo, in
`chrome://extensions`, the toolbar and its own pages; tileco is the name of
this repository and its code.

**Status: milestone 1, the spec.** Start with [SPEC.md](SPEC.md). It
explains what chromeOS lets an extension do, and what it doesn't: Android
and Linux windows, global keys and a top bar are out of reach.

It isn't on the Chrome Web Store yet. Once it's published, it will be at
<https://chromewebstore.google.com/detail/ajcfbfgjfglgofbepnkiimmmnaidfedl>.
Until then, load it unpacked, as [PUBLISHING.md](PUBLISHING.md) §2 says.

Thanks to [chrometile](https://github.com/brockgr/chrometile), which showed
the way.
