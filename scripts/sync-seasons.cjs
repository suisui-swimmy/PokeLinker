const fs = require('node:fs/promises');
const path = require('node:path');
const { validate, validateUpdate, readText } = require('../season-data.js');

const SOURCE_URL = 'https://champs.pokedb.tokyo/pokemon/list';
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

function dateFromLabel(value) {
  const [year, month, day] = value.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseSeasons(html, now = new Date()) {
  // ランダムなidではなく、シーズン選択欄の意味を表すname属性で対象を限定する。
  const selects = [...html.matchAll(/<select\b[^>]*\bname\s*=\s*["']season["'][^>]*>([\s\S]*?)<\/select>/gi)];
  if (selects.length !== 1) throw new Error('シーズン選択欄を一意に取得できません。');
  let latest;
  const seasons = [...selects[0][1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(([, attributes, body]) => {
    const value = attributes.match(/\bvalue\s*=\s*["']([1-9]\d*)["']/i)?.[1];
    const text = body.replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
    const match = text.match(/^シーズン(M-\d+)\s*\((M-[A-Z]+)\)\s*(\d{4}\/\d{1,2}\/\d{1,2})\s*-\s*(\d{4}\/\d{1,2}\/\d{1,2})$/);
    if (!value || !match) throw new Error('シーズン選択肢の形式が変わっています。');
    if (/(?:^|\s)selected(?:\s|=|$)/i.test(attributes)) {
      if (latest) throw new Error('最新シーズンが複数選択されています。');
      latest = match[1];
    }
    return { id: match[1], pbdbSeason: value, regulation: match[2], startDate: dateFromLabel(match[3]), endDate: dateFromLabel(match[4]) };
  });
  // 先頭や最大番号から推測せず、PBDBが選択している現在シーズンを採用する。
  return validate({ schemaVersion: 1, game: 'ch', updatedAt: now.toISOString(), latest, seasons });
}

function nextCheckAfter(response, now) {
  const retryAfter = response.headers.get('retry-after');
  const requested = retryAfter && /^\d+$/.test(retryAfter)
    ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter);
  return new Date(Math.max(now + MIN_INTERVAL_MS, Number.isFinite(requested) ? requested : 0)).toISOString();
}

// fetchを差し替えて検証できるようにし、テストからPBDBへアクセスしない。
async function syncSeasons({ previous, state = {}, now = new Date(), fetchImpl = fetch, resume = false }) {
  const catalog = validate(previous);
  if (state.blocked && !resume) return { catalog, state, outcome: 'blocked' };
  const nowMs = now.getTime();
  if (nowMs < Date.parse(state.nextCheckAt)) return { catalog, state, outcome: 'cooldown' };
  const nextState = {
    lastAttemptAt: now.toISOString(), nextCheckAt: new Date(nowMs + MIN_INTERVAL_MS).toISOString(), blocked: false,
  };
  try {
    // 1回の実行につきGETは1回。画像・JS・ポケモン別ページは取得しない。
    const response = await fetchImpl(SOURCE_URL, {
      headers: { 'User-Agent': 'PokeLinker-season-sync/1.0 (+https://github.com/suisui-swimmy/PokeLinker)', Accept: 'text/html' },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    nextState.nextCheckAt = nextCheckAfter(response, nowMs);
    if (!response.ok) {
      await response.body?.cancel();
      nextState.blocked = response.status === 401 || response.status === 403;
      throw new Error(`PBDB HTTP ${response.status}${nextState.blocked ? '：自動取得を停止しました。' : ''}`);
    }
    if (!response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel();
      throw new Error('PBDBの応答がHTMLではありません。');
    }
    let updated;
    try {
      updated = validateUpdate(parseSeasons(await readText(response, 2 * 1024 * 1024), now), catalog);
    } catch (error) {
      nextState.blocked = true;
      throw error;
    }
    // 内容が同じなら配信データの更新日時も維持する。
    const changed = updated.latest !== catalog.latest || JSON.stringify(updated.seasons) !== JSON.stringify(catalog.seasons);
    return { catalog: changed ? updated : catalog, state: nextState, outcome: changed ? 'updated' : 'unchanged' };
  } catch (error) {
    nextState.lastError = error.message;
    return { catalog, state: nextState, outcome: 'failed' };
  }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function main() {
  const outputDir = process.argv[2];
  if (!outputDir) throw new Error('出力先ディレクトリを指定してください。');
  const seed = JSON.parse(await fs.readFile(path.join(__dirname, '../data/champions-seasons.json'), 'utf8'));
  const previous = await readJson(path.join(outputDir, 'champions-seasons.json'), seed);
  const state = await readJson(path.join(outputDir, 'fetch-state.json'), {});
  const result = await syncSeasons({ previous, state, resume: process.env.RESUME_AFTER_BLOCK === 'true' });
  await fs.mkdir(outputDir, { recursive: true });
  for (const [name, data] of [['champions-seasons.json', result.catalog], ['fetch-state.json', result.state]]) {
    await fs.writeFile(path.join(outputDir, name), `${JSON.stringify(data, null, 2)}\n`);
  }
  console.log(result.outcome);
  if (result.outcome === 'failed') { console.error(result.state.lastError); process.exitCode = 1; }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseSeasons, syncSeasons, MIN_INTERVAL_MS };
