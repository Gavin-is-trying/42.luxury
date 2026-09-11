# Calvin (42.luxury) — Agent Instructions

## Product

Calvin is a full-screen, monospaced grid notebook rendered with vanilla
JavaScript and Canvas. Vite is used for development and static builds only.
There are **no runtime dependencies, no frameworks, no accounts, no tracking,
no external fonts, and no backend**. Do not change any of that.

## Architecture

- `src/model.js` — pure grid model: operations, validated serialization,
  snapshots. No DOM, no Canvas, no timers. All logic that can live here
  must live here.
- `src/main.js` — UI: Canvas rendering, input handling, tool panel,
  storage, appearance. Talks to the model; contains no business rules the
  model could own.
- `src/styles.css` — minimal styling for the shell and tool panel.
- `index.html` — single entry point.
- `tests/model.test.js` — pure model tests (`node --test`). No browser.
- `e2e/grid.spec.js` — Playwright browser tests. The config starts its own
  dev server on port 4173.

## Invariants — never violate these

1. Zero runtime dependencies. Never add a package to `dependencies`.
   Adding a devDependency requires an approved issue that explicitly asks
   for it.
2. Cells are exactly 24 × 32 CSS pixels. Grid lines are one physical pixel.
3. The storage key is `calvin.grid.v1`. Never change or migrate it without
   an approved issue; stored user data must always continue to load.
4. One grapheme cluster per cell, including emoji and combining characters.
5. Coordinates are bounded at 100,000 per axis. Resizing never reflows
   saved coordinates.
6. Keyboard behavior in the README (Enter, Tab, arrows, Backspace, Delete,
   undo/redo, Escape, ⌘/Ctrl+Enter) is a contract. Changing it requires an
   approved issue.
7. Accessibility features (native textarea for IME/mobile, read-only
   transcript) must keep working.
8. Light mode is pure white/black; dark mode pure black/white; the
   launcher stays tangerine in every mode.

## Priorities

1. Do not break existing functionality.
2. Preserve the visual language.
3. Prefer the simplest implementation that works.
4. New behavior gets tests: model logic in `tests/`, user-visible behavior
   in `e2e/`.
5. Keep `README.md` accurate when behavior changes.

## Commands

```sh
npm ci                            # install (CI) / npm install locally
npm test                          # pure model tests (fast, no browser)
npm run build                     # static production build into dist/
npx playwright install chromium   # once per environment
npm run test:e2e                  # browser tests (starts own server, port 4173)
npm run dev                       # dev server on 127.0.0.1:5173 (never in CI)
```

Requires Node.js 22.12+ (or 20.19+).

## Development loop

1. Read the assigned GitHub issue completely, including comments.
2. Inspect the relevant code before writing anything.
3. Write a short plan in the PR description.
4. Implement on a branch named `agent/<short-task-name>`.
5. Run `npm test`, then `npm run build`, then `npm run test:e2e`.
6. If Playwright fails, read the failure screenshots before changing code.
7. Fix regressions; rerun the full gate.
8. Commit with a clear message; open a PR referencing the issue.

## Retry limit

If the full test gate has failed after **3** distinct fix attempts, stop.
Push what exists, mark the PR as a draft, apply the `needs-human` label if
possible, and write a comment explaining what was tried and what is still
failing. Do not keep iterating.

## Autonomy

The agent MAY:

- modify code, tests, and documentation
- create `agent/*` branches, commit, and open PRs
- comment on issues and PRs

The agent may NOT:

- merge into `main` (a human always merges)
- add runtime dependencies
- change the storage format or key without an approved issue
- perform architectural rewrites without an approved issue
- modify workflow files, secrets, or repository settings
- delete or rewrite user data handling in ways that could lose stored grids
