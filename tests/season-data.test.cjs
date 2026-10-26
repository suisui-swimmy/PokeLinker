const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validate, validateUpdate } = require('../season-data.js');
const bundled = require('../data/champions-seasons.json');
const old = require('./fixtures/champions-seasons-v1.json');

test('v1 migration separates a display name from the stable value without inventing prefixes', () => {
  const result = validate(old);
  assert.deepEqual(result, bundled);
  assert.equal(result.seasons[0].id, '7');
  assert.equal(result.seasons[0].name, 'M-7');
  assert.deepEqual(result.seasons[0].legacyIds, ['M-7']);
});

test('renaming the current season preserves its identity and legacy selection mapping', () => {
  const renamed = structuredClone(bundled);
  renamed.seasons[0].name = '新シーズン1';
  renamed.seasons[0].regulation = 'A+';
  renamed.seasons[0].legacyIds = [];
  const result = validateUpdate(renamed, old);
  assert.equal(result.latest, '7');
  assert.deepEqual(result.seasons[0].legacyIds, ['M-7']);
});

test('a new series can reset display numbering without being rejected as old data', () => {
  const next = structuredClone(bundled);
  next.latest = 'next-series';
  next.seasons.unshift({ id: 'next-series', name: 'Z-1', regulation: 'Z-A', startDate: '2026-11-04', endDate: '2026-12-09' });
  assert.equal(validateUpdate(next, bundled).latest, 'next-series');
});

test('old timestamps, actual current-season rollback and removed history are still rejected', () => {
  for (const modify of [
    data => { data.updatedAt = '2026-01-01T00:00:00Z'; },
    data => { data.latest = '6'; },
    data => { data.seasons.pop(); },
  ]) {
    const bad = structuredClone(bundled);
    modify(bad);
    assert.throws(() => validateUpdate(bad, bundled));
  }
});

test('duplicate IDs, missing names, invalid dates and control characters are still rejected', () => {
  for (const modify of [
    data => { data.seasons[1].id = '7'; },
    data => { delete data.seasons[0].name; },
    data => { data.seasons[0].name = ''; },
    data => { data.seasons[0].regulation = 'A\u0000'; },
    data => { data.seasons[0].startDate = '2026-02-30'; },
    data => { data.seasons[0].legacyIds = 'M-7'; },
  ]) {
    const bad = structuredClone(bundled);
    modify(bad);
    assert.throws(() => validate(bad));
  }
});
