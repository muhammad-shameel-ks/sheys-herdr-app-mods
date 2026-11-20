// The full-window drag overlay for herdr-rail's pane headers. Dragging a
// pane's title opens it with props { pane, terminal, tab, name, folder, status,
// icon, tint, pointer, bounds }. Hovering a real tab in the tab bar outlines it
// and a drop there moves the pane to that tab; anywhere else cancels. Moving
// and swapping panes inside a tab is Herdr's own grip, not this overlay.
// Escape cancels.
//
// A drop moves a terminal with the app's verified sequence: park, wait until
// the pane is gone, select the target tab, focus its pane, keep right, and wait
// for the new pane. The task is spawned with
// owner: null so closing the overlay never cancels it mid-move.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { panes, run, theme, spaces, props, closeOverlay, notify, layout, settings, shared } from "herdr";
import { barRect, tabChips, zoneAt } from "./geometry.js";

const POLL = 40;
const PARK_WAIT = 1800;
const KEEP_WAIT = 2500;
const RECOVER_WAIT = 2000;
const GHOST_W = 226;
const GHOST_H = 54;

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

// Poll `find` each turn; resolve null at the deadline. `panes()` is re-read
// every turn, so no pane id is ever assumed.
async function waitFor(find, cx, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const value = find();
    if (value) return value;
    if (Date.now() >= until) return null;
    await cx.sleep(POLL);
  }
}

// Herdr scales every length a mod draws by settings().zoom, but reports window
// sizes and pointer positions in screen pixels. Everything this overlay draws
// or hit-tests is converted to drawing units (screen / zoom) as it arrives, so
// a rect computed from the layout lands on the pane area at any zoom.
function zoomNow() {
  const zoom = Number(settings()?.zoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function scaleBounds(bounds, zoom) {
  if (!bounds || typeof bounds !== "object") return null;
  const out = { ...bounds };
  for (const key of ["x", "y", "width", "height"]) {
    if (Number.isFinite(out[key])) out[key] = out[key] / zoom;
  }
  return out;
}

function icon(path, tint, size, color) {
  if (!path) return null;
  return tint ? svg(path).size(size).flex_none().text_color(color) : image(path).w(size).h(size).flex_none();
}

export default class RailDrag extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const zoom = zoomNow();
    this.source = p.pane && p.terminal
      ? {
          pane: p.pane,
          terminal: p.terminal,
          tab: p.tab ?? null,
          name: p.name ? String(p.name) : "pane",
          folder: p.folder ? String(p.folder) : "",
          status: p.status ?? null,
          icon: p.icon ?? null,
          tint: Boolean(p.tint),
          pointer: { x: (Number(p.pointer?.x) || 0) / zoom, y: (Number(p.pointer?.y) || 0) / zoom },
          bounds: scaleBounds(p.bounds, zoom),
        }
      : null;
    this.overlay = p.overlay ?? null;
    this.handle = cx.focus_handle();
    this.size = null;
    this.shown = false;
    this.ticking = false;
    this.busy = false;
    this.closing = false;
    this.done = false;
    this.pointer = { ...(this.source?.pointer ?? { x: 0, y: 0 }) };
    this.zone = null;
    this.frozen = null;
    this.openedAt = Date.now();
    if (this.source) this.handle.focus();
  }

  close() {
    this.done = true;
    this.closing = true;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.closing = true;
    if (this.overlay) closeOverlay(this.overlay);
  }

  cancel(cx) {
    if (this.busy || this.closing || this.done) return;
    this.closing = true;
    if (this.source) run("pane.focus", { pane: this.source.pane });
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(150);
      this.finish();
    }, { owner: null });
  }

  sized(size, cx) {
    const zoom = zoomNow();
    const width = Math.max(0, Number(size?.width) || 0) / zoom;
    const height = Math.max(0, Number(size?.height) || 0) / zoom;
    if (!width || !height) return;
    this.size = { width, height };
    const g = this.geo();
    this.zone = g ? zoneAt(this.pointer, g.bar, g.chips) : null;
    if (!this.shown && !this.ticking && !this.closing) {
      this.ticking = true;
      cx.timer.after(16, (cx) => {
        this.ticking = false;
        if (this.closing || this.done) return;
        this.shown = true;
        this.handle.focus();
        cx.notify();
      });
    }
    cx.notify();
  }

  geo() {
    if (!this.size) return null;
    const bar = barRect(layout(), this.size);
    const tabs = spaces().find((s) => s.active)?.tabs ?? [];
    const chips = tabChips(bar, shared("rail.tabs"), tabs, this.source?.tab ?? null);
    return { bar, chips };
  }

  moved(e, cx) {
    if (this.busy || this.closing) return;
    const zoom = zoomNow();
    const x = Number(e?.position?.x) / zoom;
    const y = Number(e?.position?.y) / zoom;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.pointer = { x, y };
    const g = this.geo();
    this.zone = g ? zoneAt(this.pointer, g.bar, g.chips) : null;
    cx.notify();
  }

  drop(e, cx) {
    if (this.busy || this.closing || this.done || !this.source) return;
    const src = this.source;
    const zoom = zoomNow();
    const x = Number(e?.position?.x) / zoom;
    const y = Number(e?.position?.y) / zoom;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      this.pointer = { x, y };
      const g = this.geo();
      this.zone = g ? zoneAt(this.pointer, g.bar, g.chips) : null;
    }
    const zone = this.zone;
    if (!zone) return this.cancel(cx);
    if (zone.id === src.tab) return this.cancel(cx);

    const plan = this.tabPlan(zone.id);
    if (!plan) return this.cancel(cx);
    this.busy = true;
    this.frozen = this.center(zone);
    cx.notify();
    cx.spawn(async (cx) => {
      await this.move(plan, cx);
    }, { owner: null });
  }

  // Move into another tab: its first pane is the neighbour to keep beside.
  tabPlan(id) {
    const tabs = spaces().find((s) => s.active)?.tabs ?? [];
    const tab = tabs.find((t) => t.id === id);
    const target = panes().find((p) => p.tab === id);
    if (!tab || !target) return null;
    const zoomed = panes().find((p) => p.tab === id && p.zoomed);
    return {
      tab: id,
      target: target.pane,
      select: true,
      unsettle: Boolean(tab.settled),
      // `pane.zoom` unzooms the pane that is zoomed, not any pane in a zoomed tab.
      unzoom: zoomed?.pane ?? null,
    };
  }

  async move(plan, cx) {
    const terminal = this.source.terminal;
    let parked = false;
    try {
      run("terminal.park", { terminal });
      parked = true;
      const gone = await waitFor(() => !panes().some((p) => p.terminal === terminal), cx, PARK_WAIT);
      if (!gone) throw new Error("the terminal did not leave its pane");
      if (plan.unsettle) run("tab.unsettle", { id: plan.tab });
      if (plan.select) run("tab.select", { id: plan.tab });
      if (plan.unzoom) run("pane.zoom", { pane: plan.unzoom });
      run("pane.focus", { pane: plan.target });
      run("terminal.keep", { terminal, place: "right" });
      const kept = await waitFor(() => panes().find((p) => p.terminal === terminal), cx, KEEP_WAIT);
      if (!kept) throw new Error("the terminal did not come back");
      run("pane.focus", { pane: kept.pane });
      this.finish();
    } catch (error) {
      console.log("herdr-rail-drag:", error?.message ?? error);
      await this.recover(terminal, parked, cx);
    }
  }

  // A parked terminal must never stay hidden: keep it as a tab, then say so.
  async recover(terminal, parked, cx) {
    let visible = panes().some((p) => p.terminal === terminal);
    if (parked && !visible) {
      for (let attempt = 0; attempt < 2 && !visible; attempt++) {
        run("terminal.keep", { terminal, place: "tab" });
        visible = Boolean(await waitFor(() => panes().some((p) => p.terminal === terminal), cx, RECOVER_WAIT));
      }
    }
    notify({
      title: "Couldn't move the pane",
      body: visible
        ? "The terminal is still running."
        : `The terminal ${terminal} is still running; find it in the terminal picker.`,
      level: "error",
    });
    this.finish();
  }

  // Where a frozen ghost sits: over the zone it will drop on.
  center(zone) {
    const chip = this.geo()?.chips.find((c) => c.id === zone.id);
    return chip ? { x: chip.rect.x + chip.rect.w / 2, y: chip.rect.y + chip.rect.h / 2 } : null;
  }

  status(t) {
    const st = this.source?.status;
    if (!st) return null;
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    return div().size(7).flex_none().rounded(4).bg(t[st] ?? t.dim);
  }

  // Outlines laid over the real tabs. Each lights up as the pointer reaches it;
  // the tab the pane already lives in stays plain.
  tabsView(t, g, shown) {
    const hovered = this.zone?.kind === "tab" ? this.zone.id : null;
    const out = [];
    for (const chip of g.chips) {
      if (chip.current) continue;
      const on = chip.id === hovered;
      const r = chip.rect;
      out.push(
        div()
          .id(`rail-drag-tab-${chip.id}`)
          .absolute().left(r.x).top(r.y).w(r.w).h(r.h)
          .rounded(7).border(1).border_color(on ? t.accent : t.accent + "66")
          .bg(on ? t.accent + "33" : t.accent + "12")
          .opacity(shown ? 1 : 0)
          .transition("opacity", { duration: 120, easing: "ease-out" }),
      );
      if (on) {
        out.push(
          div()
            .id("rail-drag-tab-label")
            .absolute().left(Math.round(r.x)).top(g.bar.y + g.bar.h + 4).h(22)
            .px(8).flex().items_center().rounded(6)
            .bg(t.popover).border(1).border_color(t.border).shadow_md()
            .text_size(11).text_color(t.foreground)
            .child(`Move to tab ${chip.index}`),
        );
      }
    }
    return out;
  }

  ghostView(t, shown) {
    const src = this.source;
    const at = this.busy && this.frozen ? this.frozen : this.pointer;
    // The card fits the window on any display, not a fixed width.
    const gw = Math.min(GHOST_W, Math.max(120, this.size.width - 16));
    const gh = Math.min(GHOST_H, Math.max(32, this.size.height - 16));
    const x = clamp(at.x + 14, 8, Math.max(8, this.size.width - gw - 8));
    const y = clamp(at.y + 16, 8, Math.max(8, this.size.height - gh - 8));
    const pic = icon(src.icon, src.tint, 14, t.muted);
    const dot = this.busy ? svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.accent).spin(900) : this.status(t);
    return h_flex()
      .id("rail-drag-ghost")
      .absolute().left(Math.round(x)).top(Math.round(y)).w(gw).h(gh)
      .px(10).gap(8).items_center().overflow_hidden()
      .rounded(9).bg(t.popover).border(1).border_color(t.border).shadow_md()
      .opacity(shown ? 1 : 0)
      .transition("left", { duration: 40, easing: "ease-out" })
      .transition("top", { duration: 40, easing: "ease-out" })
      .transition("opacity", { duration: 140, easing: "ease-out" })
      .when(Boolean(pic), (el) => el.child(pic))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_size(12).font_medium().text_color(t.foreground).child(src.name))
        .child(div().truncate().text_size(10.5).text_color(t.dim).child(this.busy ? "Moving…" : src.folder)))
      .when(Boolean(dot), (el) => el.child(dot));
  }

  render(cx) {
    if (!this.source) return div();
    const t = theme();
    const root = div()
      .id("rail-drag-root")
      .size_full().relative()
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        cx.stop_propagation();
        this.cancel(cx);
      })
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        // No press should ever start inside an open overlay; if one lands (a
        // release lost to another window), get out instead of trapping it.
        // Ignore the first moments so a redelivered opening press can't close it.
        if (!this.busy && Date.now() - this.openedAt > 250) this.cancel(cx);
      })
      .on_mouse_down("right", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("middle", (_e, cx) => cx.stop_propagation())
      .on_mouse_move((e, cx) => this.moved(e, cx))
      .on_mouse_up("left", (e, cx) => this.drop(e, cx))
      .on_size_change((size, cx) => this.sized(size, cx));
    const g = this.geo();
    if (!g) return root;

    const shown = this.shown && !this.closing;
    const children = [
      div()
        .absolute().inset_0()
        .bg(t.background + "18")
        .opacity(shown ? 1 : 0)
        .transition("opacity", { duration: 140, easing: "ease-out" }),
      ...this.tabsView(t, g, shown),
    ];
    const ghost = this.ghostView(t, shown);
    if (ghost) children.push(ghost);
    return root.children(children);
  }
}
