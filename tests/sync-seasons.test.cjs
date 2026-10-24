const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { parseSeasons, syncSeasons, MIN_INTERVAL_MS } = require('../scripts/sync-seasons.cjs');
const previous = require('../data/champions-seasons.json');
const html = fs.readFileSync(path.join(__dirname, 'fixtures/pbdb-season-select.html'), 'utf8');
const now = new Date('2026-10-25T02:37:00Z');
const success = body => new Response(body, { headers: { 'content-type': 'text/html' } });

test('the actual PBDB select provides IDs, historical dates, regulations and current selection', () => {
  const result = parseSeasons(html, now);
  assert.equal(result.latest, 'M-7');
  assert.deepEqual(result.seasons, previous.seasons);
  assert.equal(result.seasons.find(s => s.id === 'M-5').endDate, '2026-09-09');
});

test('a preannounced higher option does not become current until PBDB selects it', () => {
  const result = parseSeasons(html.replace('</select>', '<option value="8">シーズンM-8 (M-D) 2026/11/4 - 2026/12/9</option></select>'), now);
  assert.equal(result.latest, 'M-7');
  assert.equal(result.seasons[0].id, 'M-8');
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
    '<html>challenge</html>', html.replace(/selected/, ''), html.replace('value="7"', 'value="99"'),
    html.replace('2026/11/4', '2026/11/31'), html.replace(/<option value="1">[\s\S]*?<\/option>/, ''),
  ]) {
    const result = await syncSeasons({ previous, now, fetchImpl: async () => success(bad) });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.state.blocked, true);
    assert.deepEqual(result.catalog, previous);
  }
});
