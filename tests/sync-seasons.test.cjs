const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { parseSeasons, syncSeasons, MIN_INTERVAL_MS } = require('../scripts/sync-seasons.cjs');
const previous = require('../data/champions-seasons.json');
const { validateUpdate } = require('../season-data.js');
const html = fs.readFileSync(path.join(__dirname, 'fixtures/pbdb-season-select.html'), 'utf8');
const now = new Date('2026-10-25T02:37:00Z');
const success = body => new Response(body, { headers: { 'content-type': 'text/html' } });
// 11/4に確認した「M-8掲載済み、selectedはM-7のまま」を再現する。
const m8Html = html.replace('<option value="7" selected>',
  '<option value="8">シーズンM-8 (M-C) 2026/11/4 - 2026/12/2</option><option value="7" selected>');

test('the actual PBDB select provides IDs, historical dates, regulations and latest started season', () => {
  const result = parseSeasons(html, now);
  assert.equal(result.latest, '7');
  assert.deepEqual(validateUpdate(result, previous).seasons, previous.seasons);
  assert.equal(result.seasons.find(s => s.id === '5').endDate, '2026-09-09');
});

test('a preannounced higher option does not become current before its start', () => {
  const result = parseSeasons(html.replace('</select>', '<option value="8">シーズンM-8 (M-D) 2026/11/4 - 2026/12/9</option></select>'), now);
  assert.equal(result.latest, '7');
  assert.equal(result.seasons.at(-1).id, '8');
});

test('M-8 becomes latest at 11:00 JST despite M-7 remaining selected', async () => {
  for (const [date, latest] of [
    ['2026-11-04T00:00:00+09:00', '7'],
    ['2026-11-04T10:59:59.999+09:00', '7'],
    ['2026-11-04T11:00:00+09:00', '8'],
    ['2026-11-04T01:59:59.999Z', '7'],
    ['2026-11-04T02:00:00Z', '8'],
    ['2026-11-03T18:00:00-08:00', '8'],
    ['2026-11-04T21:08:00+09:00', '8'],
  ]) {
    let requests = 0;
    const result = await syncSeasons({ previous, now: new Date(date), fetchImpl: async () => { requests++; return success(m8Html); } });
    assert.equal(result.outcome, 'updated', date);
    assert.equal(result.catalog.latest, latest, date);
    assert.equal(result.catalog.seasons[0].name, 'M-8');
    assert.equal(requests, 1);
  }
});

test('selected attributes are irrelevant, including missing, multiple and future selections', () => {
  const at = new Date('2026-11-04T21:08:00+09:00');
  for (const source of [m8Html, m8Html.replace(/ selected/g, ''), m8Html.replace('value="8"', 'value="8" selected')]) {
    assert.equal(parseSeasons(source, at).latest, '8');
  }
  const futureSelected = m8Html.replace(/ selected/g, '').replace('</select>',
    '<option value="9" selected>シーズンM-9 (M-D) 2026/12/2 - 2026/12/30</option></select>');
  assert.equal(parseSeasons(futureSelected, at).latest, '8');
});

test('start date determines latest regardless of option order or numbering', () => {
  const source = m8Html.replace('value="8"', 'value="series-z-1"').replace('シーズンM-8', 'シーズンZ-1');
  const options = [...source.matchAll(/<option\b[^>]*>[\s\S]*?<\/option>/g)].map(match => match[0]);
  const reversed = `<select name="season">${options.reverse().join('')}</select>`;
  const result = parseSeasons(reversed, new Date('2026-11-04T11:00:00+09:00'));
  assert.equal(result.latest, 'series-z-1');
  assert.equal(result.seasons.at(-1).name, 'Z-1');
});

test('latest is corrected when M-8 was already published with a stale latest value', async () => {
  const stale = validateUpdate(parseSeasons(m8Html, new Date('2026-11-04T10:59:59+09:00')), previous);
  assert.equal(stale.latest, '7');
  const result = await syncSeasons({ previous: stale, now: new Date('2026-11-04T21:08:00+09:00'), fetchImpl: async () => success(m8Html) });
  assert.equal(result.outcome, 'updated');
  assert.equal(result.catalog.latest, '8');
  assert.deepEqual(result.catalog.seasons, stale.seasons);
});

test('missing later seasons are never invented even after the last published end date', () => {
  const result = parseSeasons(m8Html, new Date('2027-01-01T11:00:00+09:00'));
  assert.equal(result.latest, '8');
  assert.equal(result.seasons.length, 8);
});

test('no started season or an ambiguous latest start date retains the previous catalog', async () => {
  const futureOnly = '<select name="season"><option value="9" selected>シーズンM-9 (M-D) 2026/12/2 - 2026/12/30</option></select>';
  const tied = m8Html.replace('</select>',
    '<option value="another-series">シーズンZ-1 (Z-A) 2026/11/4 - 2026/12/2</option></select>');
  for (const source of [futureOnly, tied]) {
    const result = await syncSeasons({ previous, now: new Date('2026-11-04T21:08:00+09:00'), fetchImpl: async () => success(source) });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.state.blocked, true);
    assert.deepEqual(result.catalog, previous);
  }
});

test('season and regulation names are independent of both prefix and option value', async () => {
  for (const [name, regulation] of [['Z-1', 'Z-A'], ['1', 'A'], ['新シリーズ 第1期', '特別ルール2027']]) {
    const renamed = html.replace('シーズンM-7', `シーズン${name}`).replace('(M-C)', `(${regulation})`);
    const result = await syncSeasons({ previous, now, fetchImpl: async () => success(renamed) });
    assert.equal(result.outcome, 'updated');
    assert.equal(result.catalog.latest, '7');
    assert.equal(result.catalog.seasons[0].name, name);
    assert.equal(result.catalog.seasons[0].regulation, regulation);
    assert.deepEqual(result.catalog.seasons[0].legacyIds, ['M-7']);
  }
});

test('HTML entities and full-width parentheses are read as plain display text', () => {
  const renamed = html.replace('シーズンM-7', 'シーズンX&amp;Y').replace('(M-C)', '（ルール&#x41;+）');
  const result = parseSeasons(renamed, now);
  assert.equal(result.seasons[0].name, 'X&Y');
  assert.equal(result.seasons[0].regulation, 'ルールA+');
});

test('non-numeric option values and reset numbering do not change start-date selection', () => {
  const nextHtml = html.replace(/ selected/g, '').replace('</select>',
    '<option value="series-z-1" selected>シーズンZ-1 (特別ルール) 2026/11/4 - 2026/12/9</option></select>');
  const next = validateUpdate(parseSeasons(nextHtml, new Date('2026-11-04T11:00:00+09:00')), previous);
  assert.equal(next.latest, 'series-z-1');
  assert.equal(next.seasons.at(-1).name, 'Z-1');
});

test('a successful check makes one request and preserves unchanged catalog timestamps', async () => {
  const calls = [];
  const result = await syncSeasons({ previous, now, fetchImpl: async (...args) => { calls.push(args); return success(html); } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://champs.pokedb.tokyo/pokemon/list');
  assert.equal(calls[0][1].redirect, 'error');
  assert.equal(result.outcome, 'unchanged');
  assert.equal(result.catalog.updatedAt, previous.updatedAt);
  assert.equal(result.state.nextCheckAt, '2026-10-25T14:37:00.000Z');
});

test('403 stops future automated requests until resumed after cooldown', async () => {
  let count = 0;
  const fetchImpl = async () => { count++; return new Response('', { status: 403 }); };
  const result = await syncSeasons({ previous, now, fetchImpl });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.state.blocked, true);
  assert.deepEqual(result.catalog, previous);
  const later = new Date(now.getTime() + 2 * MIN_INTERVAL_MS);
  assert.equal((await syncSeasons({ previous, state: result.state, now: later, fetchImpl })).outcome, 'blocked');
  await syncSeasons({ previous, state: result.state, now: later, resume: true, fetchImpl });
  assert.equal(count, 2);
});

test('429 respects Retry-After seconds and HTTP-date, including manual invocations', async () => {
  for (const header of ['172800', 'Tue, 27 Oct 2026 02:37:00 GMT']) {
    let count = 0;
    const fetchImpl = async () => { count++; return new Response('', { status: 429, headers: { 'retry-after': header } }); };
    const result = await syncSeasons({ previous, now, fetchImpl });
    assert.equal(result.state.nextCheckAt, '2026-10-27T02:37:00.000Z');
    const skipped = await syncSeasons({ previous, state: result.state, now: new Date(now.getTime() + MIN_INTERVAL_MS), resume: true, fetchImpl });
    assert.equal(skipped.outcome, 'cooldown');
    assert.equal(count, 1);
  }
});

test('500 and timeout do not retry; both retain data and wait at least 12 hours', async () => {
  for (const fail of [async () => new Response('', { status: 500 }), async () => { throw new Error('timeout'); }]) {
    let count = 0;
    const fetchImpl = async () => { count++; return fail(); };
    const result = await syncSeasons({ previous, now, fetchImpl });
    assert.equal(result.outcome, 'failed');
    assert.deepEqual(result.catalog, previous);
    const skipped = await syncSeasons({ previous, state: result.state, now, fetchImpl });
    assert.equal(skipped.outcome, 'cooldown');
    assert.equal(count, 1);
  }
});

test('layout changes, missing history, invalid dates and mismatched IDs never replace the feed', async () => {
  for (const bad of [
    '<html>challenge</html>', html.replace('value="7"', 'value="99"'),
    html.replace('2026/11/4', '2026/11/31'), html.replace(/<option value="1">[\s\S]*?<\/option>/, ''),
  ]) {
    const result = await syncSeasons({ previous, now, fetchImpl: async () => success(bad) });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.state.blocked, true);
    assert.deepEqual(result.catalog, previous);
  }
});
