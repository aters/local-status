# Local Status

Local Status is a macOS desktop app for working with multiple Git repositories
in one folder.

![Repository changes with a side-by-side Monaco comparison](./docs/screenshots/repositories.png)

![Interactive repository terminals](./docs/screenshots/services.png)

## Features

- Direct-child repository discovery
- Working changes, commits, file trees, and incoming/outgoing status
- Side-by-side and inline Monaco diffs
- Fetch and Fetch all
- Interactive terminals and detected package scripts
- Saved custom service profiles

Repository data, terminal output, paths, and settings stay on your machine.
There are no accounts, telemetry, or hosted services.

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
changed file opens a Monaco comparison.

Use **New terminal** to open a shell in a repository. **Run script** lists
scripts detected from `package.json`. The Services screen keeps running
sessions available while you move between repositories.

The Git interface is read-only except for Fetch. It does not expose stage,
discard, commit, checkout, merge, pull, rebase, push, or similar actions.
Terminals are unrestricted local shells, so only run commands from repositories
you trust.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+P` | Focus repository search |
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

## License

[MIT](./LICENSE)
