importScripts('season-data.js');

// データ配信先は固定。ページから任意のURLを受け取らない。
const SEASON_FEED_URL = 'https://raw.githubusercontent.com/suisui-swimmy/PokeLinker/season-data/champions-seasons.json';
const FEED_CHECK_INTERVAL_MS = 60 * 60 * 1000;
let pendingCatalog;

async function readCatalog() {
  const bundledResponse = await fetch(chrome.runtime.getURL('data/champions-seasons.json'));
  const bundled = PokeLinkerSeasons.validate(await bundledResponse.json());
  const stored = await chrome.storage.local.get(['championsCatalog', 'seasonFeedNextCheckAt']);
  let catalog = bundled;
  try { catalog = PokeLinkerSeasons.validateUpdate(stored.championsCatalog, bundled); }
  catch { /* 初回や壊れた保存データでは、同梱の確認済み一覧を使う。 */ }
  if (Date.now() < stored.seasonFeedNextCheckAt) return catalog;
  try {
    // 失敗やworker再起動でも連続取得しない。PBDBへはアクセスしない。
    await chrome.storage.local.set({ seasonFeedNextCheckAt: Date.now() + FEED_CHECK_INTERVAL_MS });
    const response = await fetch(SEASON_FEED_URL, {
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-cache',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    const updated = PokeLinkerSeasons.validateUpdate(JSON.parse(await PokeLinkerSeasons.readText(response, 128 * 1024)), catalog);
    await chrome.storage.local.set({ championsCatalog: updated });
    return updated;
  } catch (error) {
    console.warn('シーズン一覧を更新できないため、確認済みの情報を使います:', error.message);
    return catalog;
  }
}

function getCatalog() {
  if (!pendingCatalog) pendingCatalog = readCatalog().finally(() => { pendingCatalog = null; });
  return pendingCatalog;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'pokelinker:get-champions-seasons' || sender.id !== chrome.runtime.id) return;
  let url;
  try { url = new URL(sender.url); } catch { return; }
  if (url.origin !== 'https://yakkun.com' || !/^\/ch\/zukan\/n\d/.test(url.pathname)) return;
  getCatalog().then(data => sendResponse({ data })).catch(error => {
    console.error('シーズン一覧の読み込みに失敗しました:', error.message);
    sendResponse({ error: 'シーズン一覧を取得できませんでした。' });
  });
  return true;
});
