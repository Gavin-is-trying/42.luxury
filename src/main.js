import {
  CELL_WIDTH, CELL_HEIGHT, applyInput, countCells, createDraft,
  draftFromSnapshot, finishDraft, keyFor, parseState, previewText,
  resolveAppearance, serializeState,
} from './model.js';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'calvin.grid.v1';
const frame = $('#grid-frame');
const canvas = $('#grid-canvas');
const context = canvas.getContext('2d');
const scroll = $('#grid-scroll');
const extent = $('#grid-extent');
const input = $('#grid-input');
const launcher = $('#launcher');
let state;
let storageAvailable = true;
let lastStoredValue = null;
let dirty = false;
let storageConflict = false;
try {
  lastStoredValue = localStorage.getItem(STORAGE_KEY);
  state = parseState(lastStoredValue);
} catch {
  state = parseState(null);
  storageAvailable = false;
}
let width = 0;
let height = 0;
let worldWidth = 0;
let worldHeight = 0;
let framePending = false;
let saveTimer;
let toastTimer;
let composing = false;
let hasInteracted = countCells(state.draft.cells) > 0;
let undoStack = [];
let redoStack = [];
let theme = resolveAppearance(state.draft.appearance);

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}

function saveNow() {
  clearTimeout(saveTimer);
  if (!dirty) return storageAvailable;
  try {
    if (storageConflict || localStorage.getItem(STORAGE_KEY) !== lastStoredValue) {
      reportConflict();
      return false;
    }
    const serialized = serializeState(state);
    localStorage.setItem(STORAGE_KEY, serialized);
    lastStoredValue = serialized;
    dirty = false;
    storageAvailable = true;
    $('#save-status').textContent = 'Saved on this device';
    $('#save-status').dataset.error = 'false';
    return true;
  } catch {
    storageAvailable = false;
    $('#save-status').textContent = 'Not saved — export a backup';
    $('#save-status').dataset.error = 'true';
    return false;
  }
}

function reportConflict() {
  storageConflict = true;
  storageAvailable = false;
  $('#save-status').textContent = 'Changed in another tab — export, then reload';
  $('#save-status').dataset.error = 'true';
  toast('Another tab saved changes. Export this tab’s work before reloading; it will not overwrite the other tab.');
}

function updateAccessibleText() {
  const entries = Object.entries(state.draft.cells)
    .map(([key, text]) => ({ position: key.split(',').map(Number), text }))
    .sort((a, b) => a.position[1] - b.position[1] || a.position[0] - b.position[0]);
  const lines = [];
  let previous;
  for (const { position: [col, row], text } of entries) {
    if (previous && previous.row === row && previous.col + 1 === col) {
      lines[lines.length - 1] += text;
    } else {
      lines.push(`Row ${row + 1}, column ${col + 1}: ${text}`);
    }
    previous = { col, row };
  }
  $('#grid-transcript').value = lines.join('\n') || 'The grid is empty.';
}

function scheduleSave() {
  dirty = true;
  updateAccessibleText();
  if (storageConflict) return;
  $('#save-status').textContent = storageAvailable ? 'Saving…' : 'Not saved — export a backup';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

function updateExtent() {
  extent.style.width = `${worldWidth}px`;
  extent.style.height = `${worldHeight}px`;
}

function resetExtent() {
  let maxCol = state.draft.cursor.col;
  let maxRow = state.draft.cursor.row;
  for (const key of Object.keys(state.draft.cells)) {
    const [col, row] = key.split(',').map(Number);
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
  }
  worldWidth = Math.max(width * 3, (maxCol + 12) * CELL_WIDTH);
  worldHeight = Math.max(height * 3, (maxRow + 12) * CELL_HEIGHT);
  updateExtent();
}

function requestDraw() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => { framePending = false; draw(); });
}

function resize() {
  width = frame.clientWidth;
  height = frame.clientHeight;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  worldWidth = Math.max(worldWidth, width * 3);
  worldHeight = Math.max(worldHeight, height * 3);
  updateExtent();
  if (document.activeElement === input) revealCursor();
  requestDraw();
}

function draw() {
  const left = scroll.scrollLeft;
  const top = scroll.scrollTop;
  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);
  const startCol = Math.floor(left / CELL_WIDTH);
  const startRow = Math.floor(top / CELL_HEIGHT);
  const endCol = Math.ceil((left + width) / CELL_WIDTH);
  const endRow = Math.ceil((top + height) / CELL_HEIGHT);
  const { col, row } = state.draft.cursor;
  const cursorX = col * CELL_WIDTH - left;
  const cursorY = row * CELL_HEIGHT - top;

  if (hasInteracted) {
    context.fillStyle = theme.isDark ? '#634614' : '#ffe6b5';
    context.fillRect(cursorX, cursorY, CELL_WIDTH, CELL_HEIGHT);
  }

  // One physical pixel keeps the pure black/white lines fine on high-DPI screens.
  const ratio = window.devicePixelRatio || 1;
  context.lineWidth = 1 / ratio;
  context.strokeStyle = theme.grid;
  const crisp = (position) => (Math.round(position * ratio) + 0.5) / ratio;
  context.beginPath();
  for (let column = startCol; column <= endCol; column++) {
    const x = crisp(column * CELL_WIDTH - left);
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let line = startRow; line <= endRow; line++) {
    const y = crisp(line * CELL_HEIGHT - top);
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();

  context.fillStyle = theme.text;
  context.font = '17px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (let line = startRow; line <= endRow; line++) {
    for (let column = startCol; column <= endCol; column++) {
      const character = state.draft.cells[keyFor(column, line)];
      if (character) {
        context.fillText(character, column * CELL_WIDTH - left + CELL_WIDTH / 2,
          line * CELL_HEIGHT - top + CELL_HEIGHT / 2 + 1, CELL_WIDTH - 4);
      }
    }
  }
  if (hasInteracted) {
    context.strokeStyle = '#d68913';
    context.lineWidth = 2;
    context.strokeRect(cursorX + 1, cursorY + 1, CELL_WIDTH - 2, CELL_HEIGHT - 2);
    if (document.activeElement === input) {
      context.fillStyle = theme.text;
      context.fillRect(cursorX + 5, cursorY + 8, 1.5, CELL_HEIGHT - 16);
    }
  }
  input.style.left = `${Math.max(0, Math.min(width - CELL_WIDTH, cursorX))}px`;
  input.style.top = `${Math.max(0, Math.min(height - CELL_HEIGHT, cursorY))}px`;
  $('#coordinates').textContent = `COL ${String(col + 1).padStart(2, '0')} / ROW ${String(row + 1).padStart(2, '0')}`;
  const cell = state.draft.cells[keyFor(col, row)];
  input.setAttribute('aria-label', `Grid editor. Row ${row + 1}, column ${col + 1}. ${cell ? `Contains ${cell}.` : 'Blank cell.'}`);
  $('#empty-hint').hidden = hasInteracted || countCells(state.draft.cells) > 0;
}

function revealCursor() {
  const x = state.draft.cursor.col * CELL_WIDTH;
  const y = state.draft.cursor.row * CELL_HEIGHT;
  worldWidth = Math.max(worldWidth, x + width);
  worldHeight = Math.max(worldHeight, y + height);
  updateExtent();
  if (x < scroll.scrollLeft) scroll.scrollLeft = x;
  else if (x + CELL_WIDTH > scroll.scrollLeft + scroll.clientWidth) {
    scroll.scrollLeft = x + CELL_WIDTH - scroll.clientWidth;
  }
  if (y < scroll.scrollTop) scroll.scrollTop = y;
  else if (y + CELL_HEIGHT > scroll.scrollTop + scroll.clientHeight) {
    scroll.scrollTop = y + CELL_HEIGHT - scroll.clientHeight;
  }
}

function rememberDraft() {
  undoStack.push(state.draft);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}

function dispatch(action) {
  if (!['click', 'move', 'tab', 'enter'].includes(action.type)) rememberDraft();
  state.draft = applyInput(state.draft, action);
  hasInteracted = true;
  revealCursor();
  requestDraw();
  scheduleSave();
}

function updateAppearance() {
  theme = resolveAppearance(state.draft.appearance);
  document.documentElement.style.setProperty('--paper', theme.background);
  document.documentElement.style.setProperty('--ink', theme.text);
  document.documentElement.style.setProperty('--muted', theme.isDark ? '#a0a0a0' : '#686868');
  document.documentElement.style.colorScheme = theme.isDark ? 'dark' : 'light';
  $('meta[name="theme-color"]').content = theme.background;
  const { mode } = state.draft.appearance;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  $('#custom-colors').hidden = mode !== 'custom';
  $('#theme-indicator').textContent = mode === 'auto' ? 'LOCAL TIME' : 'YOUR CHOICE';
  $('#theme-description').textContent = {
    auto: 'Light from 4 am to 8 pm. Dark after hours.',
    light: 'Pure white paper. Fine black lines.',
    dark: 'Pure black paper. Fine white lines.',
    custom: 'Your paper, your lines, your type.',
  }[mode];
  for (const name of ['background', 'grid', 'text']) {
    $(`#color-${name}`).value = state.draft.appearance[name];
  }
  requestDraw();
}

function setExpanded(expanded) {
  launcher.classList.toggle('expanded', expanded);
  $('#launcher-panel').inert = !expanded;
  const toggle = $('#toggle-launcher');
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', expanded ? 'Collapse tools' : 'Expand tools');
  toggle.title = expanded ? 'Collapse tools' : 'Expand tools';
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

function renderHistory() {
  const list = $('#history-list');
  list.replaceChildren();
  $('#history-count').textContent = String(state.history.length).padStart(2, '0');
  $('#history-dot').hidden = !state.history.length;
  if (!state.history.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    const icon = document.createElement('span');
    icon.textContent = '▤';
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('p');
    title.textContent = 'Nothing finished. No rush.';
    const subtitle = document.createElement('small');
    subtitle.textContent = 'Your grids will collect here, newest first.';
    empty.append(icon, title, subtitle);
    list.append(empty);
    return;
  }
  for (const snapshot of state.history) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const open = document.createElement('button');
    open.className = 'history-open';
    const preview = document.createElement('span');
    preview.className = 'history-preview';
    preview.textContent = previewText(snapshot.cells);
    const meta = document.createElement('span');
    meta.className = 'history-meta';
    meta.textContent = `${dateFormatter.format(new Date(snapshot.createdAt))} · ${countCells(snapshot.cells)} cells`;
    open.title = 'Open a copy of this grid, including its appearance';
    open.append(preview, meta);
    open.addEventListener('click', () => openSnapshot(snapshot));
    const remove = document.createElement('button');
    remove.className = 'history-delete';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete finished grid: ${preview.textContent}`);
    remove.addEventListener('click', () => {
      if (!confirm('Delete this finished grid? This cannot be undone.')) return;
      state.history = state.history.filter((entry) => entry.id !== snapshot.id);
      renderHistory();
      dirty = true;
      saveNow();
      $('#history-title').focus();
    });
    item.append(open, remove);
    list.append(item);
  }
}

function freshDraft(appearance) {
  state.draft = { ...createDraft(), appearance: { ...appearance } };
  undoStack = [];
  redoStack = [];
  hasInteracted = false;
  scroll.scrollTo(0, 0);
  resetExtent();
  input.value = '';
  input.blur();
  requestDraw();
}

function finishGrid() {
  consumeInput();
  state.history.unshift(finishDraft(state.draft));
  freshDraft(state.draft.appearance);
  renderHistory();
  updateAccessibleText();
  setExpanded(true);
  $('#finish-grid').focus();
  dirty = true;
  const saved = saveNow();
  toast(saved ? 'Grid finished. A fresh space is ready.' : 'Grid kept in memory only. Export a backup before leaving.');
}

function openSnapshot(snapshot) {
  if (countCells(state.draft.cells) && !confirm('Replace your current draft with a copy of this grid? Cancel and finish your draft first to keep it.')) return;
  state.draft = draftFromSnapshot(snapshot);
  undoStack = [];
  redoStack = [];
  hasInteracted = countCells(state.draft.cells) > 0;
  resetExtent();
  const first = Object.keys(state.draft.cells).map((key) => key.split(',').map(Number))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  if (first) state.draft = applyInput(state.draft, { type: 'click', col: first[0], row: first[1] });
  scroll.scrollTo(0, 0);
  revealCursor();
  updateAppearance();
  scheduleSave();
  if (window.innerWidth < 760) setExpanded(false);
  toast('Opened a copy. The finished original stays unchanged.');
}

function consumeInput() {
  if (composing || !input.value) return;
  const text = input.value;
  input.value = '';
  dispatch({ type: 'text', text });
}

// The native textarea supplies paste, IME composition, and mobile keyboard input.
input.addEventListener('input', (event) => { if (!event.isComposing) consumeInput(); });
input.addEventListener('compositionstart', () => {
  composing = true;
  input.classList.add('composing');
});
input.addEventListener('compositionend', () => {
  composing = false;
  input.classList.remove('composing');
  consumeInput();
});
input.addEventListener('beforeinput', (event) => {
  if (composing || event.isComposing) return;
  const action = {
    deleteContentBackward: 'backspace', deleteContentForward: 'delete',
    insertLineBreak: 'enter', insertParagraph: 'enter',
  }[event.inputType];
  if (action && event.cancelable) {
    event.preventDefault();
    dispatch({ type: action });
  }
});
input.addEventListener('focus', () => { hasInteracted = true; requestDraw(); });
input.addEventListener('blur', requestDraw);
input.addEventListener('keydown', (event) => {
  if (composing || event.isComposing || event.keyCode === 229) return;
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && ['z', 'y'].includes(event.key.toLowerCase())) {
    event.preventDefault();
    const redo = event.key.toLowerCase() === 'y' || event.shiftKey;
    const source = redo ? redoStack : undoStack;
    const target = redo ? undoStack : redoStack;
    if (source.length) {
      target.push(state.draft);
      state.draft = source.pop();
      updateAppearance();
      revealCursor();
      scheduleSave();
    }
    return;
  }
  if (modifier || event.altKey) return;
  const actions = {
    Enter: { type: 'enter' }, Tab: { type: 'tab' }, Backspace: { type: 'backspace' },
    Delete: { type: 'delete' }, ArrowLeft: { type: 'move', dx: -1, dy: 0 },
    ArrowRight: { type: 'move', dx: 1, dy: 0 }, ArrowUp: { type: 'move', dx: 0, dy: -1 },
    ArrowDown: { type: 'move', dx: 0, dy: 1 }, Home: { type: 'home' }, End: { type: 'end' },
  };
  if (event.key === 'Escape') {
    event.preventDefault();
    $('#toggle-launcher').focus();
  } else if (actions[event.key]) {
    event.preventDefault();
    dispatch(actions[event.key]);
  }
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing && !composing) {
    event.preventDefault();
    finishGrid();
  }
});

scroll.addEventListener('click', (event) => {
  const rect = scroll.getBoundingClientRect();
  if (event.clientX - rect.left >= scroll.clientWidth || event.clientY - rect.top >= scroll.clientHeight) return;
  consumeInput();
  dispatch({ type: 'click',
    col: Math.floor((event.clientX - rect.left + scroll.scrollLeft) / CELL_WIDTH),
    row: Math.floor((event.clientY - rect.top + scroll.scrollTop) / CELL_HEIGHT),
  });
  input.focus({ preventScroll: true });
});
scroll.addEventListener('scroll', () => {
  if (scroll.scrollLeft + width * 1.5 > worldWidth) worldWidth += Math.max(width * 2, CELL_WIDTH);
  if (scroll.scrollTop + height * 1.5 > worldHeight) worldHeight += Math.max(height * 2, CELL_HEIGHT);
  updateExtent();
  requestDraw();
}, { passive: true });

$('#toggle-launcher').addEventListener('click', () => setExpanded(!launcher.classList.contains('expanded')));
$('#rail-history').addEventListener('click', () => {
  setExpanded(true);
  $('#history-title').focus();
  $('#history-title').scrollIntoView({ block: 'nearest' });
});
$('#finish-grid').addEventListener('click', finishGrid);
$('#rail-finish').addEventListener('click', finishGrid);
$('#clear-grid').addEventListener('click', () => {
  if (!confirm('Clear the current draft? Finished grids will stay safe.')) return;
  rememberDraft();
  state.draft = { ...createDraft(), appearance: { ...state.draft.appearance } };
  hasInteracted = false;
  scroll.scrollTo(0, 0);
  resetExtent();
  scheduleSave();
  requestDraw();
  toast('Draft cleared. Click the grid and use ⌘/Ctrl + Z to undo.');
});
document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    rememberDraft();
    state.draft = { ...state.draft, appearance: { ...state.draft.appearance, mode: button.dataset.mode } };
    updateAppearance();
    scheduleSave();
  });
});
for (const name of ['background', 'grid', 'text']) {
  $(`#color-${name}`).addEventListener('input', (event) => {
    state.draft = { ...state.draft, appearance: { ...state.draft.appearance, [name]: event.target.value } };
    updateAppearance();
    scheduleSave();
  });
}
$('#export-grids').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([serializeState(state)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `calvin-grids-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup exported. Keep it somewhere safe.');
});
$('#grid-transcript').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') $('#toggle-launcher').focus();
});
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  if (dirty) {
    clearTimeout(saveTimer);
    reportConflict();
    return;
  }
  lastStoredValue = event.newValue;
  state = parseState(event.newValue);
  undoStack = [];
  redoStack = [];
  hasInteracted = countCells(state.draft.cells) > 0;
  resetExtent();
  revealCursor();
  updateAppearance();
  updateAccessibleText();
  renderHistory();
});
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveNow();
  else updateAppearance();
});
setInterval(updateAppearance, 30_000);
new ResizeObserver(resize).observe(frame);
window.addEventListener('resize', resize);
$('#finish-shortcut').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ ↵' : 'Ctrl ↵';
setExpanded(window.innerWidth >= 760);
resize();
resetExtent();
revealCursor();
updateAppearance();
updateAccessibleText();
renderHistory();
if (!storageAvailable) {
  $('#save-status').textContent = 'Storage unavailable — export a backup';
  $('#save-status').dataset.error = 'true';
  toast('Browser storage is unavailable. Export your grids before leaving.');
}
