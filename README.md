# Local Status

Local Status is a private, local-first macOS desktop workspace for teams and
developers who keep several Git repositories in one folder. Choose a workspace
once, then inspect working changes, commits, files and running development
services without uploading repository data anywhere.

## Highlights

- Discovers direct-child Git repositories without requiring the workspace root
  to be a repository.
- Shows branch, staged and unstaged changes, conflicts, untracked files, and
  incoming/outgoing commits.
- Uses Monaco for read-only side-by-side and inline comparisons with syntax
  highlighting and synchronized scrolling.
- Runs interactive repository terminals with Xterm and a real macOS PTY.
- Detects npm, pnpm, Yarn and Bun scripts from each repository.
- Saves optional service profiles locally for non-Node commands.
- Keeps paths, file contents, terminal output and settings on this machine.

![Repository changes with a side-by-side Monaco comparison](./docs/screenshots/repositories.png)

![Interactive repository services and terminal sessions](./docs/screenshots/services.png)

Local Status does not include telemetry, accounts, cloud storage, GitHub
integration or a hosted backend. The Git UI is read-only except for explicit
`fetch` operations. Terminals are unrestricted local shells and can run any
command you type.

## Requirements

- macOS
- Node.js 22.13 or newer
- npm
- Git
- Xcode Command Line Tools

Install the command-line tools if needed:

```bash
xcode-select --install
```

They are required because `node-pty` is a native module compiled for Electron.

## Install and run

```bash
git clone <your-local-status-repository-url>
cd local-status
npm install
npm start
```

`npm install` rebuilds `node-pty` for the pinned Electron runtime. `npm start`
builds the renderer and opens the desktop application.

On first launch:

1. Select **Choose workspace**.
2. Pick a folder whose immediate children are Git repositories.
3. Select a repository and open a changed file, commit or file-tree entry.

The selected workspace and a bounded recent-workspace list are stored under
Electron's macOS user-data folder. Local Status never writes configuration into
the selected workspace or its repositories.

## Repository workspace

The repository screen has three resizable panels:

1. searchable repository navigator;
2. Changes, Commits and Files context;
3. Monaco comparison or commit details.

Working-tree comparisons use index versus working tree. Staged comparisons use
HEAD versus index. New, deleted, renamed, conflicted and committed files use
their appropriate original and modified models. Binary files and files larger
than the preview limit show safe placeholders.

Fetch and Fetch all update remote-tracking references only. Local Status does
not provide stage, discard, commit, checkout, merge, pull, rebase or push
buttons.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+P` | Focus repository search |
| `Enter` | Open the focused repository or file |
| `F7` | Next diff change |
| `Shift+F7` | Previous diff change |

## Services and terminals

Use **New terminal** from a repository or the Services screen to open the
default login shell in that repository. **Run script** executes a detected
package script with an executable and argument array rather than shell string
interpolation.

Service profiles store:

- display name;
- repository;
- executable;
- argument list;
- working subdirectory within the repository.

Profiles do not store environment variables or secrets. Existing `.env` files
and normal shell configuration continue to work as they do in a regular
terminal.

The Services screen keeps up to 2 MB of output per session in memory, supports
search and resize, and stops managed sessions before changing workspace or
quitting. Its system-listener panel is a read-only `lsof` snapshot; a listening
port is not an application health check.

## Privacy and security

- The renderer is sandboxed with Node integration disabled.
- A context-isolated preload exposes a narrow, typed IPC API.
- Every renderer request is sender-validated.
- Repository and file paths resolve through main-process allowlists.
- Git uses argument arrays, output caps and timeouts.
- Terminal links only open validated localhost HTTP/HTTPS URLs after a click.
- No remote content is loaded and navigation/new windows are blocked.

Terminals intentionally provide the same authority as commands run in your
normal macOS shell. Only start scripts from repositories you trust.

## Development

```bash
npm run dev
npm run build
npm test
npm run lint
npm run test:e2e
```

`npm run test:e2e` builds the app and launches Electron against disposable Git
fixture repositories. Tests do not modify the user's selected workspace.

Architecture:

- `electron/` — native window, IPC, settings, workspace and PTY management;
- `server/` — local Git parsing and comparison service used by Electron;
- `src/` — sandboxed React renderer, Monaco and Xterm UI;
- `tests/` — disposable Git, settings, terminal and Electron integration tests.

## Troubleshooting

### `node-pty` fails to install

Confirm the Xcode command-line tools are available:

```bash
xcode-select -p
npm run postinstall
```

### A workspace is empty

Only immediate child folders that are Git roots are included. Nested
repositories are intentionally ignored. The selected workspace root is also
excluded even when it has its own `.git` directory.

### A service does not appear healthy

Local Status reports whether its managed terminal is running and which local
ports are listening. It does not infer application-level health. Use the
terminal output or the service's own health endpoint.

## License

[MIT](./LICENSE)
