# sheys-herdr-app-mods

Mods for the [Herdr](https://herdr.dev) desktop app.

## omp-icon

Shows [omp](https://omp.sh/)'s icon for omp agents in the sidebar, tab pills and pane headers, where Herdr otherwise draws its generic agent glyph.

```sh
curl -fsSL https://raw.githubusercontent.com/muhammad-shameel-ks/sheys-herdr-app-mods/main/omp-icon/install.sh | sh
```

It copies `omp.svg` to `~/.config/herdr-app/program-icons/` and merges an `omp` entry into `~/.config/herdr-app/programs.json`, keeping your other entries. Herdr applies it live. Needs `jq` and `curl`; `HERDR_APP_HOME` selects another Herdr home.

From a checkout: `./omp-icon/install.sh`.
