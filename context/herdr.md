# Herdr — layout and messaging rules

Inside Herdr (`HERDR_ENV=1`), load the `herdr` skill before creating panes or tabs or sending to another pane. In short: split `right`, never `down`; label every pane you create `<role>·<harness>`; never make a third pane in a tab; stage commands into André's `term` tab without pressing Enter; message another pane only with `herdr-send` (it refuses unless the input box is empty); close what you open and nothing else. Full reference: dotfiles `docs/herdr-conventions.md`.
