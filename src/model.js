export const CELL_WIDTH = 24;
export const CELL_HEIGHT = 32;

const MAX_COORDINATE = 100_000;
const MAX_PREVIEW_LENGTH = 10_000;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const modes = new Set(['auto', 'light', 'dark', 'custom']);
const cellKey = /^(0|[1-9]\d{0,5}),(0|[1-9]\d{0,5})$/;
const colorPattern = /^#[0-9a-f]{6}$/i;

export function defaultAppearance() {
  return { mode: 'auto', background: '#ffffff', grid: '#000000', text: '#000000' };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeAppearance(appearance) {
  const result = defaultAppearance();
  if (!isRecord(appearance)) return result;
  if (modes.has(appearance.mode)) result.mode = appearance.mode;
  for (const name of ['background', 'grid', 'text']) {
    if (typeof appearance[name] === 'string' && colorPattern.test(appearance[name])) {
      result[name] = appearance[name].toLowerCase();
    }
  }
  return result;
}

function isDarkColor(color) {
  const channels = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  // The luminance where black and white have equal WCAG contrast.
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 < 0.179;
}

export function resolveAppearance(appearance, date = new Date()) {
  const theme = sanitizeAppearance(appearance);
  if (theme.mode === 'custom') {
    return {
      background: theme.background,
      grid: theme.grid,
      text: theme.text,
      isDark: isDarkColor(theme.background),
    };
  }
  const hour = date.getHours();
  const isDark = theme.mode === 'dark' || (theme.mode === 'auto' && !(hour >= 4 && hour < 20));
  return {
    background: isDark ? '#000000' : '#ffffff',
    grid: isDark ? '#ffffff' : '#000000',
    text: isDark ? '#ffffff' : '#000000',
    isDark,
  };
}

export function createDraft() {
  return {
    cells: {},
    appearance: defaultAppearance(),
    cursor: { col: 0, row: 0 },
    anchorCol: 0,
  };
}

export function keyFor(col, row) {
  return `${col},${row}`;
}

function coordinate(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_COORDINATE, Math.max(0, Math.trunc(value)))
    : 0;
}

function validCellValue(value) {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) {
    return false;
  }
  const iterator = segmenter.segment(value)[Symbol.iterator]();
  iterator.next();
  return iterator.next().done;
}

function sanitizeCells(cells) {
  const result = {};
  if (!isRecord(cells)) return result;
  for (const [key, value] of Object.entries(cells)) {
    if (!cellKey.test(key)) continue;
    const [col, row] = key.split(',').map(Number);
    if (col <= MAX_COORDINATE && row <= MAX_COORDINATE && validCellValue(value)) {
      result[key] = value;
    }
  }
  return result;
}

function sanitizeDraft(draft) {
  if (!isRecord(draft)) return createDraft();
  return {
    cells: sanitizeCells(draft.cells),
    appearance: sanitizeAppearance(draft.appearance),
    cursor: {
      col: coordinate(draft.cursor?.col),
      row: coordinate(draft.cursor?.row),
    },
    anchorCol: coordinate(draft.anchorCol),
  };
}

export function applyInput(draft, action) {
  const next = sanitizeDraft(draft);
  const enter = () => {
    next.cursor.row = coordinate(next.cursor.row + 1);
    next.cursor.col = next.anchorCol;
  };
  const tab = () => {
    next.cursor.col = coordinate(next.cursor.col + 3);
  };
  switch (action?.type) {
    case 'click':
      next.cursor = { col: coordinate(action.col), row: coordinate(action.row) };
      next.anchorCol = next.cursor.col;
      break;
    case 'text':
      if (typeof action.text !== 'string') break;
      for (const { segment } of segmenter.segment(action.text)) {
        if (segment === '\r\n' || segment === '\n' || segment === '\r') {
          enter();
        } else if (segment === '\t') {
          tab();
        } else if (validCellValue(segment)) {
          next.cells[keyFor(next.cursor.col, next.cursor.row)] = segment;
          next.cursor.col = coordinate(next.cursor.col + 1);
        }
      }
      break;
    case 'enter':
      enter();
      break;
    case 'tab':
      tab();
      break;
    case 'backspace':
      if (next.cursor.col > 0) {
        next.cursor.col -= 1;
        delete next.cells[keyFor(next.cursor.col, next.cursor.row)];
      }
      break;
    case 'delete':
      delete next.cells[keyFor(next.cursor.col, next.cursor.row)];
      break;
    case 'move':
      next.cursor.col = coordinate(next.cursor.col + finiteDelta(action.dx));
      next.cursor.row = coordinate(next.cursor.row + finiteDelta(action.dy));
      break;
  }
  return next;
}

function finiteDelta(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

export function finishDraft(draft, now = new Date(), id = globalThis.crypto.randomUUID()) {
  return {
    id,
    createdAt: now.toISOString(),
    cells: { ...draft.cells },
    appearance: { ...draft.appearance },
  };
}

export function draftFromSnapshot(snapshot) {
  return sanitizeDraft({ cells: snapshot?.cells, appearance: snapshot?.appearance });
}

export function countCells(cells) {
  return Object.keys(sanitizeCells(cells)).length;
}

export function previewText(cells, maxLength = 70) {
  const limit = typeof maxLength === 'number' && Number.isFinite(maxLength)
    ? Math.min(MAX_PREVIEW_LENGTH, Math.max(0, Math.trunc(maxLength)))
    : 70;
  const entries = Object.entries(sanitizeCells(cells))
    .filter(([, text]) => text.trim().length > 0)
    .map(([key, text]) => ({ ...positionFor(key), text }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
  if (entries.length === 0) return 'Untitled grid';

  let result = '';
  let previous;
  for (const entry of entries) {
    // O(occupied cells + output length), never O(largest coordinate).
    const gap = previous ? (previous.row === entry.row ? entry.col - previous.col - 1 : 1) : 0;
    result += ' '.repeat(Math.min(gap, limit - result.length));
    if (result.length + entry.text.length > limit) break;
    result += entry.text;
    previous = entry;
    if (result.length >= limit) break;
  }
  return result.trimEnd();
}

function positionFor(key) {
  const [col, row] = key.split(',').map(Number);
  return { col, row };
}

function emptyState() {
  return { version: 1, draft: createDraft(), history: [] };
}

function sanitizeState(state) {
  if (!isRecord(state) || state.version !== 1 || !isRecord(state.draft) || !Array.isArray(state.history)) {
    return emptyState();
  }
  const history = [];
  for (const snapshot of state.history) {
    if (!isRecord(snapshot) || typeof snapshot.id !== 'string' || !snapshot.id.trim()
      || typeof snapshot.createdAt !== 'string' || !snapshot.createdAt.trim()
      || !isRecord(snapshot.cells) || !isRecord(snapshot.appearance)) continue;
    const timestamp = Date.parse(snapshot.createdAt);
    if (!Number.isFinite(timestamp)) continue;
    history.push({
      id: snapshot.id,
      createdAt: new Date(timestamp).toISOString(),
      cells: sanitizeCells(snapshot.cells),
      appearance: sanitizeAppearance(snapshot.appearance),
    });
  }
  history.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { version: 1, draft: sanitizeDraft(state.draft), history };
}

export function serializeState(state) {
  // Callers may keep only draft/history in memory; the persisted schema is always versioned.
  return JSON.stringify(sanitizeState({ version: 1, draft: state?.draft, history: state?.history }));
}

export function parseState(serialized) {
  try {
    if (typeof serialized !== 'string') return emptyState();
    return sanitizeState(JSON.parse(serialized));
  } catch {
    return emptyState();
  }
}
