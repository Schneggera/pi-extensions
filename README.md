# pi-extensions

Extensions for the [pi coding agent](https://github.com/earendil-works/pi). See the [extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).

## manual-mode.ts

Toggles between **MANUAL** and **AUTO** mode for file changes.

- **MANUAL**: every `edit`, `write`, `multi_edit` and file-mutating `bash` command (e.g. `rm`, `mv`, `>`, `git commit`, `npm install`) needs your confirmation. Without a UI (print/json mode) such changes are blocked.
- **AUTO**: normal behavior, no prompts.

Toggle with `/manual` or `Ctrl+Alt+M`, or start in manual mode with `--manual`. The agent can also switch modes via the `set_manual_mode` tool. The mode persists across session resumes; a 🔒 status indicator shows when it's on.

## Installation

Copy the file to one of:

- `~/.pi/agent/extensions/` (global)
- `.pi/extensions/` (per project)

Or try it without installing: `pi -e ./manual-mode.ts`
