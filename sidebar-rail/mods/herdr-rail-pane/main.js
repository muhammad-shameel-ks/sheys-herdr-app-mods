// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "herdr-rail-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
// Dragging the header 5 px starts the full-window move-to-tab overlay.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout, openOverlay } from "herdr";

// Match the first visible tab frame, including the active child of a stack.
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter(child => !child.hidden);
    children = [visible.find(child => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init() { this.hovered = false; this.press = null; this.dragging = false; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("right", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("middle", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/pane/${icon}.svg`).size(14));
  }

  pressStart(p, name, e) {
    this.dragging = false;
    this.press = null;
    if (!p.terminal) return;
    this.press = {
      pane: p.pane,
      terminal: p.terminal,
      tab: p.tab,
      name,
      folder: folder(p.cwd),
      status: p.status ?? null,
      icon: p.program?.icon ?? null,
      tint: Boolean(p.program?.tint),
      pointer: { x: e.position.x, y: e.position.y },
      bounds: e.bounds,
    };
    run("pane.focus", { pane: p.pane });
  }

  pointerMove(e) {
    const press = this.press;
    if (!press) return;
    const dx = e.position.x - press.pointer.x;
    const dy = e.position.y - press.pointer.y;
    if (dx * dx + dy * dy <= 25) return;
    this.dragging = true;
    this.press = null;
    openOverlay({
      mod: "herdr-rail-drag",
      kind: "window",
      width: 1,
      height: 1,
      at: { x: 0, y: 0 },
      frame: "none",
      props: {
        pane: press.pane,
        terminal: press.terminal,
        tab: press.tab,
        name: press.name,
        folder: press.folder,
        status: press.status,
        icon: press.icon,
        tint: press.tint,
        pointer: { x: e.position.x, y: e.position.y },
        bounds: e.bounds ?? press.bounds,
      },
    });
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    const draggable = Boolean(p.terminal);
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .border_color(t.border)
      .text_size(12)
      .when(draggable, el => el.cursor_grab())
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_mouse_down("left", (e) => this.pressStart(p, name, e))
      .on_mouse_move((e) => this.pointerMove(e))
      .on_mouse_up("left", () => { this.press = null; })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
