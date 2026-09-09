const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');

async function setup(now, stored = {}, game = 'ch') {
  let timestamp = Date.parse(now);
  let watcher;
  const storage = structuredClone(stored);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [timestamp])); }
    static now() { return timestamp; }
  }
  const context = vm.createContext({
    Date: Clock,
    console,
    window: { location: { pathname: `/${game}/zukan/n1` }, addEventListener() {} },
    document: {
      readyState: 'loading',
      addEventListener() {},
      createElement() { return {}; },
    },
    chrome: { storage: { local: {
      async get() { return structuredClone(storage); },
      async set(values) { Object.assign(storage, structuredClone(values)); },
    } } },
    clearInterval() {},
    setInterval(callback) { watcher = callback; return 1; },
  });
  vm.runInContext(`${source}\nglobalThis.linker = new PokeLinker();`, context);
  await new Promise(setImmediate);
  const linker = context.linker;
  const select = {
    children: [],
    appendChild(option) { this.children.push(option); },
    replaceChildren() { this.children = []; },
  };
  linker.elements.seasonSelect = select;
  linker.createSeasonOptions(select);
  return {
    linker, storage, select,
    async advance(date) { timestamp = Date.parse(date); await watcher(); },
  };
}

test('M-6 starts at 11:00 JST; subsequent seasons start every 28 days', async () => {
  for (const [date, expected] of [
    ['2026-09-09T10:59:59.999+09:00', 'M-5'],
    ['2026-09-09T11:00:00+09:00', 'M-6'],
    ['2026-10-07T10:59:59.999+09:00', 'M-6'],
    ['2026-10-07T11:00:00+09:00', 'M-7'],
    ['2026-11-04T10:59:59.999+09:00', 'M-7'],
    ['2026-11-04T11:00:00+09:00', 'M-8'],
    ['2027-01-27T11:00:00+09:00', 'M-11'],
  ]) {
    const { linker, select } = await setup(date);
    assert.equal(await linker.getLatestSeason(), expected, date);
    assert.equal(select.children[0].value, expected, date);
    assert.equal(select.children[0].textContent, `${expected}(${expected === 'M-5' ? 'M-B' : 'M-C'})`);
    assert.equal(select.children.length, Number(expected.slice(2)));
  }
});

test('dropdown removes premature M-7 and preserves historical regulation labels', async () => {
  const { select } = await setup('2026-09-09T12:00:00+09:00');
  assert.deepEqual(select.children.map(option => option.textContent), [
    'M-6(M-C)', 'M-5(M-B)', 'M-4(M-B)', 'M-3(M-B)', 'M-2(M-A)', 'M-1(M-A)',
  ]);
  assert.equal(select.value, 'M-6');
});

test('saved M-7 becomes M-6, URLs use the corrected season, SV setting survives', async () => {
  const { linker, storage, select } = await setup('2026-09-09T12:00:00+09:00', {
    battleType: 'double', settingsByGame: { ch: { season: 'M-7' }, sv: { season: '40' } },
  });
  assert.equal(select.value, 'M-6');
  assert.equal(storage.settingsByGame.ch.season, 'M-6');
  assert.equal(storage.settingsByGame.sv.season, '40');
  for (const [battle, rule] of [['single', '0'], ['double', '1']]) {
    linker.settings.battleType = battle;
    assert.equal(linker.buildPBDBUrl({ nationalNumber: '0001', formIndex: '00' }),
      `https://champs.pokedb.tokyo/pokemon/show/0001-00?season=M-6&rule=${rule}`);
  }
});

test('valid saved historical selection is retained', async () => {
  const { select } = await setup('2026-09-09T12:00:00+09:00', { season: 'M-5' });
  assert.equal(select.value, 'M-5');
});

test('open page gains M-7 at the boundary while retaining the selected season', async () => {
  const { linker, select, advance } = await setup('2026-10-07T10:59:59+09:00');
  linker.startSeasonUpdateWatcher();
  await advance('2026-10-07T11:00:00+09:00');
  assert.equal(linker.currentSeason, 'M-7');
  assert.equal(select.children[0].textContent, 'M-7(M-C)');
  assert.equal(select.value, 'M-6');
});

test('SV stays at season 41 and keeps its saved selection', async () => {
  const { linker, select } = await setup('2026-11-04T11:00:00+09:00', {
    settingsByGame: { sv: { season: '40' }, ch: { season: 'M-6' } },
  }, 'sv');
  assert.equal(await linker.getLatestSeason(), '41');
  assert.equal(select.children[0].textContent, '41~(I)');
  assert.equal(select.children.length, 41);
  assert.equal(select.value, '40');
});
