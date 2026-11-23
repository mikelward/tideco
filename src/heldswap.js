// Swap with the master, held (§6.1): the first press of the key only notes
// the focused window; each further press while it's held moves focus to the
// next tiled window on the workspace, in layout order, round from the end;
// and the choice is made when the key stops coming. Chrome can't hear a
// modifier come up, so a half-second pause after the last press makes it,
// as tide for Linux's Alt coming up does (tide's SPEC §6.6).
//
// Pure: the caller supplies where focus is and the stack's order, does the
// focusing and the swap, and runs the timer.

export const PAUSE = 500;

// A press of the key. `cycle` is the one under way, or null; `here` is
// {win, ws, display, order}: the focused tiled window, its workspace and
// display, and that part's tiled windows in layout order, the master first.
// Returns {cycle, focus}: the cycle now, and the window to focus, or null.
// The cycle's `at` is where it left focus.
export function press(cycle, here) {
  if (!cycle || !sameCycle(cycle, here)) {
    return { cycle: { start: here.win, at: here.win, ws: here.ws, display: here.display, stepped: false }, focus: null };
  }
  const i = here.order.indexOf(here.win);
  const target = i < 0 ? here.order[0] : here.order[(i + 1) % here.order.length];
  if (target === undefined || target === here.win) return { cycle: { ...cycle, at: here.win }, focus: null };
  return { cycle: { ...cycle, at: target, stepped: true }, focus: target };
}

// What the pause does, with focus `here` as it is then: "swap" with the
// master, or "none". A tap is the swap; after a step, the window focus
// stopped on becomes the master unless it is already. `here.win` is the
// window with real focus, not a command's stand-in for it. Focus anywhere
// but where the cycle left it (outside Chrome, on a window tide doesn't
// manage or tile, or moved some other way) moves nothing: that window
// wasn't chosen with this key.
export function commit(cycle, here) {
  if (!cycle || !here || here.win === null || !sameCycle(cycle, here)) return "none";
  if (here.win !== cycle.at) return "none";
  if (!here.order.includes(here.win)) return "none";
  if (cycle.stepped && here.order[0] === here.win) return "none";
  return "swap";
}

function sameCycle(cycle, here) {
  return here.win !== null && cycle.ws === here.ws && cycle.display === here.display;
}
