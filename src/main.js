import './style.css';

const MC_DATA_VER = '1.20.5';
const DATA_BASE = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/${MC_DATA_VER}`;
/**
 * Галерея Minecraft Item Gallery (minecraftallimages.jemsire.com) — снимки хотбара, те же файлы в репозитории TinyTank800/MinecraftAllImages.
 */
const GALLERY_SITE = 'https://minecraftallimages.jemsire.com/images';
const GALLERY_RAW =
  'https://raw.githubusercontent.com/TinyTank800/MinecraftAllImages/main/public/images';

/** Порядок после optimizeGalleryVersions: несколько новых релизов → база 1.13.2 → остальное (меньше «пустых» запросов). */
let galleryImageVersions = optimizeGalleryVersions([
  '1.21.10',
  '1.21.6',
  '1.21.5',
  '1.21.4',
  '1.20.6',
  '1.19.4',
  '1.18.2',
  '1.17.1',
  '1.16.5',
  '1.15.2',
  '1.14.4',
  '1.13.2',
]);

function optimizeGalleryVersions(versions) {
  const base = '1.13.2';
  const rest = versions.filter((v) => v !== base);
  const head = rest.slice(0, 4);
  const tail = rest.slice(4);
  return versions.includes(base) ? [...head, base, ...tail] : [...versions];
}

async function loadGalleryVersions() {
  try {
    const r = await fetch(`${GALLERY_SITE}/versions.json`);
    if (!r.ok) return;
    const j = await r.json();
    if (Array.isArray(j.versions) && j.versions.length) {
      galleryImageVersions = optimizeGalleryVersions(j.versions);
    }
  } catch (_) {
    /* оставляем дефолтный список */
  }
}

/**
 * Запас: официальные текстуры из jar (inventivetalent/minecraft-assets), если в галерее нет loose-файла для версии.
 */
const TEXTURE_BASES = [
  `https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@${MC_DATA_VER}/assets/minecraft/textures`,
  `https://assets.mcasset.cloud/${MC_DATA_VER}/assets/minecraft/textures`,
  `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${MC_DATA_VER}/assets/minecraft/textures`,
];

/** Только предметы/блоки, для которых есть хотя бы один рецепт верстака */
let items = [];
/** @type {Record<string, unknown[]>} */
let recipes = {};
/** @type {Map<number, {id:number,name:string,displayName:string}>} */
let idToItem = new Map();

let selectedId = null;
let recipeIndex = 0;
let filteredItems = [];
let searchQuery = '';

/** @type {Map<string, { url: string, flat: boolean }>} */
const textureUrlCache = new Map();

const tooltipEl = document.createElement('div');
tooltipEl.className = 'mc-tooltip';
tooltipEl.hidden = true;
document.body.appendChild(tooltipEl);

function textureCandidates(name) {
  /** Часть моделей ссылается на *_top / *_front и т.д.; узкий fallback без угадывания рецептов */
  const variants = new Set([name]);
  if (name.endsWith('_wood')) variants.add(name.replace(/_wood$/, '_log'));
  if (name.endsWith('_hyphae')) variants.add(name.replace(/_hyphae$/, '_stem'));
  const paths = [];
  for (const v of variants) {
    paths.push(`item/${v}.png`, `block/${v}.png`);
  }
  const urls = [];
  for (const base of TEXTURE_BASES) {
    for (const p of paths) {
      urls.push(`${base}/${p}`);
    }
  }
  return urls;
}

function galleryImageCandidates(name) {
  const file = `${name}.png`;
  const urls = [];
  for (const ver of galleryImageVersions) {
    urls.push(`${GALLERY_SITE}/${ver}/${file}`, `${GALLERY_RAW}/${ver}/${file}`);
  }
  return urls;
}

function isGalleryImageUrl(url) {
  return url.includes('jemsire.com') || url.includes('TinyTank800/MinecraftAllImages');
}

/**
 * @param {HTMLImageElement} img
 * @param {string} name id предмета (snake_case)
 */
function bindTexture(img, name) {
  const cached = textureUrlCache.get(name);
  if (cached) {
    img.onerror = null;
    img.onload = null;
    img.classList.toggle('mc-icon--flat', cached.flat);
    img.src = cached.url;
    return;
  }

  const urls = [...galleryImageCandidates(name), ...textureCandidates(name)];
  let i = 0;
  const tryNext = () => {
    if (i >= urls.length) {
      img.removeAttribute('src');
      img.alt = '';
      img.classList.remove('mc-icon--flat');
      return;
    }
    const url = urls[i];
    i += 1;
    img.onerror = tryNext;
    img.onload = () => {
      img.onerror = null;
      const flat = !isGalleryImageUrl(String(img.src));
      img.classList.toggle('mc-icon--flat', flat);
      textureUrlCache.set(name, { url: img.src, flat });
    };
    img.src = url;
  };
  img.classList.remove('mc-icon--flat');
  tryNext();
}

function padInShape(inShape) {
  const grid = Array.from({ length: 3 }, () => Array(3).fill(null));
  if (!inShape?.length) return grid;
  const rows = Math.min(3, inShape.length);
  for (let r = 0; r < rows; r++) {
    const row = inShape[r] || [];
    const cols = Math.min(3, row.length);
    for (let c = 0; c < cols; c++) {
      const v = row[c];
      grid[r][c] = v === undefined ? null : v;
    }
  }
  return grid;
}

function shapelessToGrid(ingredients) {
  const grid = Array.from({ length: 3 }, () => Array(3).fill(null));
  if (!ingredients?.length) return grid;
  let idx = 0;
  for (let r = 0; r < 3 && idx < ingredients.length; r++) {
    for (let c = 0; c < 3 && idx < ingredients.length; c++) {
      grid[r][c] = ingredients[idx];
      idx += 1;
    }
  }
  return grid;
}

function recipeToGrid(recipe) {
  if (recipe.inShape) return padInShape(recipe.inShape);
  if (recipe.ingredients) return shapelessToGrid(recipe.ingredients);
  return padInShape([]);
}

function rarityClass(displayName) {
  const n = displayName.toLowerCase();
  if (
    /enchanted|dragon|nether star|beacon|elytra|shulker|mace|heavy core|trident/i.test(
      displayName,
    )
  )
    return 'legend';
  if (/record|music disc|skull|head$/i.test(n)) return 'epic';
  return '';
}

function showTooltip(text, x, y, displayName) {
  tooltipEl.textContent = text;
  tooltipEl.hidden = false;
  tooltipEl.classList.remove('rare', 'epic', 'legend');
  const rc = rarityClass(displayName);
  if (rc) tooltipEl.classList.add(rc);
  const pad = 14;
  const tw = tooltipEl.offsetWidth;
  const th = tooltipEl.offsetHeight;
  let left = x + pad;
  let top = y + pad;
  if (left + tw > window.innerWidth - 8) left = x - tw - pad;
  if (top + th > window.innerHeight - 8) top = y - th - pad;
  tooltipEl.style.left = `${Math.max(8, left)}px`;
  tooltipEl.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  tooltipEl.hidden = true;
}

function filterItems(q) {
  const qq = q.trim().toLowerCase();
  const base = items;
  if (!qq) {
    return base.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  const scored = [];
  for (const it of base) {
    const dn = it.displayName.toLowerCase();
    const nm = it.name.toLowerCase();
    if (dn.includes(qq) || nm.includes(qq)) {
      let score = 0;
      if (dn.startsWith(qq) || nm.startsWith(qq)) score += 100;
      if (dn === qq || nm === qq) score += 200;
      score -= dn.length * 0.01;
      scored.push({ it, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.it);
}

function getRecipeList(itemId) {
  const key = String(itemId);
  const list = recipes[key];
  return Array.isArray(list) ? list : [];
}

function renderSlots(grid, rootEl) {
  rootEl.replaceChildren();
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const id = grid[r][c];
      const slot = document.createElement('div');
      slot.className = 'slot interactive';
      if (id != null && id !== 0) {
        const item = idToItem.get(Number(id));
        if (item) {
          const img = document.createElement('img');
          img.alt = item.displayName;
          bindTexture(img, item.name);
          slot.appendChild(img);
          slot.addEventListener('mousemove', (e) => {
            showTooltip(item.displayName, e.clientX, e.clientY, item.displayName);
          });
          slot.addEventListener('mouseleave', hideTooltip);
        } else {
          slot.textContent = '?';
          slot.style.color = '#888';
          slot.style.fontSize = '0.7rem';
        }
      }
      rootEl.appendChild(slot);
    }
  }
}

function updateResultsActiveState() {
  const resultsEl = document.querySelector('[data-results]');
  if (!resultsEl) return;
  for (const btn of resultsEl.querySelectorAll('.catalog-item')) {
    btn.classList.toggle('active', Number(btn.dataset.id) === selectedId);
  }
}

function renderResults() {
  const resultsEl = document.querySelector('[data-results]');
  const countEl = document.querySelector('[data-results-count]');
  if (!resultsEl) return;

  if (countEl) {
    countEl.textContent = searchQuery.trim()
      ? `Найдено: ${filteredItems.length}`
      : `Всего: ${filteredItems.length}`;
  }

  resultsEl.replaceChildren();
  for (const it of filteredItems) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.id = String(it.id);
    btn.className = 'catalog-item' + (selectedId === it.id ? ' active' : '');
    btn.title = `${it.displayName} (${it.name})`;
    const img = document.createElement('img');
    img.className = 'ico';
    img.alt = it.displayName;
    img.loading = 'lazy';
    img.decoding = 'async';
    bindTexture(img, it.name);
    btn.appendChild(img);
    btn.addEventListener('click', () => {
      selectedId = it.id;
      recipeIndex = 0;
      render(false);
    });
    btn.addEventListener('mousemove', (e) => {
      showTooltip(it.displayName, e.clientX, e.clientY, it.displayName);
    });
    btn.addEventListener('mouseleave', hideTooltip);
    resultsEl.appendChild(btn);
  }
  if (!filteredItems.length && items.length) {
    const p = document.createElement('p');
    p.className = 'empty-catalog';
    p.textContent = 'Ничего не найдено. Попробуйте другой запрос.';
    resultsEl.appendChild(p);
  }
}

function renderCraftHeader() {
  const navEl = document.querySelector('[data-recipe-nav]');
  const titleEl = document.querySelector('[data-selected-title]');

  if (titleEl) {
    if (selectedId != null) {
      const it = idToItem.get(selectedId);
      titleEl.textContent = it ? it.displayName : '';
    } else {
      titleEl.textContent = 'Выберите предмет внизу';
    }
  }

  if (!navEl || selectedId == null) return;

  const list = getRecipeList(selectedId);
  navEl.hidden = list.length < 2;
  const prev = navEl.querySelector('[data-prev]');
  const next = navEl.querySelector('[data-next]');
  const label = navEl.querySelector('[data-rcount]');
  if (prev && next && label) {
    prev.disabled = recipeIndex <= 0;
    next.disabled = recipeIndex >= list.length - 1;
    label.textContent = `${recipeIndex + 1} / ${list.length}`;
  }
}

/** @param {boolean} rebuildResults пересобрать список поиска (false — только подсветка выбранного) */
function render(rebuildResults = true) {
  const loadEl = document.querySelector('[data-load-status]');
  const craftEl = document.querySelector('[data-craft]');
  const navEl = document.querySelector('[data-recipe-nav]');

  if (loadEl && !items.length && loadEl.dataset.ready !== '1') {
    loadEl.textContent = 'Загрузка предметов и рецептов…';
  }

  if (rebuildResults) renderResults();
  else updateResultsActiveState();

  renderCraftHeader();

  if (!craftEl) return;

  craftEl.replaceChildren();

  if (selectedId == null) {
    const empty = document.createElement('div');
    empty.className = 'empty-craft';
    empty.textContent =
      'Выберите предмет в каталоге внизу, чтобы увидеть рецепт крафта на верстаке (данные Java Edition ' +
      MC_DATA_VER +
      ').';
    craftEl.appendChild(empty);
    if (navEl) navEl.hidden = true;
    return;
  }

  const list = getRecipeList(selectedId);
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-craft';
    empty.textContent =
      'Для этого предмета нет рецепта обычного верстака в базе. Попробуйте другой предмет.';
    craftEl.appendChild(empty);
    if (navEl) navEl.hidden = true;
    return;
  }

  const recipe = list[recipeIndex];
  const grid = recipeToGrid(recipe);
  const shapeless = Boolean(recipe.ingredients && !recipe.inShape);

  const wrap = document.createElement('div');
  wrap.className = 'craft-body';

  const row = document.createElement('div');
  row.className = 'craft-row';

  const left = document.createElement('div');
  const lbl = document.createElement('div');
  lbl.className = 'table-label';
  lbl.textContent = 'Верстак';
  const table = document.createElement('div');
  table.className = 'crafting-table';
  const g = document.createElement('div');
  g.className = 'grid-3';
  renderSlots(grid, g);
  table.appendChild(g);
  if (shapeless) {
    const b = document.createElement('div');
    b.className = 'shapeless-badge';
    b.textContent = 'Бесформенный крафт';
    table.appendChild(b);
  }
  left.append(lbl, table);

  const arrow = document.createElement('div');
  arrow.className = 'arrow';
  arrow.textContent = '➜';

  const right = document.createElement('div');
  const rl = document.createElement('div');
  rl.className = 'table-label';
  rl.textContent = 'Результат';
  const resWrap = document.createElement('div');
  resWrap.className = 'result-slot';
  const slot = document.createElement('div');
  slot.className = 'slot interactive';
  const res = recipe.result;
  const rid = res?.id;
  const cnt = res?.count ?? 1;
  if (rid != null) {
    const item = idToItem.get(Number(rid));
    if (item) {
      const img = document.createElement('img');
      bindTexture(img, item.name);
      slot.appendChild(img);
      if (cnt > 1) {
        const stack = document.createElement('span');
        stack.textContent = String(cnt);
        stack.style.cssText =
          'position:absolute;right:2px;bottom:1px;font-size:0.65rem;color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none;';
        slot.style.position = 'relative';
        slot.appendChild(stack);
      }
      slot.addEventListener('mousemove', (e) => {
        showTooltip(item.displayName, e.clientX, e.clientY, item.displayName);
      });
      slot.addEventListener('mouseleave', hideTooltip);
    }
  }
  resWrap.appendChild(slot);
  right.append(rl, resWrap);

  row.append(left, arrow, right);
  wrap.appendChild(row);
  craftEl.appendChild(wrap);
}

async function loadData() {
  const loadEl = document.querySelector('[data-load-status]');
  try {
    await loadGalleryVersions();
    const [itemsRes, recipesRes, blocksRes] = await Promise.all([
      fetch(`${DATA_BASE}/items.json`),
      fetch(`${DATA_BASE}/recipes.json`),
      fetch(`${DATA_BASE}/blocks.json`),
    ]);
    if (!itemsRes.ok || !recipesRes.ok || !blocksRes.ok) throw new Error('HTTP');
    const merged = await itemsRes.json();
    recipes = await recipesRes.json();
    const blocks = await blocksRes.json();
    const byName = new Map(merged.map((it) => [it.name, it]));
    const byId = new Map(merged.map((it) => [it.id, it]));
    for (const b of blocks) {
      if (b.id === 0 || b.name === 'air') continue;
      if (byName.has(b.name)) continue;
      if (byId.has(b.id)) continue;
      const entry = { id: b.id, name: b.name, displayName: b.displayName };
      merged.push(entry);
      byName.set(b.name, entry);
      byId.set(b.id, entry);
    }
    idToItem = new Map(merged.map((it) => [it.id, it]));
    items = merged.filter((it) => {
      if (it.id === 0) return false;
      const list = recipes[String(it.id)];
      return Array.isArray(list) && list.length > 0;
    });
    if (loadEl) {
      loadEl.textContent = `С рецептом верстака: ${items.length} · всего имён в базе: ${merged.length}`;
      loadEl.classList.remove('error');
      loadEl.dataset.ready = '1';
    }
    filteredItems = filterItems(searchQuery);
    render();
  } catch (e) {
    if (loadEl) {
      loadEl.textContent =
        'Не удалось загрузить данные (нужен интернет для GitHub, галереи jemsire и CDN текстур). Обновите страницу.';
      loadEl.classList.add('error');
    }
    console.error(e);
  }
}

function initShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="shell">
      <header class="top-bar">
        <div class="brand">
          <h1>Крафты</h1>
          <span>Minecraft Java ${MC_DATA_VER}</span>
        </div>
        <div class="search-wrap">
          <input id="q" class="search-input" type="search" autocomplete="off" placeholder="Поиск: diamond, pickaxe, oak_planks…" aria-label="Поиск предметов" />
        </div>
        <div class="load-line" data-load-status>Загрузка…</div>
      </header>

      <main class="stage">
        <div class="selected-title" data-selected-title>Выберите предмет внизу</div>
        <div class="recipe-nav" data-recipe-nav hidden>
          <button type="button" data-prev>◀ Рецепт</button>
          <span class="count" data-rcount>1 / 1</span>
          <button type="button" data-next>Рецепт ▶</button>
        </div>
        <div class="craft-stage" data-craft></div>
      </main>

      <footer class="catalog-dock">
        <div class="catalog-head">
          <span class="catalog-title">Все крафты</span>
          <span class="catalog-count" data-results-count></span>
        </div>
        <div class="catalog-grid" data-results></div>
      </footer>
    </div>
  `;

  const input = app.querySelector('#q');
  input.addEventListener('input', () => {
    searchQuery = input.value;
    filteredItems = filterItems(searchQuery);
    render();
  });

  document.addEventListener('mousemove', (e) => {
    if (!tooltipEl.hidden) {
      const text = tooltipEl.textContent;
      showTooltip(text, e.clientX, e.clientY, text);
    }
  });

  const nav = app.querySelector('[data-recipe-nav]');
  nav.querySelector('[data-prev]').addEventListener('click', () => {
    if (recipeIndex > 0) {
      recipeIndex -= 1;
      render(false);
    }
  });
  nav.querySelector('[data-next]').addEventListener('click', () => {
    const list = getRecipeList(selectedId);
    if (recipeIndex < list.length - 1) {
      recipeIndex += 1;
      render(false);
    }
  });
}

initShell();
loadData();
