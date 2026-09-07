# Calvin

A full-screen, monospaced grid notebook with a compact, expandable tangerine tool panel. Built with vanilla JavaScript and Canvas, with Vite for development and static production builds. No runtime dependencies, accounts, tracking, external fonts, or backend.

## Development

Requires Node.js 22.12+ (or 20.19+).

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`). No domain is needed during development.

```sh
npm test          # Pure model tests
npm run build    # Static site in dist/
npm run preview  # Preview the production build locally
```

Browser checks:

```sh
npx playwright install chromium
npm run test:e2e
```

The browser suite starts and stops its own development server on port 4173. It uses Chromium, including a mobile-sized viewport; physical mobile keyboards and assistive technology should still be checked on real devices.

## Using the grid

- Click any cell and type. One grapheme (including combined characters or emoji) occupies one cell; typing replaces occupied cells.
- **Enter** moves down one row and returns to the column of your last click.
- **Tab** advances exactly three cells, leaving skipped cells untouched.
- **Arrow keys** move the cursor without changing the starting column.
- **Backspace** moves left and clears that cell; at column zero it does nothing. **Delete** clears the current cell.
- **⌘/Ctrl + Z** undoes typing or clearing. **⌘/Ctrl + Shift + Z** or **Ctrl + Y** redoes.
- **Escape** moves focus to the tool launcher so Tab can navigate controls normally.
- Paste supports multiline text and tabs. A native textarea supports mobile keyboards and IME composition. A keyboard-focusable, read-only transcript exposes occupied text by row and column to assistive technology.
- **Finish grid** or **⌘/Ctrl + Enter** archives the grid and its appearance, then starts a blank draft with the same appearance.
- Finished grids appear newest first. Open one to edit a copy; the original remains unchanged. Replacing a nonempty draft asks for confirmation.

Cells stay **24 × 32 CSS pixels**. The grid viewport is inset two columns (48px) horizontally and two rows (64px) vertically. Scrolling expands the working area; only visible cells are painted, and resizing never reflows saved coordinates. Coordinates are bounded at 100,000 per axis. The tools float over the right side and collapse to a narrow rail (collapsed initially on small screens).

## Appearance

- **Automatic:** local-time light mode from 04:00 inclusive to 20:00 exclusive, dark otherwise. Checked every 30 seconds and when returning to the tab; independent of OS theme.
- **Light:** pure white background, black grid and type.
- **Dark:** pure black background, white grid and type.
- **Custom:** independent paper, line, and text colors. Choose contrasting colors for readability.

Grid lines are one physical pixel on the current display. The launcher keeps its warm, yellow-leaning tangerine color in every mode.

## Storage and future backend

Drafts autosave after 250 ms; finished grids save immediately. Everything is local to this browser and origin under `calvin.grid.v1`. Private browsing, clearing site data, changing domains, and storage quotas can affect persistence. Storage failures are shown explicitly; **Export** downloads a versioned JSON backup of the current draft and all finished grids. Import is not implemented yet.

Idle tabs receive updates from other tabs. If another tab saves while this tab has unsaved changes, saving is paused rather than overwriting the other tab: export this tab's work before reloading. This is conflict detection, not collaborative editing.

`src/model.js` isolates grid operations, validated serialization, and snapshots from the UI (`src/main.js`). Each snapshot has a UUID, ISO timestamp, sparse cell map (`"column,row": "character"`), and appearance settings. A future authenticated API can store these snapshots in PostgreSQL JSONB or a document database; no database or credentials are required now.

## Deployment

Run `npm run build` and deploy `dist/` to any static host. The default build targets a domain root. Configure Vite's `base` if hosting beneath a subpath. Use HTTPS in production. No domain-specific settings are currently hardcoded.
