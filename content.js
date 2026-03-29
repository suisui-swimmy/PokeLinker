class PokeLinker {
  constructor() {
    this.SEASON_START = new Date('2022-12-01T09:00:00+09:00');
    this.UPDATE_INTERVAL = 60000;
    this.DEBOUNCE_WAIT = 200;
    this.STYLE_ID = 'pokelinker-style';
    // SVのシーズン更新終了に合わせて固定。再開時はこのフラグをtrueに戻す。
    this.SEASON_AUTO_UPDATE_ENABLED = false;
    this.FINAL_SEASON = 41;
    // select要素とchrome.storage.localで扱いやすいよう、シーズン値は文字列で統一する。
    this.FIXED_SEASON_OPTIONS = [
      ['41', '41~(I)'],
      ['40', '40(I)'],
      ['39', '39(I)'],
      ['38', '38(I)'],
      ['37', '37(J)'],
      ['36', '36(J)'],
      ['35', '35(J)'],
      ['34', '34(J)'],
      ['33', '33(I)'],
      ['32', '32(I)'],
      ['31', '31(I)'],
      ['30', '30(I)'],
      ['29', '29(G)'],
      ['28', '28(G)'],
      ['27', '27(G)'],
      ['26', '26(G)'],
      ['25', '25(H)'],
      ['24', '24(H)'],
      ['23', '23(H)'],
      ['22', '22(H)'],
      ['21', '21(G)'],
      ['20', '20(G)'],
      ['19', '19(G)'],
      ['18', '18(G)'],
      ['17', '17(F)'],
      ['16', '16(F)'],
      ['15', '15(F)'],
      ['14', '14(F)'],
      ['13', '13(E)'],
      ['12', '12(E)'],
      ['11', '11(E)'],
      ['10', '10(D+)'],
      ['9', '9(D)'],
      ['8', '8(D)'],
      ['7', '7(C)'],
      ['6', '6(C)'],
      ['5', '5(C)'],
      ['4', '4(B)'],
      ['3', '3(B)'],
      ['2', '2(A)'],
      ['1', '1(A)'],
    ];
    this.availableSeasons = new Set(this.FIXED_SEASON_OPTIONS.map(([value]) => value));

    this.settings = {
      battleType: null,
      season: null,
    };
    this.currentSeason = null;
    this.pokemonInfo = null;

    this.elements = {};
    this.updateTimer = null;
    this.intersectionObserver = null;
    this.seasonUpdateInterval = null;

    this.loadSettings();
  }


  // 保存済み設定を読み込み、現在のUI仕様に合う値へ正規化する。
  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['battleType', 'season']);
      this.settings.battleType = result.battleType || null;
      
      this.currentSeason = await this.getLatestSeason();
      const storedSeason = result.season?.toString();
      const normalizedSeason = this.normalizeSeason(storedSeason || this.currentSeason);
      this.settings.season = normalizedSeason;

      if (this.elements.singleCheck) {
        this.elements.singleCheck.checked = (this.settings.battleType === 'single');
      }
      if (this.elements.doubleCheck) {
        this.elements.doubleCheck.checked = (this.settings.battleType === 'double');
      }
      if (this.elements.seasonSelect) {
        this.elements.seasonSelect.value = this.settings.season;
      }

      if (storedSeason !== normalizedSeason) {
        await this.saveSettings();
      }

      this.updatePBDBLink();
    } catch (error) {
      console.error('設定の読み込みに失敗しました:', error);
    }
  }


  async saveSettings() {
    try {
      await chrome.storage.local.set({
        battleType: this.settings.battleType,
        season: this.settings.season,
      });
    } catch (error) {
      console.error('設定の保存に失敗しました:', error);
    }
  }


  // 初期化リトライ時に<style>が増殖しないよう、共通スタイルは1回だけ挿入する。
  createStyles() {
    if (document.getElementById(this.STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = this.STYLE_ID;
    style.textContent = `
      .pokelinker-container {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 16px;
        line-height: 1;
        padding: 0 !important;
      }

      @media (max-width: 480px) {
        .pokelinker-container {
          flex-wrap: wrap;
          gap: 8px;
        }
      }


      .pokelinker-container label {
        display: inline-flex;
        align-items: center;
        cursor: pointer;
        user-select: none;
        gap: 4px;
        font-size: 16px !important;
      }

      .pokelinker-container input[type="checkbox"] {
        margin: 0;
        cursor: pointer;
      }

      .pokelinker-container select {
        padding: 1px 2px;
        border: 1px solid #ccc;
        border-radius: 3px;
        background-color: #fff;
        font-size: 16px !important;
      }

      .pokelinker-season {
        display: inline-flex;
        align-items: center;
        font-size: 16px !important;
        padding: 0 !important;
        gap: 4px;
      }

      .pokelinker-season-label {
        font-size: 16px !important;
        padding: 0 !important;
      }


      .pokelinker-link {
        color: #3388cc;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        font-size: 16px !important;
      }

      .pokelinker-link.disabled {
        color: #999;
        pointer-events: none;
      }

      .pokelinker-externallink {
        width: 20px;
        height: 20px;
        fill: currentColor;
        margin-left: 2px;
      }
    `;
    document.head.appendChild(style);
  }


  // ページタイトル直下に、バトル種別・シーズン・PBDBリンクの操作群を組み立てる。
  createLinkElements() {
    const container = document.createElement('div');
    container.className = 'pokelinker-container';

    const singleLabel = document.createElement('label');
    const singleCheck = document.createElement('input');
    singleCheck.type = 'checkbox';
    singleCheck.checked = (this.settings.battleType === 'single');
    singleCheck.title = 'SingleBattle';
    singleLabel.appendChild(singleCheck);
    singleLabel.appendChild(document.createTextNode('シングル'));

    const doubleLabel = document.createElement('label');
    const doubleCheck = document.createElement('input');
    doubleCheck.type = 'checkbox';
    doubleCheck.checked = (this.settings.battleType === 'double');
    doubleCheck.title = 'DoubleBattle';
    doubleLabel.appendChild(doubleCheck);
    doubleLabel.appendChild(document.createTextNode('ダブル'));

    const seasonWrapper = document.createElement('div');
    seasonWrapper.className = 'pokelinker-season';

    const seasonLabel = document.createElement('div');
    seasonLabel.className = 'pokelinker-season-label';
    seasonLabel.textContent = 'シーズン:';
    seasonWrapper.appendChild(seasonLabel);

    const seasonSelect = document.createElement('select');
    seasonSelect.title = 'Select a season';
    this.createSeasonOptions(seasonSelect);
    seasonSelect.value = this.normalizeSeason(this.settings.season);
    seasonWrapper.appendChild(seasonSelect);

    const pbdbLink = document.createElement('a');
    pbdbLink.className = 'pokelinker-link disabled';
    pbdbLink.title = 'Open in PBDB';
    pbdbLink.appendChild(document.createTextNode('PBDB'));

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('class', 'pokelinker-externallink');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M 40.960938 4.9804688 A 2.0002 2.0002 0 0 0 40.740234 5 L 28 5 A 2.0002 2.0002 0 1 0 28 9 L 36.171875 9 L 22.585938 22.585938 A 2.0002 2.0002 0 1 0 25.414062 25.414062 L 39 11.828125 L 39 20 A 2.0002 2.0002 0 1 0 43 20 L 43 7.2460938 A 2.0002 2.0002 0 0 0 40.960938 4.9804688 z M 12.5 8 C 8.3826878 8 5 11.382688 5 15.5 L 5 35.5 C 5 39.617312 8.3826878 43 12.5 43 L 32.5 43 C 36.617312 43 40 39.617312 40 35.5 L 40 26 A 2.0002 2.0002 0 1 0 36 26 L 36 35.5 C 36 37.446688 34.446688 39 32.5 39 L 12.5 39 C 10.553312 39 9 37.446688 9 35.5 L 9 15.5 C 9 13.553312 10.553312 12 12.5 12 L 22 12 A 2.0002 2.0002 0 1 0 22 8 L 12.5 8 z');
    svg.appendChild(path);
    pbdbLink.appendChild(svg);

    singleCheck.addEventListener('change', () => {
      this.debounce(() => this.handleBattleTypeChange('single', doubleCheck));
    });

    doubleCheck.addEventListener('change', () => {
      this.debounce(() => this.handleBattleTypeChange('double', singleCheck));
    });

    seasonSelect.addEventListener('change', (e) => {
      this.debounce(() => this.handleSeasonChange(e.target.value));
    });

    container.appendChild(singleLabel);
    container.appendChild(doubleLabel);
    container.appendChild(seasonWrapper);
    container.appendChild(pbdbLink);

    this.elements = {
      container,
      singleCheck,
      doubleCheck,
      seasonSelect,
      pbdbLink
    };

    return container;
  }


  handleBattleTypeChange(type, otherCheckbox) {
    this.settings.battleType = (this.settings.battleType === type) ? null : type;
    otherCheckbox.checked = false;

    this.saveSettings();
    this.updatePBDBLink();
  }


  handleSeasonChange(value) {
    this.settings.season = value;
    this.saveSettings();
    this.updatePBDBLink();
  }


  // 固定シーズン一覧からドロップダウンを再構築し、保存済み値と表示を揃える。
  createSeasonOptions(select) {
    for (const [value, label] of this.FIXED_SEASON_OPTIONS) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }

    select.value = this.normalizeSeason(this.settings.season);
  }


  async getLatestSeason() {
    if (!this.SEASON_AUTO_UPDATE_ENABLED) {
      return this.FINAL_SEASON;
    }

    return this.calculateCurrentSeason();
  }


  // 保存済み値が古い最新シーズンを指していても、現行の固定一覧へ戻す。
  normalizeSeason(season) {
    const seasonValue = season?.toString() || this.FINAL_SEASON.toString();
    return this.availableSeasons.has(seasonValue)
      ? seasonValue
      : this.FINAL_SEASON.toString();
  }


  // 将来シーズン更新が再開したとき用に、月次シーズン計算ロジックは残しておく。
  async calculateCurrentSeason() {
    const now = new Date();
    const startYear = this.SEASON_START.getFullYear();
    const startMonth = this.SEASON_START.getMonth();
    
    // シーズン1=2022年12月として、経過月数からシーズン番号を算出する。
    let seasonNumber = (now.getFullYear() - startYear) * 12 + (now.getMonth() - startMonth) + 1;
    
    // シーズン切り替えは毎月1日9:00想定のため、それ以前は前シーズン扱いにする。
    if (now.getDate() === 1 && now.getHours() < 9) {
      seasonNumber--;
    }
    
    return seasonNumber;
  }


  // 図鑑ページから全国図鑑番号と現在表示中フォルムを拾い、PBDB用のIDへ変換する。
  async getPokemonInfo() {
    if (this.pokemonInfo) return this.pokemonInfo;

    const allTds = document.querySelectorAll('td.c1');
    let nationalNumberElement = null;

    for (const td of allTds) {
      if (td.style.width === '100px' && td.textContent.includes('全国No.')) {
        nationalNumberElement = td.nextElementSibling;
        break;
      }
    }

    if (!nationalNumberElement) return null;
    const nationalNumber = nationalNumberElement.textContent.trim();

    const formLists = document.querySelectorAll('ul.select_list');
    let formList = null;
    for (const list of formLists) {
      const label = list.querySelector('li.select_label');
      if (label && label.textContent.includes('フォルム:')) {
        formList = list;
        break;
      }
    }

    let formIndex = 0;
    if (formList) {
      const forms = Array.from(formList.querySelectorAll('li')).filter(li => !li.classList.contains('select_label'));
      const currentFormIndex = forms.findIndex(li => li.querySelector('strong'));
      formIndex = (currentFormIndex >= 0) ? currentFormIndex : 0;
    }

    this.pokemonInfo = {
      nationalNumber: nationalNumber.padStart(4, '0'),
      formIndex: formIndex.toString().padStart(2, '0')
    };

    return this.pokemonInfo;
  }


  debounce(func, wait = this.DEBOUNCE_WAIT) {
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => func(), wait);
  }


  // リンク先はバトル種別と対象ポケモンが揃ったときだけ有効化する。
  async updatePBDBLink() {
    if (!this.elements.pbdbLink) return;

    if (!this.settings.battleType) {
      this.elements.pbdbLink.classList.add('disabled');
      this.elements.pbdbLink.removeAttribute('href');
      return;
    }

    const pokemonInfo = await this.getPokemonInfo();
    if (!pokemonInfo) return;

    const battleType = (this.settings.battleType === 'single') ? '0' : '1';

    const url = `https://sv.pokedb.tokyo/pokemon/show/${pokemonInfo.nationalNumber}-${pokemonInfo.formIndex}?season=${this.settings.season}&rule=${battleType}`;

    this.elements.pbdbLink.href = url;
    this.elements.pbdbLink.classList.remove('disabled');
    this.elements.pbdbLink.target = '_blank';
    this.elements.pbdbLink.rel = 'noopener noreferrer';
  }


  // 図鑑ページ側の描画タイミングに合わせて、要素が見えたらリンクを再評価する。
  setupIntersectionObserver() {
    this.intersectionObserver?.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.updatePBDBLink();
          }
        });
      },
      { threshold: 0.1 }
    );

    if (this.elements.container) {
      observer.observe(this.elements.container);
    }

    this.intersectionObserver = observer;
  }


  updateSeasonOptions() {
    if (!this.elements.seasonSelect) return;

    // 古い選択肢を捨てて、固定シーズン一覧から再描画する。
    this.elements.seasonSelect.replaceChildren();
    this.createSeasonOptions(this.elements.seasonSelect);
  }


  // 旧来の最新シーズン追従処理は、再利用できるよう別メソッドとして温存する。
  startSeasonUpdateWatcher() {
    if (!this.SEASON_AUTO_UPDATE_ENABLED) {
      return;
    }

    clearInterval(this.seasonUpdateInterval);
    this.seasonUpdateInterval = setInterval(async () => {
      const newSeason = await this.calculateCurrentSeason();
      if (newSeason !== this.currentSeason) {
        this.currentSeason = newSeason;
        this.updateSeasonOptions();
        await this.loadSettings();
      }
    }, this.UPDATE_INTERVAL);
  }


  async init() {
    this.createStyles();

    const titleElement = document.querySelector('h1 span');
    if (!titleElement) return;

    const linkContainer = this.createLinkElements();
    titleElement.parentNode.insertAdjacentElement('afterend', linkContainer);

    this.currentSeason = await this.getLatestSeason();
    
    await this.loadSettings();
    await this.updatePBDBLink();
    this.setupIntersectionObserver();
    this.startSeasonUpdateWatcher();
  }


  // リトライ初期化やページ離脱で残留物が出ないよう、監視とDOMをまとめて掃除する。
  destroy() {
    clearTimeout(this.updateTimer);
    clearInterval(this.seasonUpdateInterval);
    this.intersectionObserver?.disconnect();

    if (this.elements.container) {
      this.elements.container.remove();
    }
  }
}


let retryCount = 0;
const MAX_RETRIES = 3;
let activePokeLinker = null;


// 初期化失敗時は指数的ではなく段階的に待ち時間を伸ばし、ページ側の描画完了を待つ。
function scheduleRetry() {
  if (retryCount >= MAX_RETRIES) {
    return;
  }

  retryCount++;
  setTimeout(initializePokeLinker, 1000 * retryCount);
}


function handleInitializationError(error) {
  console.error('PokeLinkerの初期化に失敗しました:', error);
  activePokeLinker?.destroy();
  activePokeLinker = null;
  scheduleRetry();
}


// 初期化をやり直す場合でも、前回インスタンスを片付けてから作り直す。
function initializePokeLinker() {
  try {
    activePokeLinker?.destroy();

    const pokeLinker = new PokeLinker();
    activePokeLinker = pokeLinker;

    pokeLinker
      .init()
      .then(() => {
        retryCount = 0;
      })
      .catch(handleInitializationError);
  } catch (error) {
    handleInitializationError(error);
  }
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePokeLinker);
} else {
  initializePokeLinker();
}


window.addEventListener('unload', () => {
  if (activePokeLinker) {
    activePokeLinker.destroy();
    activePokeLinker = null;
  }
});
