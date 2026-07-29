# Local Status

Local Status is a macOS desktop app for working with multiple Git repositories
in one folder.

![Repository changes with a side-by-side Monaco comparison](./docs/screenshots/repositories.png)

![Interactive repository terminals](./docs/screenshots/services.png)

## Features

- Direct-child repository discovery
- Working changes, commits, file trees, and incoming/outgoing status
- Side-by-side and inline Monaco diffs with rendered Markdown previews
- Stage, unstage, commit, revert, fetch, and fast-forward-only sync
- Optional commit-message drafts from an installed Codex or Claude CLI
- Interactive terminals and detected package scripts
- Saved custom service profiles

Repository data, terminal output, paths, and settings stay on your machine.
There is no Local Status account, telemetry, or hosted service. If you
explicitly generate a commit message, the staged diff, file names, statistics,
and recent commit subjects are processed through the selected CLI account after
a provider-specific first-use confirmation.

## Requirements

- macOS
- Node.js 22.13+
- npm
- Git
- Xcode Command Line Tools

Install the command-line tools if needed:

```bash
xcode-select --install
```

## Install

```bash
git clone https://github.com/aters/local-status.git
cd local-status
npm install
npm start
```

On first launch, choose a folder whose immediate children are Git repositories.
The workspace folder itself does not need to be a repository.

## Usage

Select a repository to browse its Changes, Commits, or Files. Selecting a
changed file opens a Monaco comparison. Change groups and files expose Stage,
Unstage, and Revert actions. Revert requires confirmation; reverting an
untracked file permanently deletes it.

Commit opens a review window and commits staged changes only. Write the message
yourself or generate an editable draft with Codex CLI or Claude CLI. Choose the
provider and model in the commit window. Local Status does not read or store CLI
credentials.

Generated-message input is capped at a 1 MB patch. If the patch is larger, the
model still receives the complete staged file list, status and statistics, plus
recent commit subjects. Local Status marks the draft as truncated so you can
review it more carefully.

Sync pulls the configured upstream with `--ff-only`, then pushes local commits.
It stops instead of creating an implicit merge when branches have diverged.

Use **New terminal** to open a shell in a repository. **Run script** lists
scripts detected from `package.json`. The Services screen keeps running
sessions available while you move between repositories.

The repository interface does not expose checkout, merge, rebase, or automatic
push controls. Terminals are unrestricted local shells, so only run commands
from repositories you trust.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+P` | Focus repository search |
| `Cmd+Enter` | Commit from the commit window |
| `Enter` | Open the selected repository or file |
| `F7` | Next diff change |
| `Shift+F7` | Previous diff change |

## Development

```bash
npm run dev
npm run build
npm test
npm run lint
npm run test:e2e
```

Project structure:

- `electron/` — Electron main process, IPC, settings, and terminals
- `server/` — Git operations and parsing
- `src/` — React, Monaco, and Xterm interface
- `tests/` — unit, integration, and Electron tests

## Troubleshooting

### `node-pty` fails to install

Confirm the Xcode Command Line Tools are installed, then rebuild:

```bash
xcode-select -p
npm run postinstall
```

### No repositories appear

Local Status scans only immediate child folders. Nested repositories and the
selected workspace root are intentionally excluded.

### AI message generation is unavailable

Install and sign in to the selected CLI, then reopen the commit window:

```bash
codex login
codex login status

claude auth login
claude auth status
```

If Claude is not installed, choose **Install Claude CLI** in the commit window.
Local Status opens a managed terminal, runs Anthropic's native installer, and
then launches Claude so you can finish sign-in. **Locate existing** remains
available for installations in uncommon locations.

## License

[MIT](./LICENSE)
