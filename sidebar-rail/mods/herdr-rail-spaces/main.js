// Herdr's spaces list, with named groups: a header per group, foldable, and a
// space moves into one by drag or from its menu. Worktrees move with their
// checkout. Groups are shared state, so every copy and the menu agree; the
// folded rail stays a flat list of every space so nothing hides there.
// Everything else is Herdr's spaces mod (cloned from 0.1.16): stable colored
// avatars, worktrees under their checkout, grouped by machine when more than
// one is known. After a space's name, the repo its first terminal is in now,
// only where unusual: branch, ahead/behind; then its agents as a stack of
// round program icons, the most urgent first, with one dot for the most urgent
// status. Click to switch, right-click for its menu, drag to reorder.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, ScrollHandle } from "gpui-base";
import { spaces, agents, machines, panes, run, openOverlay, closeOverlay, props, exec, hc, theme, shared, setShared, watchFolder, window, layout, keys } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const RAIL_CELL = 32;
// A space's name and its git tail never shrink below this, so a short one ("api")
// stays readable instead of turning into an ellipsis next to a long branch.
const SIDE_MIN = 48;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Places looked at together (two git runs each). All at once, a few hundred spaces
// run out of the app's open files (256 when started from the Dock on macOS) or
// past a machine core's 16 running execs, and those spaces wait for FALLBACK.
const AT_ONCE = 6;

// Both runs, finished: a place isn't done while one of its runs still holds a slot.
async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map((d) => d.value);
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

// Groups: named sets of spaces, one group per space, kept in shared state so
// the list, its menus and the prompt all see the same answer.
const GROUPS_KEY = "space.groups";
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const WORD = { blocked: "needs you", done: "done", working: "working", idle: "idle" };
// A row's agent stack: round icons overlapping by AVATAR - AVATAR_STEP, at most
// AVATARS of them, then a "+N" chip for the rest.
const AVATAR = 22;
const AVATAR_STEP = 14;
const AVATARS = 3;

function readGroups() {
  const raw = shared(GROUPS_KEY);
  const groups = [];
  if (Array.isArray(raw?.groups)) {
    const seen = new Set();
    for (const g of raw.groups) {
      if (!g || typeof g.id !== "string" || typeof g.name !== "string" || !g.name.trim() || seen.has(g.id)) continue;
      seen.add(g.id);
      groups.push({ id: g.id, name: g.name, machine: typeof g.machine === "string" ? g.machine : null, folded: g.folded === true, before: typeof g.before === "string" ? g.before : null });
    }
  }
  const members = {};
  if (raw?.members && typeof raw.members === "object" && !Array.isArray(raw.members)) {
    for (const [space, group] of Object.entries(raw.members)) {
      if (typeof group === "string" && groups.some((g) => g.id === group)) members[space] = group;
    }
  }
  return { groups, members };
}

function writeGroups(state) {
  setShared(GROUPS_KEY, { version: 1, groups: state.groups, members: state.members });
}

function newGroupId(groups) {
  let id;
  do id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  while (groups.some((g) => g.id === id));
  return id;
}

function groupOf(state, space) {
  const id = state.members[space];
  return id ? state.groups.find((g) => g.id === id) ?? null : null;
}

function sameTarget(a, b) {
  return (a?.kind ?? null) === (b?.kind ?? null) && (a?.id ?? null) === (b?.id ?? null) && (a?.row ?? null) === (b?.row ?? null);
}

// The key bound to a command, for the hint on the right (as Herdr's menu shows it).
function shortcut(name) {
  const k = keys().find((b) => b.section === "global" && b.action === name);
  return k ? k.keys : "";
}

// A group's dot only when something there needs the person.
function groupStatus(rows) {
  return rows.reduce((best, r) => ((RANK[r.w.status] ?? 0) > (RANK[best] ?? 0) ? r.w.status : best), null);
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

export default class Spaces extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.mode = p.mode ?? null;
    if (this.mode === "menu") {
      this.at = 0;
      this.items = [];
      this.git = null;
      this.handle = cx.focus_handle();
      this.handle.focus();
      this.loadCheckout(cx);
      return;
    }
    if (this.mode === "prompt") {
      this.at = 0;
      const state = readGroups();
      const group = p.groupId ? state.groups.find((g) => g.id === p.groupId) : null;
      this.value = p.action === "rename" ? group?.name ?? "" : "";
      this.input = InputState.new({ value: this.value });
      if (this.value) this.input.set_selected_range({ start: 0, end: this.value.length });
      this.input.on("change", (_e, cx) => { this.value = this.input.value(); cx.notify(); });
      this.input.on("submit", () => this.submitGroup());
      this.focused = true;
      this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
      this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
      this.handle = cx.focus_handle();
      return;
    }
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Map(); // local repos' pending folder watches
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.overGroup = null; // a dragged space is over this group's header
    this.groupPressed = null; // group header under a press, for fold or reorder
    this.groupOver = null; // a dragged group is over this group's header
    this.groupDragging = false; // the pressed group left its header
    this.groupMachine = null; // the pressed group's machine, for same-machine drops
    this.roots = {}; // space -> its checkout's space (a worktree moves with it)
    this.top = {}; // machine -> top-level rows in display order (groups and ungrouped spaces)
    this.groupState = readGroups();
    this.scroll = ScrollHandle.new(); // the list's position: the active space is brought into view through it
    this.activeAt = -1; // the active space's place among the list's children (headers and rows), -1 when not drawn
    this.machines = [];
    try {
      this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
      if (!this.reconnecting || typeof this.reconnecting !== "object" || Array.isArray(this.reconnecting)) this.reconnecting = {};
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch { this.reconnecting = {}; }
    try { this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]")); } catch { this.folded = new Set(); }
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  // The menu's copy asks one space's checkout for its worktree items.
  loadCheckout(cx) {
    const p = props();
    if (p.what !== "space") return;
    const space = spaces().find((s) => s.id === p.id);
    if (!space) return;
    const folder = place(space, panes());
    if (!folder) return;
    cx.spawn(async (cx) => {
      this.git = await checkout(folder, space.machine).catch(() => null);
      cx.notify();
    });
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
    }
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
      }
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }

  // The list's right-click menu (this mod as a popup).
  menu(w) {
    const state = this.groupState ?? readGroups();
    const count = state.groups.filter((g) => (g.machine ?? null) === (w.machine ?? null)).length;
    openOverlay({
      mod: "herdr-rail-spaces",
      kind: "popup",
      width: 224,
      height: Math.min(460, 20 + (count + 8) * 31),
      props: { mode: "menu", what: "space", id: w.id, root: this.roots[w.id] ?? w.id },
    });
  }

  groupMenu(g) {
    openOverlay({
      mod: "herdr-rail-spaces",
      kind: "popup",
      width: 210,
      height: 132,
      props: { mode: "menu", what: "group", id: g.id },
    });
  }

  promptGroup(action, { machine = null, spaceId = null, groupId = null } = {}) {
    openOverlay({
      mod: "herdr-rail-spaces",
      kind: "dialog",
      width: 380,
      height: 244,
      props: { mode: "prompt", action, machine, spaceId, groupId },
    });
  }

  // This space's group, following a worktree to its checkout.
  groupFor(space) {
    return groupOf(readGroups(), this.roots[space] ?? space)?.id ?? null;
  }

  clearDrag() {
    this.pressed = null;
    this.over = null;
    this.overGroup = null;
    this.groupPressed = null;
    this.groupOver = null;
    this.groupDragging = false;
    this.groupMachine = null;
  }

  sameGroup(a, b) {
    return this.groupFor(a) === this.groupFor(b);
  }

  // Put a space (or its checkout, for a worktree) in a group; null takes it out.
  assign(space, groupId) {
    const state = readGroups();
    const found = spaces().find((s) => s.id === space);
    if (!found) return;
    if (groupId) {
      const group = state.groups.find((g) => g.id === groupId && (g.machine ?? null) === (found.machine ?? null));
      if (!group) return;
      state.members[space] = group.id;
      group.folded = false;
    } else {
      delete state.members[space];
    }
    writeGroups(state);
    this.groupState = state;
  }

  toggleGroup(group) {
    const state = readGroups();
    const found = state.groups.find((g) => g.id === group.id);
    if (!found) return;
    found.folded = !found.folded;
    writeGroups(state);
    this.groupState = state;
  }

  // Drop a dragged group at another top-level row: a group header or an
  // ungrouped space. Moving down lands after the target (its line is at the
  // target's bottom); moving up lands before it. Anchors keep it next to that
  // space, so a group can sit between spaces.
  reorderGroup(fromId, target) {
    const state = readGroups();
    const group = state.groups.find((g) => g.id === fromId);
    if (!group || !target) return;
    const machine = group.machine ?? null;
    const top = this.top?.[machine] ?? [];
    const from = top.findIndex((t) => t.kind === "group" && t.id === fromId);
    const to = top.findIndex((t) => t.kind === target.kind && t.id === target.id);
    if (from < 0 || to < 0 || from === to) return;
    const order = top.map((t) => ({ ...t }));
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    // This machine's groups in the new order; other machines keep their slots.
    const seen = new Set();
    const mine = [];
    for (const t of order) {
      if (t.kind !== "group") continue;
      const g = state.groups.find((x) => x.id === t.id);
      if (g && !seen.has(g.id)) {
        seen.add(g.id);
        mine.push(g);
      }
    }
    for (const g of state.groups) {
      if ((g.machine ?? null) === machine && !seen.has(g.id)) {
        seen.add(g.id);
        mine.push(g);
      }
    }
    let i = 0;
    state.groups = state.groups.map((g) => ((g.machine ?? null) === machine ? mine[i++] : g));
    // A group belongs before the next space; past the last space it has no anchor.
    let next = null;
    for (let k = order.length - 1; k >= 0; k--) {
      const t = order[k];
      if (t.kind === "space") next = t.id;
      else {
        const g = state.groups.find((x) => x.id === t.id);
        if (g) g.before = next;
      }
    }
    writeGroups(state);
    this.groupState = state;
  }

  deleteGroup(group) {
    const state = readGroups();
    state.groups = state.groups.filter((g) => g.id !== group.id);
    for (const [space, id] of Object.entries(state.members)) if (id === group.id) delete state.members[space];
    writeGroups(state);
    this.groupState = state;
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null, root: r.w.id });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─", root: r.w.id }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows: ungrouped first, then each group under its header, and a header
  // per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const state = this.groupState ?? readGroups();
    this.roots = {};
    this.top = {};
    const clusters = [];
    for (const r of rows) {
      if (r.tree === null || !clusters.length) clusters.push({ main: r, rows: [r] });
      else clusters[clusters.length - 1].rows.push(r);
    }
    for (const c of clusters) for (const r of c.rows) this.roots[r.w.id] = c.main.w.id;
    this.activeAt = -1;
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    // Where the active space's row lands among the children this returns: the list scrolls by its direct
    // children, and machine headers, group headers, login notes and loading rows count too.
    const push = (out, offset, r, indent = 0) => {
      if (r.w.active) this.activeAt = offset + out.length;
      out.push(collapsed ? this.compact(r, t) : this.row(r, t, indent));
    };
    // One machine's spaces and groups, in the order their headers sit: a group
    // anchored before a space renders there; groups with no anchor come last.
    const fill = (out, offset, mine, m) => {
      const mineGroups = state.groups.filter((g) => (g.machine ?? null) === m);
      const cs = clusters.filter((c) => mine.includes(c.main));
      const clusterGroup = (c) => {
        const g = groupOf(state, c.main.w.id);
        return g && (g.machine ?? null) === m ? g : null;
      };
      const ungrouped = cs.filter((c) => !clusterGroup(c));
      const spaces = new Set(ungrouped.map((c) => c.main.w.id));
      const anchored = new Map(); // space -> the groups just before it, in group order
      const tail = [];
      for (const g of mineGroups) {
        if (g.before && spaces.has(g.before)) {
          if (!anchored.has(g.before)) anchored.set(g.before, []);
          anchored.get(g.before).push(g);
        } else tail.push(g);
      }
      // The top-level order first: the rows use it to place their drag line, and
      // the drop handlers use it to know where a dragged group landed.
      const order = [];
      for (const c of ungrouped) {
        for (const g of anchored.get(c.main.w.id) ?? []) order.push({ kind: "group", id: g.id });
        order.push({ kind: "space", id: c.main.w.id });
      }
      for (const g of tail) order.push({ kind: "group", id: g.id });
      this.top[m] = order;
      const clustersById = new Map(ungrouped.map((c) => [c.main.w.id, c]));
      const groupsById = new Map(mineGroups.map((g) => [g.id, g]));
      const drawGroup = (g) => {
        const included = cs.filter((c) => clusterGroup(c)?.id === g.id);
        const count = included.reduce((n, c) => n + c.rows.length, 0);
        // The folded rail is for attention: group order, a hairline, nothing hidden.
        if (collapsed) {
          if (!included.length) return;
          out.push(div().h(1).mx(4).my(4).flex_none().bg(t.border));
          for (const c of included) for (const r of c.rows) push(out, offset, r);
          return;
        }
        out.push(this.groupHeader(g, count, included, t));
        if (g.folded) return;
        if (count) out.push(div().h(4).flex_none());
        for (const c of included) for (const r of c.rows) push(out, offset, r, 7);
        if (!count) out.push(this.groupEmpty(t));
      };
      for (const t of order) {
        if (t.kind === "group") drawGroup(groupsById.get(t.id));
        else for (const r of clustersById.get(t.id).rows) push(out, offset, r);
      }
    };
    if (!remote.length) {
      if (loading(null) && !rows.length) return [loadingRow(null)];
      const out = [];
      fill(out, 0, rows, null);
      return out;
    }
    const machineNames = [null, ...remote];
    const all = [];
    let before = 0;
    for (const m of machineNames) {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(machine?.keeps_running_after_logout === false, el => el.child(div().id(`machine-logout-${m}`)
          .flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); }).child("⚠")))
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) { all.push(head); before += 1; continue; }
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const out = [cell(head), ...guidance];
      if (!folded) {
        const mineGroups = state.groups.filter((g) => (g.machine ?? null) === m);
        if (mine.length || mineGroups.length) fill(out, before, mine, m);
        else out.push(loading(m) ? loadingRow(m) : cell(empty));
      }
      all.push(...out);
      before += out.length;
    }
    return all;
  }

  // A group's header: fold on click, drag onto another header to reorder,
  // menu on right-click, drop target for a dragged space. The dot says
  // something inside it needs the person.
  groupHeader(g, count, included, t) {
    const status = groupStatus(included.flatMap((c) => c.rows));
    const dot = status === "blocked" ? t.blocked : status === "done" ? t.done : null;
    const active = included.some((c) => c.rows.some((r) => r.w.active));
    const spaceOver = this.pressed !== null && this.overGroup === g.id;
    const groupDragging = this.groupPressed !== null && this.groupDragging;
    const groupOver = groupDragging && this.groupOver?.kind === "group" && this.groupOver.id === g.id;
    const source = this.groupPressed === g.id;
    const top = this.top?.[g.machine ?? null] ?? [];
    const from = top.findIndex((x) => x.kind === "group" && x.id === this.groupPressed);
    const to = top.findIndex((x) => x.kind === "group" && x.id === g.id);
    return h_flex()
      .relative()
      .id(`space-group-${g.id}`)
      .h(26)
      .flex_none()
      .px(8)
      .gap(5)
      .items_center()
      .rounded(6)
      .text_size(11.5)
      .text_color(active ? t.foreground : t.dim)
      .cursor_pointer()
      .tooltip("Click to fold. Drag to reorder. Drop a space here to move it in. Right-click to rename or delete.")
      .when(spaceOver, (el) => el.bg(t.selected))
      .when(!spaceOver && !source, (el) => el.hover((s) => s.bg(t.hover)))
      .when(source && groupDragging, (el) => el.opacity(0.5))
      .when(groupOver, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(from < to, (line) => line.bottom(0))
          .when(from > to, (line) => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.groupPressed = g.id;
        this.groupMachine = g.machine ?? null;
        this.groupOver = null;
        this.groupDragging = false;
      })
      .on_mouse_down("right", () => this.groupMenu(g))
      .on_mouse_move((_e, cx) => {
        if (this.groupPressed !== null) {
          if (g.id === this.groupPressed) {
            if (this.groupOver !== null) {
              this.groupOver = null;
              cx.notify();
            }
          } else if ((g.machine ?? null) === this.groupMachine) {
            const next = { kind: "group", id: g.id };
            if (!sameTarget(this.groupOver, next) || !this.groupDragging) {
              this.groupOver = next;
              this.groupDragging = true;
              this.over = null;
              this.overGroup = null;
              cx.notify();
            }
          } else if (this.groupOver !== null) {
            this.groupOver = null;
            cx.notify();
          }
        } else if (this.pressed !== null && (this.overGroup !== g.id || this.over !== null)) {
          this.overGroup = g.id;
          this.over = null;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const space = this.pressed;
        const groupFrom = this.groupPressed;
        const groupTo = this.groupOver;
        const moved = this.groupDragging;
        this.pressed = null;
        this.over = null;
        this.overGroup = null;
        this.groupPressed = null;
        this.groupOver = null;
        this.groupDragging = false;
        this.groupMachine = null;
        if (space !== null) this.assign(this.roots[space] ?? space, g.id);
        else if (groupFrom !== null && groupTo) {
          if (groupTo.kind === "space" && groupFrom === g.id) this.reorderGroup(groupFrom, groupTo);
          else if (groupTo.kind === "group" && groupTo.id === g.id && groupFrom !== g.id) this.reorderGroup(groupFrom, groupTo);
        } else if (groupFrom === g.id && !moved) this.toggleGroup(g);
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${g.folded ? "right" : "down"}.svg`).size(11).flex_none())
      .child(svg("mods/workspace-chrome/folder.svg").size(13).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(g.name))
      .when(Boolean(dot), (el) => el.child(div().size(6).rounded(3).flex_none().bg(dot)))
      .child(div().text_size(10.5).text_color(t.dim).child(String(count)));
  }

  groupEmpty(t) {
    return h_flex().h(26).flex_none().pl(42).pr(8).items_center().text_size(11.5).text_color(t.dim).child("Drop spaces here");
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one. When the row is full, it
  // and the name both start from their text's width and give way in proportion.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_auto()
      .min_w(where ? SIDE_MIN : 0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree }, t, indent = 0) {
    const on = w.active;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    const dragging = this.pressed !== null && this.pressed !== w.id;
    const over = dragging && this.over === w.id;
    const same = over ? this.sameGroup(this.pressed, w.id) : true;
    const root = this.roots[w.id] ?? w.id;
    const groupTarget = this.groupPressed !== null && this.groupOver?.kind === "space" && this.groupOver.row === w.id;
    const top = this.top?.[w.machine ?? null] ?? [];
    const groupFrom = top.findIndex((x) => x.kind === "group" && x.id === this.groupPressed);
    const groupTo = top.findIndex((x) => x.kind === "space" && x.id === root);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .pl(8 + indent)
      .pr(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(over && !same, (el) => el.bg(t.selected))
      .when(over && same, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .when(groupTarget, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(groupFrom < groupTo, line => line.bottom(0))
          .when(groupFrom > groupTo, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        let changed = false;
        if (this.groupPressed !== null) {
          const main = (this.roots[w.id] ?? w.id) === w.id;
          const next = main && (w.machine ?? null) === this.groupMachine && this.groupFor(w.id) === null
            ? { kind: "space", id: root, row: w.id }
            : null;
          if (!sameTarget(this.groupOver, next)) {
            this.groupOver = next;
            if (next) {
              this.groupDragging = true;
              this.over = null;
              this.overGroup = null;
            }
            changed = true;
          }
        } else {
          const source = spaces().find(s => s.id === this.pressed);
          const next = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
          if (this.pressed !== null && (this.over !== next || this.overGroup !== null)) {
            this.over = next;
            this.overGroup = null;
            changed = true;
          }
        }
        if (changed) cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const fromOver = this.over;
        const groupFrom = this.groupPressed;
        const groupTo = this.groupOver;
        const drop = groupFrom !== null && groupTo?.kind === "space" && groupTo.id === root
          && (w.machine ?? null) === this.groupMachine && this.groupFor(w.id) === null;
        this.pressed = null;
        this.over = null;
        this.overGroup = null;
        this.groupPressed = null;
        this.groupOver = null;
        this.groupDragging = false;
        this.groupMachine = null;
        if (groupFrom !== null) {
          if (drop) this.reorderGroup(groupFrom, groupTo);
        } else if (from !== null && fromOver === w.id && from !== w.id) {
          if (this.sameGroup(from, w.id)) {
            const index = spaces().findIndex(s => s.id === w.id);
            if (index !== -1) run("space.move", { id: from, index: index + 1 });
          } else this.assign(this.roots[from] ?? from, this.groupFor(w.id));
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().flex_initial().min_w(SIDE_MIN).truncate().text_color(t.foreground).child(w.name))
          .when(Boolean(this.crew?.get(w.id)), el => el.child(this.agentStack(w.id, this.crew.get(w.id), on, t)))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
  }

  // A space's agents, overlapping left to right (later on top); the ring is the
  // row's own background so each icon reads as cut out of the one under it.
  agentStack(id, list, on, t) {
    const ring = on ? t.selected : t.chrome;
    const shown = list.slice(0, list.length > AVATARS + 1 ? AVATARS : AVATARS + 1);
    const rest = list.length - shown.length;
    const slots = shown.length + (rest > 0 ? 1 : 0);
    const at = (el, n) => el.absolute().top(0).left(n * AVATAR_STEP).size(AVATAR).rounded_full().border_2().border_color(ring);
    const avatar = (a, n) => {
      const p = a.program ?? {};
      // 14: smaller, Herdr's built-in glyphs (omp's) don't draw.
      const g = 14;
      const glyph = p.icon
        ? (p.tint ? svg(p.icon).size(g).flex_none().text_color(p.color ?? t.foreground) : image(p.icon).w(g).h(g).flex_none())
        : div().text_size(9).font_bold().text_color(p.color ?? t.foreground).child([...(p.name || "?")][0].toUpperCase());
      return at(h_flex(), n).items_center().justify_center().bg(p.tile ?? t.raised).child(glyph);
    };
    const top = list[0].status;
    const dot = top === "idle" ? null : t[top];
    const tip = list.map((a) => `${a.program?.name ?? "agent"} ${WORD[a.status] ?? a.status}`).join(" · ");
    return div()
      .id(`space-agents-${id}`)
      .relative()
      .flex_none()
      .w(AVATAR + (slots - 1) * AVATAR_STEP)
      .h(AVATAR)
      .tooltip(tip)
      .children(shown.map(avatar))
      .when(rest > 0, (el) => el.child(at(h_flex(), shown.length).items_center().justify_center().bg(t.raised)
        .text_size(8.5).font_semibold().text_color(t.muted).child(`+${rest}`)))
      .when(Boolean(dot), (el) => el.child(div().absolute().right(-2).bottom(-2).size(8).rounded_full().border_2().border_color(ring).bg(dot)
        .when(top === "working", (d) => d.loop("opacity", { from: 0.35, to: 1, period: 2600 }))
        .when(top === "blocked", (d) => d.loop("opacity", { from: 0.35, to: 1, period: 1100 }))));
  }

  compact({ w, i }, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  menuItems() {
    const p = props() ?? {};
    const state = readGroups();
    if (p.what === "group") {
      const group = state.groups.find((g) => g.id === p.id);
      if (!group) return [];
      return [
        { label: "Rename group…", icon: "square-pen", run: () => this.promptGroup("rename", { groupId: group.id }) },
        { label: group.folded ? "Unfold group" : "Fold group", icon: group.folded ? "chevron-down" : "chevron-right", run: () => this.toggleGroup(group) },
        { separator: true },
        { label: "Delete group", icon: "x", danger: true, run: () => this.deleteGroup(group) },
      ];
    }
    const space = spaces().find((s) => s.id === p.id);
    if (!space) return [];
    const mine = state.groups.filter((g) => (g.machine ?? null) === (space.machine ?? null));
    const root = p.root ?? p.id;
    const current = state.members[root];
    const items = [];
    if (mine.length) {
      items.push({ kind: "label", label: "Move to group" });
      for (const g of mine) items.push({
        label: g.name,
        icon: current === g.id ? "check" : "folder",
        checked: current === g.id,
        run: () => this.assign(root, g.id),
      });
      if (current) items.push({ label: "Remove from group", icon: "x", run: () => this.assign(root, null) });
    }
    items.push({ label: "New group…", icon: "folder-plus", run: () => this.promptGroup("new", { machine: space.machine ?? null, spaceId: root }) });
    items.push({ separator: true });
    items.push({ label: "Rename", icon: "square-pen", keys: shortcut("space.rename"), run: () => run("space.rename", { id: space.id }) });
    if (this.git === "main" || this.git === "linked") {
      items.push({ label: "New worktree", icon: "git-branch", run: () => openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: space.id, action: "new" } }) });
      items.push({ label: "Open worktree", icon: "git-branch", run: () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space.id, action: "open" } }) });
      if (this.git === "linked") items.push({ label: "Remove worktree", icon: "x", danger: true, run: () => openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: space.id, action: "remove" } }) });
    }
    items.push({ separator: true });
    items.push({ label: "Close", icon: "x", danger: true, keys: shortcut("space.close"), run: () => run("space.close", { id: space.id }) });
    return items;
  }

  selectable(item) {
    return Boolean(item) && item.kind !== "label" && !item.separator;
  }

  moveChoice(delta) {
    const list = this.items ?? [];
    if (!list.length) return;
    let i = this.at;
    for (let n = 0; n < list.length; n++) {
      i = (i + delta + list.length) % list.length;
      if (this.selectable(list[i])) { this.at = i; return; }
    }
  }

  choose(index, cx) {
    const item = this.items?.[index];
    if (!this.selectable(item)) return;
    closeOverlay(props().overlay);
    item.run?.();
  }

  renderMenu() {
    const t = theme();
    const items = this.items = this.menuItems();
    if (!this.selectable(items[this.at])) {
      const first = items.findIndex((it) => this.selectable(it));
      this.at = first >= 0 ? first : 0;
    }
    return v_flex()
      .id("space-group-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.moveChoice(1);
        else if (e.key === "up") this.moveChoice(-1);
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(v_flex().children(items.map((it, i) => {
        if (it.separator) return div().mx(7).my(4).h(1).flex_none().bg(t.border);
        if (it.kind === "label") return div().px(8).pt(7).pb(3).flex_none().text_size(10.5).font_medium().text_color(t.dim).child(it.label.toUpperCase());
        return h_flex()
          .id(`space-group-menu-${i}`)
          .h(31)
          .px(8)
          .gap(9)
          .rounded(7)
          .items_center()
          .text_color(it.danger ? t.blocked : t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(i, cx))
          .child(svg(`mods/workspace-chrome/${it.icon ?? "terminal"}.svg`).size(14).flex_none().text_color(it.danger ? t.blocked : it.checked ? t.accent : t.muted))
          .child(div().flex_1().truncate().child(it.label))
          .when(Boolean(it.keys), (el) => el.child(div().text_size(11).text_color(t.dim).child(it.keys)));
      })));
  }

  submitGroup() {
    const p = props() ?? {};
    const name = (this.input.value() ?? "").trim() || "Group";
    const state = readGroups();
    if (p.action === "rename") {
      const group = state.groups.find((g) => g.id === p.groupId);
      if (group) group.name = name;
    } else {
      const id = newGroupId(state.groups);
      state.groups.push({ id, name, machine: p.machine ?? null, folded: false, before: null });
      if (p.spaceId) state.members[p.spaceId] = id;
    }
    writeGroups(state);
    closeOverlay(p.overlay);
  }

  renderPrompt() {
    const t = theme();
    const p = props() ?? {};
    const rename = p.action === "rename";
    const label = (text) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("space-group-prompt").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(rename ? "Rename group" : "New group"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.focused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().pt(6).text_size(11.5).text_color(t.dim).child(rename ? "The spaces stay where they are." : "Drag spaces onto the group's header, or use a space's menu, to move them in."))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("space-group-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("space-group-save", "Save", true, () => this.submitGroup())));
  }

  render() {
    if (this.mode === "menu") return this.renderMenu();
    if (this.mode === "prompt") return this.renderPrompt();
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    // A closed space leaves its group; a space moved to another machine too.
    const state = readGroups();
    if (sp.length) {
      const byId = new Map(sp.map((p) => [p.id, p]));
      let pruned = false;
      for (const [space, id] of Object.entries(state.members)) {
        const found = byId.get(space);
        const group = state.groups.find((g) => g.id === id);
        if (!found || !group || (found.machine ?? null) !== (group.machine ?? null)) {
          delete state.members[space];
          pruned = true;
        }
      }
      if (pruned) writeGroups(state);
    }
    this.groupState = state;
    // Each space's agents, most urgent first, then most recently changed.
    this.crew = new Map();
    for (const a of agents()) {
      const list = this.crew.get(a.space) ?? [];
      list.push(a);
      this.crew.set(a.space, list);
    }
    for (const list of this.crew.values()) list.sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || y.seq - x.seq);
    const list = this.grouped(t, collapsed);
    // Bring the active space into view when it, or its place in the list, changes; a row already in view stays put.
    const active = sp.find(p => p.active)?.id;
    if (active !== this.revealed || this.activeAt !== this.revealedAt) {
      this.revealed = active;
      this.revealedAt = this.activeAt;
      if (this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
    const newSpace = div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip("New space")
      .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14));
    const newGroup = div().id("space-new-group").size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip("New group")
      .on_click(() => this.promptGroup("new")).child(svg("mods/workspace-chrome/folder-plus.svg").size(14));
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .on_mouse_up("left", (_e, cx) => { this.clearDrag(); cx.notify(); })
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .when(!collapsed, el => el.child(h_flex().gap(2).items_center().child(newGroup).child(newSpace)))
        .when(collapsed, el => el.child(newSpace)))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        // A block above (another mod's) growing, or the window resizing, shrinks this list and can push the active space out.
        .on_size_change((_size, cx) => { if (this.activeAt >= 0) { this.scroll.scroll_to_item(this.activeAt); cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => {
          this.clearDrag();
          cx.notify();
        })
        .children(list));
  }
}
