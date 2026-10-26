// 拡張機能と更新スクリプトで共用する、シーズンデータだけの検証。
const PokeLinkerSeasons = (() => {
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validate(data) {
    if (![1, 2].includes(data?.schemaVersion) || data.game !== 'ch'
      || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))
      || !Array.isArray(data.seasons) || !data.seasons.length || data.seasons.length > 500) {
      throw new Error('シーズン一覧の形式が不正です。');
    }
    // v1のidは表示名だった。旧キャッシュ/配信も読み、PBDBの値を共通の識別値にする。
    const legacy = data.schemaVersion === 1;
    const latest = legacy ? data.seasons.find(season => season?.id === data.latest)?.pbdbSeason : data.latest;
    const seen = new Set();
    const seasons = data.seasons.map(season => {
      const id = legacy ? season?.pbdbSeason : season?.id;
      const name = legacy ? season?.id : season?.name;
      const legacyIds = legacy ? [season?.id] : (season?.legacyIds ?? []);
      if (!season || !validText(id, 128) || seen.has(id) || !validText(name, 80)
        || !validText(season.regulation, 80)
        || !Array.isArray(legacyIds) || legacyIds.length > 20 || legacyIds.some(value => !validText(value, 80))
        || !validDate(season.startDate) || !validDate(season.endDate)
        || season.startDate >= season.endDate) {
        throw new Error('シーズン番号・レギュレーション・期間が不正です。');
      }
      seen.add(id);
      return {
        id, name, regulation: season.regulation, legacyIds: [...new Set(legacyIds)],
        startDate: season.startDate, endDate: season.endDate,
      };
    });
    // 選択肢の順序もPBDBに従い、表示名や識別値を数値として並び替えない。
    if (!seen.has(latest)) throw new Error('最新シーズンが一覧にありません。');
    return { schemaVersion: 2, game: 'ch', updatedAt: data.updatedAt, latest, seasons };
  }

  function validText(value, maxLength) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength
      && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
  }

  // 空の取得結果や古い応答で、配信済みの選択肢を失わない。
  function validateUpdate(data, previous) {
    const next = validate(data);
    if (previous) {
      const before = validate(previous);
      const current = next.seasons.find(season => season.id === next.latest);
      const oldCurrent = before.seasons.find(season => season.id === before.latest);
      if (Date.parse(next.updatedAt) < Date.parse(before.updatedAt)
        || (current.id !== oldCurrent.id && current.startDate < oldCurrent.startDate)
        || before.seasons.some(old => !next.seasons.some(season => season.id === old.id))) {
        throw new Error('取得結果が古いか、既存のシーズンが欠落しています。');
      }
      // 表示名が変更されても、v1で保存した選択を引き継げるようにする。
      for (const season of next.seasons) {
        const old = before.seasons.find(entry => entry.id === season.id);
        season.legacyIds = [...new Set([...season.legacyIds, ...(old?.legacyIds || [])])];
      }
    }
    return validate(next);
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
