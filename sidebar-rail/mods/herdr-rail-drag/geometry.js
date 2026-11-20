// Where the active tab's panes sit and which drop zone the pointer is in.
// Pure functions over plain layout JSON: no gpui/herdr imports, so Node can
// import and check this file on its own.

// The bar the tabs mod draws: its chips are 29 px tall, 3 px apart.
export const CHIP_H = 29;
export const CHIP_GAP = 3;
const CHIP_FALLBACK_W = 120;
const BAR_LEAD = 10;

function num(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

// `padding`: px on all sides, or [vertical, horizontal] as layouts spell it.
function padding(node) {
  const p = node?.padding;
  if (typeof p === "number") return { top: p, right: p, bottom: p, left: p };
  if (Array.isArray(p)) {
    const vertical = num(p[0]);
    const horizontal = num(p[1], vertical);
    return { top: vertical, right: horizontal, bottom: vertical, left: horizontal };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function visible(node) {
  return Boolean(node) && !node.hidden;
}

function kids(node) {
  return (node?.children ?? []).filter(visible);
}

// A child's share: `size.px` first, else `size.weight`, else a plain weight of 1.
function sizeOf(child) {
  const s = child?.size;
  const px = s && Number.isFinite(s.px) ? Math.max(0, s.px) : null;
  if (px !== null) return { px, weight: 1 };
  const weight = s && Number.isFinite(s.weight) ? Math.max(0, s.weight) : 1;
  return { px: null, weight };
}

function box(x, y, w, h) {
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.max(0, Math.round(w)),
    h: Math.max(0, Math.round(h)),
  };
}

function clampChild(size, kid, limit) {
  let out = Math.max(0, size);
  if (Number.isFinite(kid?.min)) out = Math.max(out, kid.min);
  if (Number.isFinite(kid?.max)) out = Math.min(out, kid.max);
  return Math.min(Math.max(0, out), Math.max(0, limit));
}

// The block the walk is looking for: the one the tabs mod draws.
const isTabBar = (node) => node.content?.mod === "herdr-rail-tabs";

// One step of the walk: returns the rect of the first block `match` accepts, or null.
function place(node, rect, match = isTabBar) {
  if (!visible(node)) return null;
  const pad = padding(node);
  const inner = {
    x: rect.x + pad.left,
    y: rect.y + pad.top,
    w: Math.max(0, rect.w - pad.left - pad.right),
    h: Math.max(0, rect.h - pad.top - pad.bottom),
  };

  if (node.type === "block") {
    return match(node) ? inner : null;
  }

  if (node.type === "stack") {
    const list = kids(node);
    if (!list.length) return null;
    // A stack header draws tabs above the child; it is a bar, not part of the tree.
    const child = list.find((k) => k.id === node.active) ?? list[0];
    return place(child, inner, match);
  }

  if (node.type === "row" || node.type === "column") {
    const list = kids(node);
    if (!list.length) return null;
    const horizontal = node.type === "row";
    // `divider` belongs to this row/column only, as layouts document it.
    const gap = Math.max(0, num(node.gap) + num(node.divider?.width));
    const total = horizontal ? inner.w : inner.h;
    const room = Math.max(0, total - gap * (list.length - 1));
    const items = list.map((kid) => ({ kid, size: sizeOf(kid) }));
    let fixed = 0;
    let weights = 0;
    for (const item of items) {
      if (item.size.px !== null) fixed += item.size.px;
      else weights += item.size.weight;
    }
    const rest = Math.max(0, room - fixed);
    let cursor = horizontal ? inner.x : inner.y;
    const end = cursor + total;
    for (const item of items) {
      const want = item.size.px !== null ? item.size.px : weights > 0 ? (rest * item.size.weight) / weights : 0;
      const length = clampChild(want, item.kid, end - cursor);
      const childRect = horizontal
        ? { x: cursor, y: inner.y, w: length, h: inner.h }
        : { x: inner.x, y: cursor, w: inner.w, h: length };
      const found = place(item.kid, childRect, match);
      if (found) return found;
      cursor += length + gap;
    }
    return null;
  }

  // A node without a known type still may contain the block: walk it as a stackless column.
  for (const child of kids(node)) {
    const found = place(child, inner, match);
    if (found) return found;
  }
  return null;
}

// The tab bar's rect, or null when the layout has none. `viewport` is the
// overlay's size; `scale` is how many of its pixels one layout px covers (the
// drag overlay works in layout px already, so 1).
export function barRect(root, viewport, scale = 1) {
  const vw = Math.max(0, num(viewport?.width));
  const vh = Math.max(0, num(viewport?.height));
  const sc = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (!vw || !vh) return null;
  let found = null;
  try {
    found = place(root, { x: 0, y: 0, w: vw / sc, h: vh / sc }, isTabBar);
  } catch {
    found = null;
  }
  if (!found || found.w <= 0 || found.h <= 0) return null;
  const x = found.x * sc;
  const y = found.y * sc;
  const w = Math.min(found.w * sc, vw - x);
  return box(x, y, w, Math.min(found.h * sc, vh - y));
}

// One rect per tab, laid over the chips the tabs mod draws. `info` is what that
// mod publishes (`shared("rail.tabs")`): the strip's left padding, each chip's
// measured width by tab id, and, when the strip has scrolled, one chip's real
// x to measure the scroll against. `rect` is the chip; `hit` is the whole bar
// height over the chip and half the gap either side, so no pixel between two
// chips is dead.
export function tabChips(bar, info, tabs = [], sourceTab = null) {
  if (!bar || bar.w <= 0 || bar.h <= 0) return [];
  const list = Array.isArray(tabs) ? tabs : [];
  const lead = num(info?.lead, BAR_LEAD);
  const gap = num(info?.gap, CHIP_GAP);
  const height = Math.min(num(info?.h, CHIP_H), bar.h);
  const widths = info?.widths && typeof info.widths === "object" ? info.widths : {};
  const widthOf = (tab) => {
    const w = num(widths[tab?.id], 0);
    return w > 0 ? w : CHIP_FALLBACK_W;
  };
  const at = [];
  let cursor = bar.x + lead;
  for (const tab of list) {
    const w = widthOf(tab);
    at.push({ x: cursor, w });
    cursor += w + gap;
  }
  let offset = 0;
  const calib = info?.calib;
  const calibIndex = calib ? list.findIndex((tab) => tab?.id === calib.id) : -1;
  if (calibIndex >= 0 && Number.isFinite(calib.x)) offset = calib.x - at[calibIndex].x;
  const right = bar.x + bar.w;
  const chips = [];
  list.forEach((tab, index) => {
    const x = at[index].x + offset;
    const w = at[index].w;
    if (x + w <= bar.x || x >= right) return;
    const left = Math.max(x, bar.x);
    const end = Math.min(x + w, right);
    chips.push({
      id: tab?.id ?? `tab-${index}`,
      index: num(tab?.index, index + 1),
      name: String(tab?.name ?? index + 1),
      current: Boolean(sourceTab) && tab?.id === sourceTab,
      rect: box(left, bar.y + (bar.h - height) / 2, end - left, height),
      hit: box(left - gap / 2, bar.y, end - left + gap, bar.h),
    });
  });
  return chips;
}

function inside(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// The drop zone under the pointer: a tab chip in the tab bar, else none.
export function zoneAt(pointer, bar, chips = []) {
  const x = Number(pointer?.x);
  const y = Number(pointer?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!bar || !inside(x, y, bar)) return null;
  const chip = chips.find((c) => inside(x, y, c.hit));
  return chip ? { kind: "tab", id: chip.id } : null;
}
