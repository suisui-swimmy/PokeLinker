// 拡張機能と更新スクリプトで共用する、シーズンデータだけの検証。
const PokeLinkerSeasons = (() => {
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validate(data) {
    if (data?.schemaVersion !== 1 || data.game !== 'ch'
      || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))
      || !Array.isArray(data.seasons) || !data.seasons.length || data.seasons.length > 500) {
      throw new Error('シーズン一覧の形式が不正です。');
    }
    const seen = new Set();
    const seasons = data.seasons.map(season => {
      if (!season || typeof season.id !== 'string' || !/^M-[1-9]\d{0,3}$/.test(season.id) || seen.has(season.id)
        || season.pbdbSeason !== season.id.slice(2) || typeof season.regulation !== 'string' || !/^M-[A-Z]{1,3}$/.test(season.regulation)
        || !validDate(season.startDate) || !validDate(season.endDate)
        || season.startDate >= season.endDate) {
        throw new Error('シーズン番号・レギュレーション・期間が不正です。');
      }
      seen.add(season.id);
      return {
        id: season.id, pbdbSeason: season.pbdbSeason, regulation: season.regulation,
        startDate: season.startDate, endDate: season.endDate,
      };
    }).sort((a, b) => Number(b.pbdbSeason) - Number(a.pbdbSeason));
    if (!seen.has(data.latest)) throw new Error('最新シーズンが一覧にありません。');
    return { schemaVersion: 1, game: 'ch', updatedAt: data.updatedAt, latest: data.latest, seasons };
  }

  // 空の取得結果や古い応答で、配信済みの選択肢を失わない。
  function validateUpdate(data, previous) {
    const next = validate(data);
    if (previous && (Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)
      || Number(next.latest.slice(2)) < Number(previous.latest.slice(2))
      || previous.seasons.some(old => !next.seasons.some(season => season.id === old.id)))) {
      throw new Error('取得結果が古いか、既存のシーズンが欠落しています。');
    }
    return next;
  }

  async function readText(response, maxBytes) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('取得データのサイズが上限を超えています。');
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      await reader.cancel();
    }
  }
  return { validate, validateUpdate, readText };
})();

if (typeof module !== 'undefined') module.exports = PokeLinkerSeasons;
