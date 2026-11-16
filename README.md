# sheys-herdr-app-mods

Mods for the [Herdr](https://herdr.dev) desktop app.

## sidebar-rail

A `herdr-rail` layout: Herdr's main layout, except the folded sidebar is a rail of tiles instead of numbers. Spaces show as their colored avatars (hover for name, branch and `⌃N` shortcut; right-click for the space menu), agents as their program's icon. A working agent's tile glows and breathes in the working color, one that needs you breathes faster in red with a `!` badge, and one that finished unseen stays lit with a dot. A pill on the left edge marks the shown space and focused agent, and a bar over the agents splits them by status.

The sidebar button (and the rail's expand button) folds and unfolds it with the width sliding there in about 220ms. The brand row and footer are a copy of Herdr's `workspace-chrome` mod (Apache-2.0, `LICENSE-herdr.txt`) whose button asks for that slide; it doesn't follow Herdr's updates to the original.

```sh
curl -fsSL https://raw.githubusercontent.com/muhammad-shameel-ks/sheys-herdr-app-mods/main/sidebar-rail/install.sh | sh
```

It copies the `herdr-rail*` mods and the layout into `~/.config/herdr-app/` and switches to the layout; `ctrl-shift-l` or Settings → Look switches back. Needs `curl`; `HERDR_APP_HOME` selects another Herdr home.

From a checkout: `./sidebar-rail/install.sh`.
