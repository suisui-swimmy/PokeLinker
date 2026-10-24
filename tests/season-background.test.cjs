const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const bundled = require('../data/champions-seasons.json');

function setup(stored = {}, response = () => Response.json(bundled)) {
  const storage = structuredClone(stored);
  let requests = 0;
  let listener;
  const context = vm.createContext({
    console: { ...console, warn() {} }, URL, AbortSignal, TextDecoder,
    importScripts() {},
    chrome: {
      runtime: { id: 'test-extension', getURL: file => `chrome-extension://test/${file}`, onMessage: { addListener(fn) { listener = fn; } } },
      storage: { local: { async get() { return structuredClone(storage); }, async set(values) { Object.assign(storage, structuredClone(values)); } } },
    },
    async fetch(url, options) {
      if (url.startsWith('chrome-extension:')) return Response.json(bundled);
      assert.equal(url, 'https://raw.githubusercontent.com/suisui-swimmy/PokeLinker/season-data/champions-seasons.json');
      assert.equal(options.credentials, 'omit');
      requests++;
      return response();
    },
  });
  for (const file of ['season-data.js', 'background.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return { get: () => vm.runInContext('getCatalog()', context), storage, requests: () => requests, listener };
}

test('concurrent tabs share one feed request, then use the persistent hourly cache', async () => {
  const { get, storage, requests } = setup();
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(a.latest, 'M-7');
  assert.equal(b.latest, 'M-7');
  await get();
  assert.equal(requests(), 1);
  const restarted = setup(storage);
  assert.equal((await restarted.get()).latest, 'M-7');
  assert.equal(restarted.requests(), 0);
});

test('offline or invalid feed preserves last good data and suppresses repeated requests', async () => {
  const cached = structuredClone(bundled);
  cached.seasons[0].regulation = 'M-D';
  for (const response of [() => { throw new Error('offline'); }, () => Response.json({ seasons: [] }), () => new Response('', { status: 404 })]) {
    const { get, requests } = setup({ championsCatalog: cached }, response);
    assert.equal((await get()).seasons[0].regulation, 'M-D');
    await get();
    assert.equal(requests(), 1);
  }
});

test('first offline use falls back to the bundled catalog', async () => {
  const { get } = setup({}, () => { throw new Error('offline'); });
  assert.equal((await get()).latest, 'M-7');
});

test('requests from unrelated pages/extensions are ignored without fetching', () => {
  const { listener, requests } = setup();
  for (const sender of [
    { id: 'other', url: 'https://yakkun.com/ch/zukan/n1' },
    { id: 'test-extension', url: 'https://example.com/ch/zukan/n1' },
    { id: 'test-extension', url: 'https://yakkun.com/sv/zukan/n1' },
  ]) assert.equal(listener({ type: 'pokelinker:get-champions-seasons' }, sender, () => assert.fail()), undefined);
  assert.equal(requests(), 0);
});

test('the authorized content script receives data through the async message response', async () => {
  const { listener } = setup();
  const data = await new Promise(resolve => {
    assert.equal(listener({ type: 'pokelinker:get-champions-seasons' },
      { id: 'test-extension', url: 'https://yakkun.com/ch/zukan/n1' }, resolve), true);
  });
  assert.equal(data.data.latest, 'M-7');
});
