# sheys-herdr-app-mods

Mods for the [Herdr](https://herdr.dev) desktop app.

## omp-icon

Shows [omp](https://omp.sh/)'s icon for omp agents in the sidebar, tab pills and pane headers, where Herdr otherwise draws its generic agent glyph, and adds omp to the tab bar's + menu under "Start an agent".

```sh
curl -fsSL https://raw.githubusercontent.com/muhammad-shameel-ks/sheys-herdr-app-mods/main/omp-icon/install.sh | sh
```

It copies `omp.svg` to `~/.config/herdr-app/program-icons/` and merges an `omp` entry into `~/.config/herdr-app/programs.json`, keeping your other entries. Herdr applies it live. Needs `jq` and `curl`; `HERDR_APP_HOME` selects another Herdr home.

From a checkout: `./omp-icon/install.sh`.

## sidebar-rail

A `herdr-rail` layout: Herdr's main layout, except the folded sidebar is a rail of tiles instead of numbers. Spaces show as their colored avatars (hover for name, branch and `⌃N` shortcut; right-click for the space menu), agents as their program's icon. A working agent's tile glows and breathes in the working color, one that needs you breathes faster in red with a `!` badge, and one that finished unseen stays lit with a dot. A pill on the left edge marks the shown space and focused agent, and a bar over the agents splits them by status. The expanded sidebar is Herdr's own.

```sh
curl -fsSL https://raw.githubusercontent.com/muhammad-shameel-ks/sheys-herdr-app-mods/main/sidebar-rail/install.sh | sh
```

It copies the `herdr-rail` mod and layout into `~/.config/herdr-app/` and switches to the layout; `ctrl-shift-l` or Settings → Look switches back. Fold the sidebar with its usual button. Needs `curl`; `HERDR_APP_HOME` selects another Herdr home.

From a checkout: `./sidebar-rail/install.sh`.
