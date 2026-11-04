const fs = require('node:fs/promises');
const path = require('node:path');
const { validate, validateUpdate, readText } = require('../season-data.js');

const SOURCE_URL = 'https://champs.pokedb.tokyo/pokemon/list';
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

function dateFromLabel(value) {
  const [year, month, day] = value.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function decodeText(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, key) => {
    if (!key.startsWith('#')) return named[key.toLowerCase()];
    const hex = key.slice(0, 2).toLowerCase() === '#x';
    const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error('HTML文字参照が不正です。');
    return String.fromCodePoint(code);
  });
}

function parseSeasons(html, now = new Date()) {
  // ランダムなidではなく、シーズン選択欄の意味を表すname属性で対象を限定する。
  const selects = [...html.matchAll(/<select\b[^>]*\bname\s*=\s*["']season["'][^>]*>([\s\S]*?)<\/select>/gi)];
  if (selects.length !== 1) throw new Error('シーズン選択欄を一意に取得できません。');
  const seasons = [...selects[0][1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(([, attributes, body]) => {
    const rawValue = attributes.match(/\bvalue\s*=\s*(["'])(.*?)\1/i)?.[2];
    const value = rawValue === undefined ? null : decodeText(rawValue);
    // 文字列として取り込み、シーズン/レギュレーションの接頭辞や番号は決め打ちしない。
    if (/<[^>]*>/.test(body)) throw new Error('シーズン選択肢に予期しないHTMLがあります。');
    const text = decodeText(body).replace(/\s+/g, ' ').trim();
    const match = text.match(/^シーズン\s*(.+?)\s*[（(]([^()（）]+)[）)]\s*(\d{4}\/\d{1,2}\/\d{1,2})\s*-\s*(\d{4}\/\d{1,2}\/\d{1,2})$/);
    if (!value || !match) throw new Error('シーズン選択肢の形式が変わっています。');
    return { id: value, name: match[1].trim(), regulation: match[2].trim(), startDate: dateFromLabel(match[3]), endDate: dateFromLabel(match[4]) };
  });
  // 日付計算の前に全件検証する。ここでの先頭IDは検証用で、最新の判定には使わない。
  const catalog = validate({ schemaVersion: 2, game: 'ch', updatedAt: now.toISOString(), latest: seasons[0]?.id, seasons });
  // PBDBの初期選択は開催中と一致しない場合がある。掲載済みの開始日と日本時間11:00で判定する。
  const started = catalog.seasons.filter(season => Date.parse(`${season.startDate}T11:00:00+09:00`) <= now.getTime());
  if (!started.length) throw new Error('開始済みのシーズンが一覧にありません。');
  const latestStartDate = started.reduce((date, season) => season.startDate > date ? season.startDate : date, '');
  const latestSeasons = started.filter(season => season.startDate === latestStartDate);
  if (latestSeasons.length !== 1) throw new Error('開始日が同じ最新シーズンが複数あります。');
  return { ...catalog, latest: latestSeasons[0].id };
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
