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
  const link = { classList: { add() {}, remove() {} }, removeAttribute(name) { delete this[name]; } };
  linker.elements.pbdbLink = link;
  linker.pokemonInfo = { nationalNumber: '0001', formIndex: '00' };
  linker.createSeasonOptions(select);
  await linker.updatePBDBLink();
  linker.startSeasonUpdateWatcher();
  return {
    linker, storage, select, link, requests: () => requests,
    async update(data) { catalog = data; await watcher(); },
    async disconnect() { rejectRequest = true; await watcher(); },
  };
}

test('published season and regulation labels are displayed without extrapolating future dates', async () => {
  const { linker, select } = await setup();
  assert.equal(await linker.getLatestSeason(), '7');
  assert.deepEqual(select.children.map(option => option.textContent), [
    '最新',
    'M-7(M-C)', 'M-6(M-C)', 'M-5(M-B)', 'M-4(M-B)', 'M-3(M-B)', 'M-2(M-A)', 'M-1(M-A)',
  ]);
  assert.equal(select.value, '7');
  assert.equal(select.children[0].title, '現在: M-7(M-C)');
  assert.equal(select.children[1].title, '2026-10-07〜2026-11-04（PBDB掲載期間）');
});

test('legacy saved selection survives; CH URLs use the actual PBDB option value', async () => {
  const { linker, storage, select } = await setup({
    battleType: 'double', settingsByGame: { ch: { season: '6' }, sv: { season: '40' } },
  });
  assert.equal(select.value, '6');
  assert.equal(storage.settingsByGame.ch.season, '6');
  assert.equal(storage.settingsByGame.sv.season, '40');
  for (const [battle, rule] of [['single', '0'], ['double', '1']]) {
    linker.settings.battleType = battle;
    assert.equal(linker.buildPBDBUrl({ nationalNumber: '0001', formIndex: '00' }),
      `https://champs.pokedb.tokyo/pokemon/show/0001-00?season=6&rule=${rule}`);
  }
});

test('legacy display-name selections migrate to stable PBDB values and survive reload', async () => {
  const first = await setup({ battleType: 'double', settingsByGame: { ch: { season: 'M-6' }, sv: { season: '40' } } });
  assert.equal(first.select.value, '6');
  assert.equal(first.storage.settingsByGame.ch.season, '6');
  const renamed = structuredClone(bundled);
  renamed.seasons.find(s => s.id === '6').name = 'Z-改訂版';
  const second = await setup(first.storage, 'ch', renamed);
  assert.equal(second.select.value, '6');
  assert.equal(second.select.children[2].textContent, 'Z-改訂版(M-C)');
  assert.match(second.linker.buildPBDBUrl({ nationalNumber: '0001', formIndex: '00' }), /season=6&rule=1$/);
  assert.equal(second.storage.settingsByGame.sv.season, '40');
});

test('a source rename still resolves a legacy saved name through the migration aliases', async () => {
  const renamed = structuredClone(bundled);
  renamed.seasons.find(s => s.id === '6').name = '別の名前';
  const { select } = await setup({ season: 'M-6' }, 'ch', renamed);
  assert.equal(select.value, '6');
});

test('a new regulation is added while the selected historical season is retained', async () => {
  const { linker, select, update } = await setup({ season: 'M-5' });
  const next = structuredClone(bundled);
  next.updatedAt = '2026-11-04T14:37:00Z';
  next.latest = 'champions-next';
  next.seasons.unshift({ id: 'champions-next', name: 'Z-1', regulation: '新ルールA+', startDate: '2026-11-04', endDate: '2026-12-09' });
  await update(next);
  assert.equal(linker.currentSeason, 'champions-next');
  assert.equal(select.children[1].textContent, 'Z-1(新ルールA+)');
  assert.equal(select.value, '5');
  linker.settings.season = 'champions-next';
  linker.settings.battleType = 'single';
  assert.match(linker.buildPBDBUrl({ nationalNumber: '0001', formIndex: '00' }), /season=champions-next&rule=0$/);
});

test('same-season regulation correction is reflected without changing selection', async () => {
  const { select, update } = await setup();
  const corrected = structuredClone(bundled);
  corrected.seasons[0].regulation = 'M-D';
  await update(corrected);
  assert.equal(select.children[1].textContent, 'M-7(M-D)');
  assert.equal(select.value, '7');
});

test('network failure and malformed updates preserve the usable list', async () => {
  const { linker, select, update, disconnect } = await setup();
  await update({ ...bundled, seasons: [] });
  await disconnect();
  assert.equal(linker.currentSeason, '7');
  assert.equal(select.children.length, 8);
  assert.equal(select.value, '7');
});

test('unpublished saved season is normalized to the confirmed current season', async () => {
  const { storage, select } = await setup({ season: 'M-99' });
  assert.equal(select.value, '7');
  assert.equal(storage.settingsByGame.ch.season, '7');
});

test('an unavailable background worker at startup cannot erase a saved historical selection', async () => {
  const { storage, select, update } = await setup({ season: 'M-5' }, 'ch', null);
  assert.equal(storage.season, 'M-5');
  assert.equal(select.children.length, 1);
  assert.equal(select.disabled, true);
  await update(bundled);
  assert.equal(select.value, '5');
  assert.equal(select.disabled, false);
  assert.equal(storage.season, '5');
});

test('SV keeps its fixed list, selection and URL without requesting the feed', async () => {
  const { linker, select, requests } = await setup({ battleType: 'single', settingsByGame: { sv: { season: '40' } } }, 'sv');
  assert.equal(await linker.getLatestSeason(), '41');
  assert.equal(select.children[0].textContent, '最新');
  assert.equal(select.children[1].textContent, '41~(I)');
  assert.equal(select.children.length, 42);
  assert.equal(select.value, '40');
  assert.equal(requests(), 0);
  assert.equal(linker.buildPBDBUrl({ nationalNumber: '0741', formIndex: '01' }),
    'https://sv.pokedb.tokyo/pokemon/show/0741-01?season=40&rule=0');
});

test('numeric CH IDs cannot become the selection for an unconfigured SV game, and vice versa', async () => {
  const fromCh = await setup({ season: '6', settingsByGame: { ch: { season: '6' } } }, 'sv');
  assert.equal(fromCh.select.value, '41');
  assert.equal(fromCh.storage.settingsByGame.ch.season, '6');
  const fromSv = await setup({ season: '40', settingsByGame: { sv: { season: '40' } } });
  assert.equal(fromSv.select.value, '7');
  assert.equal(fromSv.storage.settingsByGame.sv.season, '40');
});

test('legacy numeric settings are recorded per game even when no value conversion is needed', async () => {
  const { select, storage } = await setup({ season: '6' });
  assert.equal(select.value, '6');
  assert.equal(storage.settingsByGame.ch.season, '6');
});

function nextCatalog() {
  const next = structuredClone(bundled);
  next.updatedAt = '2026-11-04T14:37:00Z';
  next.latest = 'next-series';
  next.seasons.unshift({ id: 'next-series', name: 'Z-1', regulation: '特別ルール', startDate: '2026-11-04', endDate: '2026-12-09' });
  return next;
}

test('selecting latest persists the mode and automatically updates the visible link across series', async () => {
  const { linker, select, link, storage, update } = await setup({ battleType: 'double', season: 'M-6' });
  linker.handleSeasonChange(linker.LATEST_SEASON_VALUE);
  await new Promise(setImmediate);
  assert.equal(storage.settingsByGame.ch.season, linker.LATEST_SEASON_VALUE);
  assert.match(link.href, /season=7&rule=1$/);
  await update(nextCatalog());
  assert.equal(select.children[0].textContent, '最新');
  assert.equal(select.children.filter(option => option.textContent === '最新').length, 1);
  assert.equal(select.value, linker.LATEST_SEASON_VALUE);
  assert.equal(select.children[0].title, '現在: Z-1(特別ルール)');
  assert.match(link.href, /season=next-series&rule=1$/);
  assert.equal(storage.settingsByGame.ch.season, linker.LATEST_SEASON_VALUE);
  const reloaded = await setup(storage, 'ch', nextCatalog());
  assert.equal(reloaded.select.value, linker.LATEST_SEASON_VALUE);
  assert.match(reloaded.link.href, /season=next-series&rule=1$/);
});

test('latest follows the source-selected current season, not the first preannounced option', async () => {
  const next = nextCatalog();
  next.latest = '7';
  const { select, link } = await setup({ battleType: 'single', settingsByGame: { ch: { season: '' } } }, 'ch', next);
  assert.equal(select.value, '');
  assert.equal(select.children[1].textContent, 'Z-1(特別ルール)');
  assert.equal(select.children[0].title, '現在: M-7(M-C)');
  assert.match(link.href, /season=7&rule=0$/);
});

test('switching from latest to a fixed season stops link following while the list still updates', async () => {
  const { linker, select, link, update } = await setup({ battleType: 'double', settingsByGame: { ch: { season: '' } } });
  linker.handleSeasonChange('6');
  await new Promise(setImmediate);
  await update(nextCatalog());
  assert.equal(select.value, '6');
  assert.equal(select.children[1].textContent, 'Z-1(特別ルール)');
  assert.match(link.href, /season=6&rule=1$/);
});

test('a regulation correction refreshes the latest description, and failure retains the last good target', async () => {
  const { select, link, update, disconnect } = await setup({ battleType: 'single', settingsByGame: { ch: { season: '' } } });
  const corrected = structuredClone(bundled);
  corrected.seasons[0].regulation = '別ルール';
  await update(corrected);
  assert.equal(select.children[0].title, '現在: M-7(別ルール)');
  await disconnect();
  assert.equal(select.value, '');
  assert.match(link.href, /season=7&rule=0$/);
});

test('latest remains disabled without confirmed season information or a selected rule', async () => {
  const missing = await setup({ battleType: 'single', settingsByGame: { ch: { season: '' } } }, 'ch', null);
  assert.equal(missing.select.disabled, true);
  assert.equal(missing.link.href, undefined);
  await missing.update(bundled);
  assert.equal(missing.select.disabled, false);
  assert.equal(missing.select.value, '');
  assert.match(missing.link.href, /season=7&rule=0$/);
  const noRule = await setup({ settingsByGame: { ch: { season: '' } } });
  assert.equal(noRule.link.href, undefined);
});

test('SV latest resolves to season 41 without requesting the CH feed', async () => {
  const { linker, select, link, storage, requests } = await setup({
    battleType: 'single', settingsByGame: { sv: { season: '' }, ch: { season: '6' } },
  }, 'sv');
  assert.equal(select.value, linker.LATEST_SEASON_VALUE);
  assert.equal(select.children[0].title, '現在: 41~(I)');
  assert.match(link.href, /^https:\/\/sv\.pokedb\.tokyo\/.*season=41&rule=0$/);
  assert.equal(requests(), 0);
  assert.equal(storage.settingsByGame.ch.season, '6');
});

test('a real source ID named latest cannot collide with the latest selection mode', async () => {
  const next = nextCatalog();
  next.seasons[0].id = 'latest';
  next.latest = '7';
  const { linker, link } = await setup({ battleType: 'single', settingsByGame: { ch: { season: 'latest' } } }, 'ch', next);
  assert.match(link.href, /season=latest&rule=0$/);
  linker.handleSeasonChange(linker.LATEST_SEASON_VALUE);
  await new Promise(setImmediate);
  assert.match(link.href, /season=7&rule=0$/);
});
