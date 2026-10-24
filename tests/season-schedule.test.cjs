const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const bundled = require('../data/champions-seasons.json');

async function setup(stored = {}, game = 'ch', initialCatalog = bundled) {
  let catalog = structuredClone(initialCatalog);
  let watcher;
  let rejectRequest = false;
  let requests = 0;
  const storage = structuredClone(stored);
  const context = vm.createContext({
    console: { ...console, warn() {} },
    window: { location: { pathname: `/${game}/zukan/n1` }, addEventListener() {} },
    document: { readyState: 'loading', addEventListener() {}, createElement() { return {}; } },
    chrome: {
      runtime: { async sendMessage() { requests++; if (rejectRequest) throw new Error('offline'); return { data: structuredClone(catalog) }; } },
      storage: { local: {
        async get() { return structuredClone(storage); },
        async set(values) { Object.assign(storage, structuredClone(values)); },
      } },
    },
    clearTimeout() {}, clearInterval() {},
    setInterval(callback) { watcher = callback; return 1; },
  });
  for (const file of ['season-data.js', 'content.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  const linker = vm.runInContext('new PokeLinker()', context);
  await linker.refreshChampionsSeasons();
  await linker.loadSettings();
  const select = { children: [], appendChild(option) { this.children.push(option); }, replaceChildren() { this.children = []; } };
  linker.elements.seasonSelect = select;
  linker.createSeasonOptions(select);
  linker.startSeasonUpdateWatcher();
  return {
    linker, storage, select, requests: () => requests,
    async update(data) { catalog = data; await watcher(); },
    async disconnect() { rejectRequest = true; await watcher(); },
  };
}

test('published season and regulation labels are displayed without extrapolating future dates', async () => {
  const { linker, select } = await setup();
  assert.equal(await linker.getLatestSeason(), 'M-7');
  assert.deepEqual(select.children.map(option => option.textContent), [
    'M-7(M-C)', 'M-6(M-C)', 'M-5(M-B)', 'M-4(M-B)', 'M-3(M-B)', 'M-2(M-A)', 'M-1(M-A)',
  ]);
  assert.equal(select.value, 'M-7');
  assert.equal(select.children[0].title, '2026-10-07〜2026-11-04（PBDB掲載期間）');
});

test('legacy saved selection survives; CH URLs use the actual PBDB option value', async () => {
  const { linker, storage, select } = await setup({
    battleType: 'double', settingsByGame: { ch: { season: '6' }, sv: { season: '40' } },
  });
  assert.equal(select.value, 'M-6');
  assert.equal(storage.settingsByGame.ch.season, 'M-6');
  assert.equal(storage.settingsByGame.sv.season, '40');
  for (const [battle, rule] of [['single', '0'], ['double', '1']]) {
    linker.settings.battleType = battle;
    assert.equal(linker.buildPBDBUrl({ nationalNumber: '0001', formIndex: '00' }),
      `https://champs.pokedb.tokyo/pokemon/show/0001-00?season=6&rule=${rule}`);
  }
});

test('a new regulation is added while the selected historical season is retained', async () => {
  const { linker, select, update } = await setup({ season: 'M-5' });
  const next = structuredClone(bundled);
  next.updatedAt = '2026-11-04T14:37:00Z';
  next.latest = 'M-8';
  next.seasons.unshift({ id: 'M-8', pbdbSeason: '8', regulation: 'M-D', startDate: '2026-11-04', endDate: '2026-12-09' });
  await update(next);
  assert.equal(linker.currentSeason, 'M-8');
  assert.equal(select.children[0].textContent, 'M-8(M-D)');
  assert.equal(select.value, 'M-5');
});

test('same-season regulation correction is reflected without changing selection', async () => {
  const { select, update } = await setup();
  const corrected = structuredClone(bundled);
  corrected.seasons[0].regulation = 'M-D';
  await update(corrected);
  assert.equal(select.children[0].textContent, 'M-7(M-D)');
  assert.equal(select.value, 'M-7');
});

test('network failure and malformed updates preserve the usable list', async () => {
  const { linker, select, update, disconnect } = await setup();
  await update({ ...bundled, seasons: [] });
  await disconnect();
  assert.equal(linker.currentSeason, 'M-7');
  assert.equal(select.children.length, 7);
  assert.equal(select.value, 'M-7');
});

test('unpublished saved season is normalized to the confirmed current season', async () => {
  const { storage, select } = await setup({ season: 'M-99' });
  assert.equal(select.value, 'M-7');
  assert.equal(storage.settingsByGame.ch.season, 'M-7');
});

test('an unavailable background worker at startup cannot erase a saved historical selection', async () => {
  const { storage, select, update } = await setup({ season: 'M-5' }, 'ch', null);
  assert.equal(storage.season, 'M-5');
  assert.equal(select.children.length, 0);
  await update(bundled);
  assert.equal(select.value, 'M-5');
  assert.equal(storage.season, 'M-5');
});

test('SV keeps its fixed list, selection and URL without requesting the feed', async () => {
  const { linker, select, requests } = await setup({ battleType: 'single', settingsByGame: { sv: { season: '40' } } }, 'sv');
  assert.equal(await linker.getLatestSeason(), '41');
  assert.equal(select.children[0].textContent, '41~(I)');
  assert.equal(select.children.length, 41);
  assert.equal(select.value, '40');
  assert.equal(requests(), 0);
  assert.equal(linker.buildPBDBUrl({ nationalNumber: '0741', formIndex: '01' }),
    'https://sv.pokedb.tokyo/pokemon/show/0741-01?season=40&rule=0');
});
