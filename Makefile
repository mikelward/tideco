# Every test file runs from here. `make test` fails if a *_test.js under
# src/ isn't listed, since an unlisted test never runs.
TESTS = \
	src/apps_test.js \
	src/calendar_test.js \
	src/clocks_test.js \
	src/dim_test.js \
	src/extras_test.js \
	src/geometry_test.js \
	src/keys_test.js \
	src/launcher_test.js \
	src/mouse_test.js \
	src/optionspages_test.js \
	src/optionssearch_test.js \
	src/restart_test.js \
	src/settings_test.js \
	src/settingssearch_test.js \
	src/setup_test.js \
	src/tabsbridge_test.js \
	src/untiled_test.js \
	src/unread_test.js \
	src/watchers_test.js \
	src/workspaces_test.js \
	src/tide_test.js \
	src/manifest_test.js \
	src/package_test.js

.PHONY: test lint smoke icons promo zip
test:
	@unlisted=$$(find src -name '*_test.js' | sort | while read -r f; do \
		case " $(TESTS) " in *" $$f "*) ;; *) echo "$$f";; esac; done); \
	if test -n "$$unlisted"; then echo "not in the Makefile's TESTS: $$unlisted" >&2; exit 1; fi
	node --test $(TESTS)

# Every script parses, including the pages' own, which no test imports.
lint:
	@for f in src/*.js test/*.js scripts/*.js; do node --check "$$f" || exit 1; done

# Needs `npm ci` and Playwright's Chromium (`npx playwright install chromium`).
smoke:
	node --test test/smoke.js

# The PNG icons from icons/tide.svg; needs what `make smoke` needs.
icons:
	node scripts/render-icons.js

# The store's promo tiles from store/promo-*.svg; needs what `make icons`
# needs, and Google Fonts for Inter. They stay out of the ZIP.
promo:
	node scripts/render-promo.js

# The Chrome Web Store upload: manifest.json at the top, and nothing only
# development needs. DIST picks where it goes. Its version is the number of
# commits, so each commit on main is a higher version than the last, as the
# store requires. Recursive (=), so only these targets ask git.
DIST ?= dist
VERSION = $(shell git rev-list --count HEAD)
STAGE = $(DIST)/stage

.PHONY: version
version: unshallow-check
	@echo $(VERSION)

# A shallow clone counts only the commits it has, which would make a lower
# version than one already published.
.PHONY: unshallow-check
unshallow-check:
	@if test "$$(git rev-parse --is-shallow-repository)" != false; then \
		echo "the history is shallow, so the commit count is wrong; run git fetch --unshallow" >&2; exit 1; fi

zip: unshallow-check
	rm -rf $(STAGE) $(DIST)/tide-$(VERSION).zip
	mkdir -p $(STAGE)/icons
	cp -R manifest.json src $(STAGE)/
	cp icons/*.png $(STAGE)/icons/
	rm -f $(STAGE)/src/*_test.js $(STAGE)/src/fake_chrome.js
	node -e 'const fs = require("fs"); const f = process.argv[1]; const m = JSON.parse(fs.readFileSync(f)); m.version = process.argv[2]; fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");' $(STAGE)/manifest.json $(VERSION)
	cd $(STAGE) && zip -qrX ../tide-$(VERSION).zip .
	rm -rf $(STAGE)
	@echo $(DIST)/tide-$(VERSION).zip
