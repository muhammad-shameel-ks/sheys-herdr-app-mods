// The folded sidebar as a rail of tiles: spaces as their colored avatars, agents
// as their program's icon. Status rides on each tile: a soft glow that breathes
// while an agent works, breathes faster in red when it needs you, and stays lit
// when it finished unseen.
// A pill on the left edge grows under the shown space or agent.
//
// It is the `rail` child of the herdr-rail layout's `sidebar-body` stack. A
// stack's hidden child never starts, so a second, empty copy (`props.role:
// "sync"`, a 0px block that always shows) keeps the stack on the rail while the
// sidebar is narrower than 160px (Herdr's rail width) and on the lists
// otherwise, however the width changed.
//
// The sync copy also folds and unfolds the sidebar, animated: any mod asks with
// setShared("rail.toggle", Date.now()) (the sidebar button, the rail's own
// button) and it steps the width there.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, agents, terminals, keys, run, theme, shared, setShared, setAgentOrder, openOverlay, window, layout, props } from "herdr";

// Sized to sit beside the expanded lists: their 30px rows, 16px agent icons and
// 10-11px avatar letters.
const TILE = 24;
const RADIUS = 6;
const ASSET = "mods/herdr-rail";
const STACK = "sidebar-body";
const RAIL = "rail";
const LISTS = "sidebar-lists";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const sidebarPx = () => find(layout(), "sidebar")?.size?.px ?? Infinity;
const narrow = () => sidebarPx() < 160;

// Asks the sync copy to fold or unfold the sidebar.
const TOGGLE = "rail.toggle";
const requestToggle = () => setShared(TOGGLE, Date.now());
const railPx = () => (window()?.platform === "macos" ? 76 : 44);
// The fold: an ease-out over DURATION ms, a width step per frame.
const DURATION = 220;
const FRAME = 16;
const easeOut = (k) => 1 - (1 - k) ** 3;

// Space avatar colors, as Herdr's spaces list draws them.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const WORD = { blocked: "needs you", done: "done", working: "working", idle: "idle" };
const KEY = { cmd: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" };

// "ctrl-1" -> "⌃1" on macOS; as written elsewhere.
function keyLabel(combo) {
  if (window()?.platform !== "macos") return combo;
  return combo.split(/-(?=.)/).map((p) => KEY[p] ?? p.toUpperCase()).join("");
}

export default class Rail extends View {
  init(_props, cx) {
    this.hovered = null;
    this.asked = null;
    if (props()?.role !== "sync") return;
    this.seen = shared(TOGGLE);
    this.anim = null;
    // Dragging the sidebar's edge changes no data mods re-render on.
    cx.timer.every(250, (cx) => this.watch(cx));
  }

  sync() {
    const want = narrow() ? RAIL : LISTS;
    const active = find(layout(), STACK)?.active ?? this.asked;
    if (active === want) return;
    this.asked = want;
    run("layout.select", { stack: STACK, child: want });
  }

  // Sync copy: follow the width, and take up a toggle someone asked for.
  watch(cx) {
    this.sync();
    const asked = shared(TOGGLE);
    if (asked === this.seen) return;
    this.seen = asked;
    this.toggle(cx);
  }

  // To the rail, or back to the width it had (Herdr's own toggles keep it in
  // "sidebar.width" too). Mid-fold, it turns around from where it is.
  toggle(cx) {
    const open = (this.anim?.to ?? sidebarPx()) >= 160;
    if (open && !this.anim) setShared("sidebar.width", sidebarPx());
    setShared("sidebar.collapsed", open);
    this.animate(cx, open ? railPx() : (shared("sidebar.width") ?? 268));
  }

  animate(cx, to) {
    this.anim?.task.cancel();
    const from = sidebarPx();
    const start = Date.now();
    const anim = { to };
    anim.task = cx.timer.every(FRAME, () => {
      const k = Math.min(1, (Date.now() - start) / DURATION);
      run("layout.resize", { id: "sidebar", px: Math.round(from + (to - from) * easeOut(k)) });
      this.sync();
      if (k < 1) return;
      anim.task.cancel();
      if (this.anim === anim) this.anim = null;
    });
    this.anim = anim;
  }

  // One row: the edge pill, then the tile centered in what's left.
  cell(id, height, on, attention, body) {
    const t = theme();
    const pill = on ? 18 : this.hovered === id ? 8 : attention ? 5 : 0;
    return h_flex()
      .id(id)
      .w_full()
      .h(height)
      .flex_none()
      .items_center()
      .cursor_pointer()
      .on_hover((over, cx) => {
        if (over) this.hovered = id;
        else if (this.hovered === id) this.hovered = null;
        cx.notify();
      })
      .child(div().id(`${id}-pill`).w(3).h(pill).flex_none().rounded_r(3).bg(on ? t.foreground : t.muted).transition("height", { duration: 180, easing: "ease-out" }))
      .child(h_flex().flex_1().justify_center().child(body));
  }

  // A soft halo behind a tile: rounded layers fading outward, breathing when
  // `period` is set (opacity only, so it runs natively without re-rendering).
  glow(tile, color, period) {
    const layer = (spread, alpha) => div().absolute().left(-spread).top(-spread).size(tile + spread * 2).rounded(RADIUS + spread).bg(color + alpha);
    return div().absolute().left(0).top(0).size(tile)
      .when(Boolean(period), (el) => el.loop("opacity", { from: 0.2, to: 1, period, easing: "ease-in-out" }))
      .when(!period, (el) => el.opacity(0.6))
      .child(layer(7, "12")).child(layer(5, "1e")).child(layer(3, "30")).child(layer(1, "4d"));
  }

  // A space's status, at its avatar's corner.
  spaceBadge(status, t) {
    const corner = (el) => el.absolute().right(-3).bottom(-3);
    if (status === "working") return corner(div().size(10).rounded_full().border_2().border_color(t.chrome).bg(t.working)
      .loop("opacity", { from: 0.3, to: 1, period: 2600 }));
    if (status === "blocked") return corner(div().size(10).rounded_full().border_2().border_color(t.chrome).bg(t.blocked)
      .loop("opacity", { from: 0.35, to: 1, period: 1100 }));
    if (status === "done") return corner(div().size(10).rounded_full().border_2().border_color(t.chrome).bg(t.done));
    return null;
  }

  space(w, i, t, tile, hint) {
    const id = `sp-${w.id}`;
    const hot = this.hovered === id;
    const c = (shared("space.colors") ?? {})[w.id] ?? "ansi6";
    const fill = c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.accent);
    const badge = this.spaceBadge(w.status, t);
    const tip = [
      `${hint ? `${hint}  ` : ""}${w.name}`,
      w.machine && `on ${w.machine}`,
      w.branch && w.branch,
      w.status && w.status !== "idle" && `agents ${WORD[w.status]}`,
    ].filter(Boolean).join(" · ");
    const face = h_flex()
      .size(tile)
      .rounded(RADIUS)
      .items_center()
      .justify_center()
      .text_size(11)
      .font_bold()
      .bg(w.active ? fill : fill + (hot ? "55" : "2b"))
      .text_color(w.active ? "#ffffff" : fill)
      .child([...w.name][0]?.toUpperCase() ?? "?");
    return this.cell(id, tile + 6, w.active, w.status === "blocked" || w.status === "done",
      div().relative().size(tile).child(face).when(Boolean(badge), (el) => el.child(badge)))
      .tooltip(tip)
      .on_click(() => run("space.select", { id: w.id }))
      .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } }));
  }

  agent(a, t, tile, subs) {
    const id = `ag-${a.address}`;
    const hot = this.hovered === id;
    const p = a.program ?? {};
    const g = 16;
    const glyph = p.icon
      ? (p.tint ? svg(p.icon).size(g).text_color(p.color ?? t.foreground) : image(p.icon).w(g).h(g))
      : div().text_size(11).font_bold().text_color(p.color ?? t.foreground).child([...(p.name || "?")][0].toUpperCase());
    const resting = a.status === "idle" && !a.focused && !hot;
    const glowing = { working: [t.working, 2600], blocked: [t.blocked, 1200], done: [t.done, null] }[a.status];
    const face = h_flex()
      .id(`${id}-face`)
      .size(tile)
      .rounded(RADIUS)
      .items_center()
      .justify_center()
      .bg(p.tile ?? t.raised)
      .border_1()
      .border_color(glowing ? glowing[0] + "a6" : a.focused ? t.foreground + "66" : hot ? t.input : t.border)
      .opacity(resting ? 0.5 : 1)
      .transition("opacity", { duration: 220, easing: "ease-out" })
      .child(glyph);
    const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
    const tab = a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : null;
    const tip = [
      [a.space_name, tab].filter(Boolean).join(" › ") || p.name,
      `${p.name ?? "agent"} ${WORD[a.status] ?? a.status}`,
      machine && `on ${machine}`,
      subs > 0 && `${subs} sub-agent${subs > 1 ? "s" : ""}`,
      a.pinned && "pinned",
    ].filter(Boolean).join(" · ");
    const body = div().relative().size(tile)
      .when(Boolean(glowing), (el) => el.child(this.glow(tile, ...glowing)))
      .child(face)
      .when(a.status === "blocked", (el) => el.child(h_flex().absolute().right(-5).top(-5).size(13).rounded_full().border_2().border_color(t.chrome)
        .bg(t.blocked).items_center().justify_center().text_size(8).font_bold().text_color("#ffffff").child("!")))
      .when(a.status === "done", (el) => el.child(div().absolute().right(-3).top(-3).size(10).rounded_full().border_2().border_color(t.chrome).bg(t.done)))
      .when(subs > 0, (el) => el.child(h_flex().absolute().right(-5).bottom(-5).h(13).min_w(13).px(2).rounded_full().border_2().border_color(t.chrome)
        .bg(t.raised).items_center().justify_center().text_size(8).font_semibold().text_color(t.muted).child(String(subs))));
    return this.cell(id, tile + 14, a.focused, a.status === "blocked" || a.status === "done", body)
      .tooltip(tip)
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 220, height: 260, props: { tab: "pane", target: { pane: a.pane, terminal: a.address } } }));
  }

  // The agents at a glance: one bar split by status, most urgent first, and how many.
  meter(list, t, width) {
    const order = ["blocked", "done", "working", "idle"];
    const count = Object.fromEntries(order.map((s) => [s, list.filter((a) => a.status === s).length]));
    const present = order.filter((s) => count[s]);
    const top = present[0];
    const segment = (s, i) => div().h_full().bg(t[s] ?? t.dim)
      .when(i === present.length - 1, (el) => el.flex_1())
      .when(i < present.length - 1, (el) => el.w(Math.max(3, Math.round((width * count[s]) / list.length) - 1)).flex_none())
      .when(s === "working", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1400 }));
    return v_flex()
      .id("rail-meter")
      .w_full()
      .pt(6)
      .pb(4)
      .gap(5)
      .items_center()
      .tooltip(present.map((s) => `${count[s]} ${WORD[s]}`).join(" · "))
      .child(div().text_size(10).font_semibold().text_color(top && top !== "idle" ? t[top] : t.dim).child(String(list.length)))
      .child(h_flex().w(width).h(4).gap(1).rounded_full().overflow_hidden().children(present.map(segment)));
  }

  render(cx) {
    if (props()?.role === "sync") {
      this.sync();
      if (shared(TOGGLE) !== this.seen) cx.timer.after(0, (cx) => this.watch(cx));
      return div();
    }
    const t = theme();
    const tile = TILE;

    const hints = new Map();
    for (const k of keys()) {
      const m = k.section === "global" && /^space\.select:(\d+)$/.exec(k.action);
      if (m && !hints.has(m[1])) hints.set(m[1], keyLabel(k.keys));
    }

    let list = agents();
    if (shared("agents.sort") !== "grouped") list = [...list].sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || y.seq - x.seq);
    list = [...list.filter((a) => a.pinned), ...list.filter((a) => !a.pinned)];
    if (narrow()) setAgentOrder(list.map((a) => a.address));
    const kids = new Map();
    for (const k of terminals()) if (k.parent && k.state === "live") kids.set(k.parent, (kids.get(k.parent) ?? 0) + 1);

    // Spaces, with a labeled break where another machine's begin.
    const rows = [];
    let machine = null;
    spaces().forEach((w, i) => {
      if ((w.machine ?? null) !== machine) {
        machine = w.machine ?? null;
        rows.push(v_flex().id(`rail-machine-${machine ?? "local"}`).w_full().pt(6).pb(2).gap(3).items_center().tooltip(machine ?? "This computer")
          .child(div().w(tile * 0.6).h(1).bg(t.border))
          .child(div().max_w(tile + 8).truncate().text_size(9).text_color(t.dim).child(machine ?? "local")));
      }
      rows.push(this.space(w, i, t, tile, hints.get(String(i + 1))));
    });

    const add = this.cell("rail-new", tile + 6, false, false,
      h_flex().size(tile).rounded(RADIUS).border_1().border_dashed().border_color(this.hovered === "rail-new" ? t.muted : t.border)
        .items_center().justify_center().text_color(this.hovered === "rail-new" ? t.foreground : t.dim)
        .child(svg(`${ASSET}/plus.svg`).size(12)))
      .tooltip("New space")
      .on_click(() => run("space.new"));

    // A fixed-width column at the left: mid-fold the tiles hold still while the edge moves.
    return h_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .child(v_flex().w(railPx()).h_full().min_h(0).flex_none()
        .child(v_flex().id("rail-list").flex_1().min_h(0).pt(4).pb(10).overflow_y_scroll()
          .child(add)
          .children(rows)
          .when(list.length > 0, (el) => el
            .child(h_flex().w_full().justify_center().pt(8).child(div().w(tile * 0.6).h(1).bg(t.border)))
            .child(this.meter(list, t, tile))
            .children(list.map((a) => this.agent(a, t, tile, kids.get(a.address) ?? 0)))))
        .child(h_flex().h(34).flex_none().justify_center().items_center().border_t(1).border_color(t.border)
          .child(h_flex().id("rail-expand").size(26).rounded(6).items_center().justify_center().text_color(t.dim)
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip("Expand sidebar")
            .on_click(requestToggle)
            .child(svg(`${ASSET}/expand.svg`).size(14)))));
  }
}
