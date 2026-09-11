import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CELL_WIDTH,
  CELL_HEIGHT,
  defaultAppearance,
  resolveAppearance,
  createDraft,
  keyFor,
  applyInput,
  finishDraft,
  draftFromSnapshot,
  countCells,
  previewText,
  serializeState,
  parseState,
} from '../src/model.js';

function input(draft, type, properties = {}) {
  return applyInput(draft, { type, ...properties });
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function snapshot(id, createdAt, cells = { '0,0': 'A' }) {
  return { id, createdAt, cells, appearance: defaultAppearance() };
}

function persisted(overrides = {}) {
  return JSON.stringify({ version: 1, draft: createDraft(), history: [], ...overrides });
}

const light = { background: '#ffffff', grid: '#000000', text: '#000000', isDark: false };
const dark = { background: '#000000', grid: '#ffffff', text: '#ffffff', isDark: true };

test('dimensions, key format, and fresh default objects', () => {
  assert.equal(CELL_WIDTH, 24);
  assert.equal(CELL_HEIGHT, 32);
  assert.equal(keyFor(12, 34), '12,34');
  assert.deepEqual(defaultAppearance(), {
    mode: 'auto', background: '#ffffff', grid: '#000000', text: '#000000',
  });
  const first = createDraft();
  assert.deepEqual(first, {
    cells: {}, appearance: defaultAppearance(), cursor: { col: 0, row: 0 }, anchorCol: 0,
  });
  const second = createDraft();
  first.cells['0,0'] = 'X';
  first.appearance.background = '#123456';
  first.cursor.col = 3;
  assert.deepEqual(second, createDraft());
  assert.notStrictEqual(defaultAppearance(), defaultAppearance());
});

test('text writes cells, advances cursor, and overwrites existing cells', () => {
  let draft = input(createDraft(), 'text', { text: 'abc' });
  assert.deepEqual(draft.cells, { '0,0': 'a', '1,0': 'b', '2,0': 'c' });
  assert.deepEqual(draft.cursor, { col: 3, row: 0 });
  draft = input(draft, 'move', { dx: -2, dy: 0 });
  draft = input(draft, 'text', { text: 'Z ' });
  assert.deepEqual(draft.cells, { '0,0': 'a', '1,0': 'Z', '2,0': ' ' });
  assert.equal(countCells(draft.cells), 3);
});

test('combining marks, emoji, flags, and ZWJ sequences occupy one cell each', () => {
  const graphemes = ['e\u0301', '👩🏽‍💻', '🇧🇪', '👨‍👩‍👧‍👦', 'क', '😀'];
  const draft = input(createDraft(), 'text', { text: graphemes.join('') });
  assert.deepEqual(Object.values(draft.cells), graphemes);
  assert.deepEqual(draft.cursor, { col: graphemes.length, row: 0 });
});

test('click establishes the Enter anchor and moves do not change it', () => {
  let draft = input(createDraft(), 'click', { col: 7, row: 4 });
  assert.equal(draft.anchorCol, 7);
  draft = input(draft, 'text', { text: 'abc' });
  draft = input(draft, 'move', { dx: -9, dy: 2 });
  assert.equal(draft.anchorCol, 7);
  assert.deepEqual(draft.cursor, { col: 1, row: 6 });
  draft = input(draft, 'enter');
  assert.deepEqual(draft.cursor, { col: 7, row: 7 });
  draft = input(draft, 'click', { col: 2, row: 1 });
  draft = input(draft, 'enter');
  assert.deepEqual(draft.cursor, { col: 2, row: 2 });
  assert.equal(draft.anchorCol, 2);
});

test('pasted LF, CRLF, and CR each perform one anchored Enter', () => {
  const draft = input(input(createDraft(), 'click', { col: 3, row: 2 }), 'text', {
    text: 'a\r\nb\nc\rd\n\nE',
  });
  assert.deepEqual(draft.cells, {
    '3,2': 'a', '3,3': 'b', '3,4': 'c', '3,5': 'd', '3,7': 'E',
  });
  assert.deepEqual(draft.cursor, { col: 4, row: 7 });
  assert.equal(draft.anchorCol, 3);
});

test('tabs advance exactly three, not to a tab stop, without deleting cells', () => {
  let draft = input(createDraft(), 'text', { text: 'abcdefg' });
  draft = input(draft, 'click', { col: 1, row: 0 });
  const cells = { ...draft.cells };
  draft = input(draft, 'tab');
  assert.deepEqual(draft.cursor, { col: 4, row: 0 });
  assert.deepEqual(draft.cells, cells);
  draft = input(draft, 'text', { text: '\tZ' });
  assert.deepEqual(draft.cells, { ...cells, '7,0': 'Z' });
  assert.deepEqual(draft.cursor, { col: 8, row: 0 });
  assert.equal(draft.anchorCol, 1);
});

test('backspace moves left and deletes, including cells left of the anchor', () => {
  let draft = input(createDraft(), 'text', { text: 'abc' });
  draft = input(draft, 'click', { col: 2, row: 0 });
  draft = input(draft, 'backspace');
  assert.deepEqual(draft.cursor, { col: 1, row: 0 });
  assert.deepEqual(draft.cells, { '0,0': 'a', '2,0': 'c' });
  assert.equal(draft.anchorCol, 2);
  draft = input(draft, 'backspace');
  assert.deepEqual(draft.cursor, { col: 0, row: 0 });
  assert.deepEqual(draft.cells, { '2,0': 'c' });
});

test('backspace at column zero neither deletes nor wraps to the previous row', () => {
  const draft = { ...createDraft(), cells: { '0,1': 'A', '3,0': 'B' }, cursor: { col: 0, row: 1 } };
  assert.deepEqual(input(draft, 'backspace'), draft);
});

test('delete clears only the cursor cell without moving', () => {
  const draft = {
    ...createDraft(), cells: { '1,2': 'A', '2,2': 'B' }, cursor: { col: 1, row: 2 }, anchorCol: 5,
  };
  const next = input(draft, 'delete');
  assert.deepEqual(next.cells, { '2,2': 'B' });
  assert.deepEqual(next.cursor, draft.cursor);
  assert.equal(next.anchorCol, 5);
  assert.deepEqual(input(next, 'delete'), next);
});

test('home moves cursor to column 0 of current row', () => {
  let draft = input(createDraft(), 'click', { col: 5, row: 3 });
  draft = input(draft, 'home');
  assert.deepEqual(draft.cursor, { col: 0, row: 3 });
  assert.equal(draft.anchorCol, 5); // anchor should not change
});

test('end moves cursor to rightmost occupied cell of current row or column 0 if row is empty', () => {
  // Test with empty row
  let draft = input(createDraft(), 'click', { col: 5, row: 3 });
  draft = input(draft, 'end');
  assert.deepEqual(draft.cursor, { col: 0, row: 3 });
  
  // Test with occupied cells
  draft = input(createDraft(), 'text', { text: 'ABC' });
  draft = input(draft, 'click', { col: 1, row: 0 });
  draft = input(draft, 'end');
  assert.deepEqual(draft.cursor, { col: 2, row: 0 });
  
  // Test with multiple rows
  draft = { ...createDraft(), cells: { '1,2': 'A', '5,2': 'B', '3,2': 'C', '2,4': 'D' } };
  draft = input(draft, 'click', { col: 0, row: 2 });
  draft = input(draft, 'end');
  assert.deepEqual(draft.cursor, { col: 5, row: 2 });
  
  assert.equal(draft.anchorCol, 0); // anchor should not change
});

test('movement clamps negative coordinates, ignores invalid deltas, and keeps anchor', () => {
  const max = input(createDraft(), 'click', { col: 1e100, row: 1e100 });
  assert.deepEqual(max.cursor, { col: 100_000, row: 100_000 });
  assert.equal(max.anchorCol, 100_000);
  for (const type of ['enter', 'tab', 'text', 'move']) {
    const next = input(max, type, { text: 'A', dx: Number.MAX_VALUE, dy: Number.MAX_VALUE });
    assert.deepEqual(next.cursor, max.cursor);
  }
  assert.deepEqual(input(createDraft(), 'click', { col: NaN, row: Infinity }).cursor, { col: 0, row: 0 });
});

test('every input action is immutable, even unknown and empty actions', () => {
  const draft = freeze({
    cells: { '0,0': 'A', '1,0': 'B' }, appearance: defaultAppearance(),
    cursor: { col: 1, row: 0 }, anchorCol: 1,
  });
  const before = JSON.stringify(draft);
  for (const action of [
    { type: 'click', col: 4, row: 5 }, { type: 'text', text: 'X\nY\tZ' },
    { type: 'enter' }, { type: 'tab' }, { type: 'backspace' }, { type: 'delete' },
    { type: 'move', dx: 2, dy: 3 }, { type: 'unknown' }, { type: 'text', text: '' },
    { type: 'text', text: null }, null,
  ]) {
    const next = applyInput(draft, action);
    assert.notStrictEqual(next, draft);
    assert.notStrictEqual(next.cells, draft.cells);
    assert.notStrictEqual(next.appearance, draft.appearance);
    assert.notStrictEqual(next.cursor, draft.cursor);
    assert.equal(JSON.stringify(draft), before);
  }
});

test('unsupported control characters are not persisted as cells', () => {
  const draft = input(createDraft(), 'text', { text: 'A\u0000\u0007\u007fB' });
  assert.deepEqual(draft.cells, { '0,0': 'A', '1,0': 'B' });
});

for (const [hour, minute, second, millisecond, expected] of [
  [0, 0, 0, 0, dark], [3, 59, 59, 999, dark], [4, 0, 0, 0, light],
  [12, 0, 0, 0, light], [19, 59, 59, 999, light], [20, 0, 0, 0, dark], [23, 59, 59, 999, dark],
]) {
  test(`auto appearance at local ${hour}:${minute}:${second}.${millisecond}`, () => {
    assert.deepEqual(
      resolveAppearance(defaultAppearance(), new Date(2026, 8, 6, hour, minute, second, millisecond)),
      expected,
    );
  });
}

test('explicit light/dark themes are pure inverses independent of time and custom colors', () => {
  for (const hour of [2, 12, 22]) {
    const date = new Date(2026, 8, 6, hour);
    const appearance = { background: '#123456', grid: '#abcdef', text: '#654321' };
    assert.deepEqual(resolveAppearance({ ...appearance, mode: 'light' }, date), light);
    assert.deepEqual(resolveAppearance({ ...appearance, mode: 'dark' }, date), dark);
  }
});

test('custom themes validate six-digit colors and derive darkness from background luminance', () => {
  const appearance = freeze({ mode: 'custom', background: '#102030', grid: '#AbCdEf', text: '#FEDCBA' });
  assert.deepEqual(resolveAppearance(appearance), {
    background: '#102030', grid: '#abcdef', text: '#fedcba', isDark: true,
  });
  assert.equal(appearance.grid, '#AbCdEf');
  assert.equal(resolveAppearance({ ...appearance, background: '#eeeeee' }).isDark, false);
  for (const invalid of ['red', '#fff', '#12345678', '#zzzzzz', ' #123456', '#123456\n', null, 123456, {}]) {
    assert.deepEqual(resolveAppearance({ mode: 'custom', background: invalid, grid: invalid, text: invalid }), light);
  }
});

test('missing or invalid appearance falls back to auto defaults', () => {
  const date = new Date(2026, 8, 6, 12);
  for (const appearance of [undefined, null, [], {}, { mode: 'other' }]) {
    assert.deepEqual(resolveAppearance(appearance, date), light);
  }
});

test('finishing a draft copies cells and appearance with an exact timestamp and id', () => {
  const draft = input(createDraft(), 'text', { text: 'Hi' });
  const now = new Date('2026-09-06T12:34:56.789Z');
  const saved = finishDraft(freeze(draft), now, 'snapshot-1');
  assert.deepEqual(saved, {
    id: 'snapshot-1', createdAt: '2026-09-06T12:34:56.789Z',
    cells: { '0,0': 'H', '1,0': 'i' }, appearance: defaultAppearance(),
  });
  saved.cells['0,0'] = 'X';
  saved.appearance.mode = 'dark';
  assert.equal(draft.cells['0,0'], 'H');
  assert.equal(draft.appearance.mode, 'auto');
  assert.equal(now.toISOString(), '2026-09-06T12:34:56.789Z');
});

test('snapshot defaults generate a UUID and current ISO date', () => {
  const before = Date.now();
  const saved = finishDraft(createDraft());
  assert.match(saved.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.ok(Date.parse(saved.createdAt) >= before);
  assert.ok(Date.parse(saved.createdAt) <= Date.now());
});

test('restoring a snapshot clones its contents and resets cursor and anchor', () => {
  const original = input(input(createDraft(), 'click', { col: 5, row: 6 }), 'text', { text: 'A' });
  const saved = freeze(finishDraft(original, new Date('2026-09-06T12:00:00Z'), 'id'));
  const draft = draftFromSnapshot(saved);
  assert.deepEqual(draft.cells, saved.cells);
  assert.deepEqual(draft.appearance, saved.appearance);
  assert.deepEqual(draft.cursor, { col: 0, row: 0 });
  assert.equal(draft.anchorCol, 0);
  draft.cells['5,6'] = 'B';
  draft.appearance.mode = 'dark';
  assert.equal(saved.cells['5,6'], 'A');
  assert.equal(saved.appearance.mode, 'auto');
  assert.deepEqual(draftFromSnapshot(null), createDraft());
});

test('later draft edits cannot mutate saved snapshots', () => {
  const draft = input(createDraft(), 'text', { text: 'A' });
  const saved = finishDraft(draft, new Date('2026-09-06T12:00:00Z'), 'id');
  draft.cells['0,0'] = 'B';
  draft.appearance.mode = 'dark';
  assert.equal(saved.cells['0,0'], 'A');
  assert.equal(saved.appearance.mode, 'auto');
});

test('preview uses numeric reading order, horizontal gaps, and a space between occupied rows', () => {
  assert.equal(previewText({ '10,10': 'D', '4,2': 'B', '2,2': 'A', '8,10': 'C' }), 'A B C D');
  assert.equal(previewText({ '10,0': 'B', '2,0': 'A' }), 'A       B');
  assert.equal(previewText({ '0,10': 'B', '0,2': 'A' }), 'A B');
  assert.equal(previewText({ '0,0': 'A', '1,0': ' ', '2,0': 'B' }), 'A B');
});

test('preview fallback covers empty, whitespace-only, and invalid cells', () => {
  for (const cells of [{}, null, [], { '4,5': ' ' }, { bad: 'A', '0,0': 'abc' }]) {
    assert.equal(previewText(cells), 'Untitled grid');
  }
});

test('preview caps output without splitting graphemes or allocating huge coordinate gaps', () => {
  const cells = {};
  for (let col = 0; col < 80; col += 1) cells[keyFor(col, 0)] = 'A';
  assert.equal(previewText(cells), 'A'.repeat(70));
  assert.equal(previewText(cells, 5), 'AAAAA');
  assert.equal(previewText(cells, 0), '');
  assert.equal(previewText(cells, -10), '');
  assert.equal(previewText(cells, NaN).length, 70);
  assert.equal(previewText({ '0,0': 'A', '100000,0': 'B' }, 6), 'A');
  assert.equal(previewText({ '100000,100000': 'Z', '999999999999,0': 'X' }), 'Z');
  assert.equal(previewText({ '0,0': '😀', '1,0': 'B' }, 2), '😀');
  assert.equal(previewText({ '0,0': 'e\u0301', '1,0': 'B' }, 1), '');
});

test('state serializes only version/draft/history and round-trips a valid draft and snapshots', () => {
  let draft = input(createDraft(), 'click', { col: 4, row: 8 });
  draft = input(draft, 'text', { text: 'e\u0301😀\nB' });
  draft.appearance = { mode: 'custom', background: '#123456', grid: '#abcdef', text: '#fedcba' };
  const state = freeze({
    draft, history: [finishDraft(draft, new Date('2026-09-06T12:00:00Z'), 'one')], ignored: true,
  });
  const serialized = serializeState(state);
  assert.deepEqual(Object.keys(JSON.parse(serialized)), ['version', 'draft', 'history']);
  const restored = parseState(serialized);
  assert.deepEqual(restored, { version: 1, draft: state.draft, history: state.history });
  restored.draft.cells['4,8'] = 'X';
  restored.history[0].appearance.mode = 'dark';
  assert.equal(state.draft.cells['4,8'], 'e\u0301');
  assert.equal(state.history[0].appearance.mode, 'custom');
});

test('malformed JSON, wrong versions, and invalid top-level schemas never throw', () => {
  for (const serialized of [
    '', '{', 'null', '[]', '42', '"text"', '{}', undefined, null, 42, {},
    persisted({ version: 2 }), persisted({ version: '1' }),
    persisted({ draft: null }), persisted({ draft: [] }), persisted({ history: {} }),
    '{"version":1,"draft":{}}', '{"version":1,"history":[]}',
  ]) {
    assert.deepEqual(parseState(serialized), { version: 1, draft: createDraft(), history: [] });
  }
  const one = parseState('bad');
  one.draft.appearance.mode = 'dark';
  assert.equal(parseState('bad').draft.appearance.mode, 'auto');
});

test('restoration sanitizes keys, graphemes, colors, coordinates, and extra fields', () => {
  const cells = JSON.parse('{"__proto__":"X","constructor":"X","0,0":"A","1,0":"👩🏽‍💻","2,0":"é","3,0":" ","4,0":"ab","5,0":"","6,0":"\\n","7,0":42,"8,0":{},"-1,0":"X","1.5,0":"X","01,0":"X","1e2,0":"X","NaN,0":"X","Infinity,0":"X","100001,0":"X","0,100001":"X","999999999999999999,0":"X","100000,100000":"Z"}');
  const restored = parseState(persisted({ draft: {
    cells,
    appearance: { mode: 'custom', background: '#AbCdEf', grid: '#fff', text: 'red', extra: true },
    cursor: { col: 1e200, row: -5 }, anchorCol: 2.9, extra: true,
  } }));
  assert.deepEqual(restored.draft, {
    cells: { '0,0': 'A', '1,0': '👩🏽‍💻', '2,0': 'é', '3,0': ' ', '100000,100000': 'Z' },
    appearance: { mode: 'custom', background: '#abcdef', grid: '#000000', text: '#000000' },
    cursor: { col: 100_000, row: 0 }, anchorCol: 2,
  });
  assert.equal(Object.getPrototypeOf(restored.draft.cells), Object.prototype);
  assert.equal(countCells(cells), 5);
  assert.equal(countCells(null), 0);
});

test('incomplete drafts and nonnumeric or infinite positions become valid defaults', () => {
  for (const draft of [{}, { cells: [], appearance: [], cursor: null }, {
    cells: false, appearance: { mode: '__proto__' }, cursor: { col: '4', row: {} }, anchorCol: null,
  }]) {
    assert.deepEqual(parseState(persisted({ draft })).draft, createDraft());
  }
  assert.deepEqual(parseState('{"version":1,"draft":{"cursor":{"col":1e999,"row":-1e999},"anchorCol":1e999},"history":[]}').draft, createDraft());
});

test('history sorts newest first by instant, normalizes dates, and preserves ties', () => {
  const old = snapshot('old', '2026-09-01T00:00:00Z');
  const latest = snapshot('latest', '2026-09-06T12:00:00-04:00');
  const middle = snapshot('middle', '2026-09-06T15:00:00Z');
  const tied = snapshot('tied', '2026-09-06T16:00:00Z');
  const restored = parseState(persisted({ history: [old, latest, middle, tied] }));
  assert.deepEqual(restored.history.map(({ id }) => id), ['latest', 'tied', 'middle', 'old']);
  assert.equal(restored.history[0].createdAt, '2026-09-06T16:00:00.000Z');
  const state = freeze({ draft: createDraft(), history: [old, middle, latest] });
  assert.deepEqual(JSON.parse(serializeState(state)).history.map(({ id }) => id), ['latest', 'middle', 'old']);
  assert.deepEqual(state.history.map(({ id }) => id), ['old', 'middle', 'latest']);
});

test('invalid snapshots are dropped while valid snapshots have their contents sanitized', () => {
  const valid = snapshot('valid', '2026-09-06T12:00:00Z', { '0,0': 'A', '1,0': 'bad', '-1,0': 'B' });
  valid.appearance = { mode: 'custom', background: 'invalid', grid: '#112233', text: '#ABCDEF' };
  const restored = parseState(persisted({ history: [
    null, [], {}, { ...valid, id: '' }, { ...valid, id: 42 }, { ...valid, id: '   ' },
    { ...valid, createdAt: 'not a date' }, { ...valid, createdAt: 0 },
    { ...valid, createdAt: '999999-01-01' }, { ...valid, cells: [] },
    { ...valid, appearance: null }, valid,
  ] }));
  assert.deepEqual(restored.history, [{
    id: 'valid', createdAt: '2026-09-06T12:00:00.000Z', cells: { '0,0': 'A' },
    appearance: { mode: 'custom', background: '#ffffff', grid: '#112233', text: '#abcdef' },
  }]);
});

test('serialization sanitizes invalid input and does not leak unrecognized fields', () => {
  assert.deepEqual(parseState(serializeState(null)), { version: 1, draft: createDraft(), history: [] });
  const saved = snapshot('id', '2026-09-06T00:00:00Z');
  saved.extra = 'discard';
  const result = JSON.parse(serializeState({ draft: { ...createDraft(), extra: true }, history: [saved] }));
  assert.equal('extra' in result.draft, false);
  assert.equal('extra' in result.history[0], false);
});
