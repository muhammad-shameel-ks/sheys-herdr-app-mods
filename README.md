# sheys-herdr-app-mods

Mods for the [Herdr](https://herdr.dev) desktop app.

## omp-icon

Shows [omp](https://omp.sh/)'s colored icon for omp agents in the sidebar, tab pills and pane headers (overriding Herdr's monochrome built-in glyph), and ensures omp is in the tab bar's + menu under "Start an agent".

```sh
curl -fsSL https://raw.githubusercontent.com/muhammad-shameel-ks/sheys-herdr-app-mods/main/omp-icon/install.sh | sh
```

It copies `omp.svg` to `~/.config/herdr-app/program-icons/` and merges an `omp` entry into `~/.config/herdr-app/programs.json`, keeping your other entries. Herdr applies it live. Needs `jq` and `curl`; `HERDR_APP_HOME` selects another Herdr home.

From a checkout: `./omp-icon/install.sh`.

## sidebar-rail

A `herdr-rail` layout: Herdr's main layout, except the folded sidebar is a rail of tiles instead of numbers. Spaces show as their colored avatars (hover for name, branch and `⌃N` shortcut; right-click for the space menu), agents as their program's icon. A working agent's tile glows and breathes in the working color, one that needs you breathes faster in red with a `!` badge, and one that finished unseen stays lit with a dot. A pill on the left edge marks the shown space and focused agent, and a bar over the agents splits them by status.

The sidebar button (and the rail's expand button) folds and unfolds it with the width sliding there in about 220ms. The brand row and footer are a copy of Herdr's `workspace-chrome` mod (Apache-2.0, `LICENSE-herdr.txt`) whose button asks for that slide; it doesn't follow Herdr's updates to the original.

In the expanded Spaces list, the folder-plus button makes a named group. Drag a space onto a group's header to move it in, or right-click the space and pick a group; worktrees move with their checkout. Click a header to fold the group, drag it between spaces or groups to reorder the sidebar, right-click it to rename or delete it, and "Remove from group" puts a space back above the groups. Groups live in shared state (`space.groups`); the folded rail stays a flat list, so a folded group never hides a space that needs you. The list is a copy of Herdr's `spaces` mod (Apache-2.0, `LICENSE-herdr.txt`), so it doesn't follow Herdr's updates to the original.

Each row in the expanded Spaces list shows that space's agents right after its name as a stack of round program icons, most urgent first. Up to four fit; past that, three show plus a `+N` chip. One dot on the stack shows the most urgent status (working and needs-you breathe), and hovering the stack lists each agent and its status.

The tab bar opens the `+` menu from the empty middle of the bar: middle-click or right-click anywhere between tabs. Drag a pane by its title and hover a tab in the tab bar: the tab lights up and dropping there moves the pane into it. The outlines follow the live window size, zoom and sidebar width. Moving or swapping panes inside a tab is Herdr's own grip, not this mod. The move uses park and keep so the terminal survives. The tab bar and pane header are copies of Herdr's `tabs` and `pane` mods, so they don't follow Herdr's updates to the originals.

```sh
curl -fsSL https://raw.githubusercontent.com/muhammad-shameel-ks/sheys-herdr-app-mods/main/sidebar-rail/install.sh | sh
```

It copies the `herdr-rail*` mods and the layout into `~/.config/herdr-app/` and switches to the layout; `ctrl-shift-l` or Settings → Look switches back. Needs `curl`; `HERDR_APP_HOME` selects another Herdr home.

From a checkout: `./sidebar-rail/install.sh`.
