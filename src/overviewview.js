// The overview page (SPEC.md §6.5): every workspace's windows as cards,
// grouped by workspace, full screen over the display you're on. A click on
// a card, or the arrows and Enter, goes to that window, and a click on a
// group's header shows that workspace; typing filters. Esc, its key again,
// a click on empty space or on another window closes it.

import { cardsOf, filtered, focusedIn, groups, keep, notes, step } from "./overview.js";
import { ACCESS, pictureKey, picturesIn } from "./pictures.js";
import { SECTION_KEY } from "./launcher.js";
import { load as loadSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);

let all = [];
let query = "";
// The window whose card Enter goes to, and the cards showing, in order.
let selected = null;
let cards = [];
let started = false;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Once tide has done what was asked, the overview closes.
async function send(message) {
  try {
    if (!(await chrome.runtime.sendMessage(message))) console.warn("tide: the overview's ask wasn't done:", message);
  } catch (e) {
    console.error("tide: couldn't reach tide from the overview:", e);
  }
  window.close();
}

// A click on a card or a header is that choice, not a click on empty space,
// which closes the overview.
function choose(e, message) {
  e.stopPropagation();
  send(message);
}

function img(className, src) {
  const i = el("img", className);
  i.src = src;
  i.alt = "";
  return i;
}

function cardElement(c) {
  const b = el("button", "card");
  b.type = "button";
  b.title = c.title;
  b.classList.toggle("minimized", c.minimized);
  const shot = el("span", "shot");
  if (c.picture) shot.append(img("picture", c.picture));
  else if (c.icon) shot.append(img("big", c.icon));
  const line = el("span", "line");
  line.append(c.icon ? img("icon", c.icon) : el("span", "icon blank"));
  const text = el("span", "text");
  text.append(el("span", "name", c.title), el("span", "app", c.detail));
  line.append(text);
  b.append(shot, line);
  b.addEventListener("click", (e) => choose(e, { activate: c.id }));
  return b;
}

function render() {
  const main = $("groups");
  main.replaceChildren();
  const shown = filtered(all, query);
  cards = cardsOf(shown).map((c) => ({ id: c.id, c }));
  for (const g of shown) {
    const section = el("section", "group");
    section.classList.toggle("current", g.current);
    const head = el("button", "header", g.name);
    head.type = "button";
    head.addEventListener("click", (e) => choose(e, { workspace: g.name }));
    section.append(head);
    if (g.cards.length === 0) section.append(el("p", "note", "No windows on this workspace"));
    const grid = el("div", "cards");
    for (const c of g.cards) {
      const b = cardElement(c);
      cards.find((x) => x.id === c.id).el = b;
      grid.append(b);
    }
    section.append(grid);
    main.append(section);
  }
  if (cards.length === 0 && query !== "") main.append(el("p", "note", "No windows match"));
  selected = keep(cards, selected);
  mark();
  $("filter").textContent = query;
}

function mark() {
  for (const c of cards) {
    c.el.classList.toggle("selected", c.id === selected);
    if (c.id === selected) c.el.scrollIntoView({ block: "nearest" });
  }
}

// What it can't show, each a link to Extras in the settings, where its
// access is allowed.
function renderNotes(list) {
  $("notes").replaceChildren(
    ...list.map((text) => {
      const b = el("button", "", text);
      b.type = "button";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        openExtras();
      });
      return b;
    }),
  );
}

async function openExtras() {
  try {
    await chrome.storage.session.set({ [SECTION_KEY]: "extras" });
    await chrome.runtime.openOptionsPage();
  } catch (e) {
    console.error("tide: couldn't open the settings at Extras:", e);
  }
  window.close();
}

async function refresh() {
  const [stored, session, windows, { settings }, tabs, pictures] = await Promise.all([
    chrome.storage.local.get("state"),
    chrome.storage.session.get(null),
    chrome.windows.getAll({ populate: true }),
    loadSettings(chrome.storage),
    chrome.permissions.contains({ permissions: ["tabs"] }),
    chrome.permissions.contains(ACCESS),
  ]);
  const state = stored.state ?? null;
  all = groups({ state, windows, apps: settings.apps, pictures: picturesIn(session) });
  // It starts on the window you were in; a later update keeps your place.
  if (!started) {
    started = true;
    selected = focusedIn(state);
  }
  renderNotes(notes({ tabs, pictures }));
  render();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    window.close();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (selected !== null) send({ activate: selected });
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    selected = step(cards, selected, -1);
    mark();
  } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    selected = step(cards, selected, 1);
    mark();
  } else if (e.key === "Backspace") {
    e.preventDefault();
    query = Array.from(query).slice(0, -1).join("");
    render();
  } else if (Array.from(e.key).length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    query += e.key;
    render();
  }
});

// A click that no card, header or note took landed on empty space.
document.addEventListener("click", () => window.close());
// A glance, as the dashboard is: clicking another window closes it.
window.addEventListener("blur", () => window.close());

chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "local" && changes.state) || (area === "session" && Object.keys(changes).some((k) => k.startsWith(pictureKey(""))))) {
    refresh().catch((e) => console.error("tide: couldn't update the overview:", e));
  }
});

refresh().catch((e) => console.error("tide: couldn't show the overview:", e));
