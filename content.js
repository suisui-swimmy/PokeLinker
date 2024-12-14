class PokeLinker {
  constructor() {
    this.SEASON_START = new Date('2023-12-01T00:00:00+09:00');
    this.SEASON_25_START = new Date('2024-12-01T00:00:00+09:00');
    this.SEASON_25_END = new Date('2025-01-06T08:59:00+09:00');
    this.UPDATE_INTERVAL = 60000;
    this.DEBOUNCE_WAIT = 200;

    this.settings = {
      battleType: null,
      season: null,
    };
    this.currentSeason = null;
    this.pokemonInfo = null;

    this.elements = {};
    this.updateTimer = null;

    this.loadSettings();
  }


  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['battleType', 'season']);
      this.settings.battleType = result.battleType || null;
      this.settings.season = result.season || await this.calculateCurrentSeason();

      if (this.elements.singleCheck) {
        this.elements.singleCheck.checked = (this.settings.battleType === 'single');
      }
      if (this.elements.doubleCheck) {
        this.elements.doubleCheck.checked = (this.settings.battleType === 'double');
      }
      if (this.elements.seasonSelect) {
        this.elements.seasonSelect.value = this.settings.season;
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


  createStyles() {
    const style = document.createElement('style');
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
    seasonSelect.value = this.settings.season;
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


  async createSeasonOptions(select) {
    const currentSeason = await this.calculateCurrentSeason();

    for (let i = currentSeason; i >= 1; i--) {
      const option = document.createElement('option');
      option.value = i.toString();
      option.textContent = (i === currentSeason) ? `${i}(最新)` : i.toString();
      select.appendChild(option);
    }

    select.value = this.settings.season || currentSeason.toString();
  }


  isInSeason25Period(date) {
    return date >= this.SEASON_25_START && date <= this.SEASON_25_END;
  }


  async calculateCurrentSeason() {
    const now = new Date();

    if (this.isInSeason25Period(now)) {
      return 25;
    }

    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1, 9);
    const monthsDiff = Math.floor((now - this.SEASON_START) / (30 * 24 * 60 * 60 * 1000));

    if (now >= currentMonth) {
      return monthsDiff + 1;
    } else {
      return Math.max(1, monthsDiff);
    }
  }


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


  setupIntersectionObserver() {
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
  }


  async init() {
    this.createStyles();

    const titleElement = document.querySelector('h1 span');
    if (!titleElement) return;

    const linkContainer = this.createLinkElements();
    titleElement.parentNode.insertAdjacentElement('afterend', linkContainer);

    await this.loadSettings();
    await this.updatePBDBLink();
    this.setupIntersectionObserver();

    setInterval(async () => {
      const newSeason = await this.calculateCurrentSeason();
      if (newSeason !== this.currentSeason) {
        this.currentSeason = newSeason;
        await this.loadSettings();
      }
    }, this.UPDATE_INTERVAL);
  }


  destroy() {
    clearTimeout(this.updateTimer);
    if (this.elements.container) {
      this.elements.container.remove();
    }
  }
}


let retryCount = 0;
const MAX_RETRIES = 3;


function initializePokeLinker() {
  try {
    const pokeLinker = new PokeLinker();
    pokeLinker.init().catch(() => {
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        setTimeout(initializePokeLinker, 1000 * retryCount);
      }
    });
  } catch {
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      setTimeout(initializePokeLinker, 1000 * retryCount);
    }
  }
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePokeLinker);
} else {
  initializePokeLinker();
}


window.addEventListener('unload', () => {
  const pokeLinker = document.querySelector('.pokelinker-container')?.__pokeLinker;
  if (pokeLinker) {
    pokeLinker.destroy();
  }
});
