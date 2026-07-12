/* =========================================================
   O TABULEIRO DE VASPERNA — eBook Reader
   Main Application Logic (script.js)

   Desenvolvido por Harris Alexandre
   https://www.instagram.com/_harrisalexandre/

   © 2026. Todos os direitos reservados.
   ========================================================= */

'use strict';

// =========================================================
// STATE
// =========================================================
const state = {
  book: null,           // index.json data
  chapters: [],         // loaded chapter list
  currentIndex: -1,     // active chapter index
  cache: {},            // { filename: markdownText }
  readChapters: new Set(),
  favorites: new Set(),
  bookmarks: [],
  settings: {
    theme: 'dark',
    fontSize: 'medium',
    lineHeight: 'normal',
    textWidth: 'normal',
  },
  searchCache: {},      // { filename: plainText }
};

// =========================================================
// DOM REFERENCES
// =========================================================
const $ = id => document.getElementById(id);

const dom = {
  body: document.body,
  progressFill: $('progress-bar-fill'),
  headerChapterInfo: $('header-chapter-info'),
  sidebar: $('sidebar'),
  sidebarOverlay: $('sidebar-overlay'),
  sidebarTitle: $('sidebar-title'),
  sidebarAuthor: $('sidebar-author'),
  statProgress: $('stat-progress-pct'),
  statChapters: $('stat-chapters-read'),
  sidebarSearch: $('sidebar-search-input'),
  chapterList: $('chapter-list'),
  btnContinue: $('btn-continue-reading'),

  coverScreen: $('cover-screen'),
  coverTitle: $('cover-book-title'),
  coverAuthor: $('cover-author'),
  coverDesc: $('cover-description'),
  coverChapterCount: $('cover-chapter-count'),
  btnStart: $('btn-start-reading'),
  btnResume: $('btn-resume-reading'),
  resumeName: $('resume-chapter-name'),

  chapterContainer: $('chapter-container'),
  chapterContent: $('chapter-content'),
  chapterReadTime: $('chapter-reading-time'),
  chapterPosLabel: $('chapter-position-label'),
  btnPrev: $('btn-prev-chapter'),
  btnNext: $('btn-next-chapter'),
  btnIndex: $('btn-goto-index'),
  navIndicator: $('nav-chapter-indicator'),

  settingsPanel: $('settings-panel'),
  searchPanel: $('search-panel'),
  panelBackdrop: $('panel-backdrop'),
  searchInput: $('search-input'),
  searchResults: $('search-results'),
  bookmarkToast: $('bookmark-toast'),
};

// =========================================================
// STORAGE HELPERS
// =========================================================
const STORAGE_KEY = 'olhos_ebook_v1';

function saveState() {
  const data = {
    currentIndex: state.currentIndex,
    settings: state.settings,
    readChapters: [...state.readChapters],
    favorites: [...state.favorites],
    bookmarks: state.bookmarks,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.settings) Object.assign(state.settings, data.settings);
    if (data.readChapters) state.readChapters = new Set(data.readChapters);
    if (data.favorites) state.favorites = new Set(data.favorites);
    if (data.bookmarks) state.bookmarks = data.bookmarks;
    if (typeof data.currentIndex === 'number') {
      state.currentIndex = data.currentIndex;
    }
  } catch { }
}

// =========================================================
// SETTINGS APPLICATION
// =========================================================
function applySettings(s = state.settings) {
  dom.body.className = `theme-${s.theme}`;
  dom.body.dataset.fontSize = s.fontSize;
  dom.body.dataset.lineHeight = s.lineHeight;
  dom.body.dataset.textWidth = s.textWidth;

  // Sync buttons
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === s.theme);
  });
  document.querySelectorAll('.size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.size === s.fontSize);
  });
  document.querySelectorAll('.lh-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lh === s.lineHeight);
  });
  document.querySelectorAll('.width-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.width === s.textWidth);
  });
}

// =========================================================
// FETCH & CACHE
// =========================================================
async function fetchChapter(filename) {
  if (state.cache[filename]) return state.cache[filename];
  const res = await fetch(`livro/${filename}`);
  if (!res.ok) throw new Error(`Cannot load ${filename}`);
  const text = await res.text();
  state.cache[filename] = text;
  return text;
}

async function prefetch(index) {
  const { chapters } = state;
  const targets = [index - 1, index + 1].filter(i => i >= 0 && i < chapters.length);
  for (const i of targets) {
    fetchChapter(chapters[i].arquivo).catch(() => { });
  }
}

// =========================================================
// READING TIME ESTIMATE
// =========================================================
function readingTime(text) {
  const words = text.trim().split(/\s+/).length;
  const mins = Math.ceil(words / 220);
  return mins < 1 ? '< 1 min' : `${mins} min de leitura`;
}

function totalTimeRemaining(fromIndex) {
  const { chapters } = state;
  let words = 0;
  for (let i = fromIndex; i < chapters.length; i++) {
    const md = state.cache[chapters[i].arquivo];
    if (md) words += md.trim().split(/\s+/).length;
  }
  if (words === 0) return '';
  const mins = Math.ceil(words / 220);
  if (mins < 60) return `~${mins} min restantes no livro`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `~${h}h${m > 0 ? m + 'min' : ''} restantes`;
}

// =========================================================
// MARKDOWN → HTML
// =========================================================
function renderMarkdown(md) {
  // Configure marked
  marked.setOptions({
    gfm: true,
    breaks: false,
    pedantic: false,
  });
  return marked.parse(md);
}

// =========================================================
// PROGRESS & STATS
// =========================================================
function updateGlobalProgress() {
  const total = state.chapters.length;
  if (total === 0) return;
  const pct = Math.round((state.readChapters.size / total) * 100);
  dom.statProgress.textContent = `${pct}%`;
  dom.statChapters.textContent = state.readChapters.size;
}

function updateScrollProgress() {
  const el = document.documentElement;
  const top = el.scrollTop || document.body.scrollTop;
  const total = el.scrollHeight - el.clientHeight;
  const pct = total > 0 ? Math.min(100, (top / total) * 100) : 0;
  dom.progressFill.style.width = `${pct}%`;
}

// =========================================================
// CHAPTER LIST (SIDEBAR)
// =========================================================
function buildChapterList(filter = '') {
  const { chapters } = state;
  dom.chapterList.innerHTML = '';

  let lastAto = '';
  const q = filter.toLowerCase();

  chapters.forEach((ch, i) => {
    if (q && !ch.titulo.toLowerCase().includes(q)) return;

    if (ch.ato !== lastAto) {
      const label = document.createElement('div');
      label.className = 'chapter-group-label';
      label.textContent = ch.ato;
      dom.chapterList.appendChild(label);
      lastAto = ch.ato;
    }

    const item = document.createElement('div');
    item.className = 'chapter-item';
    item.dataset.index = i;
    if (i === state.currentIndex) item.classList.add('active');
    if (state.readChapters.has(ch.arquivo)) item.classList.add('read');
    if (state.favorites.has(ch.arquivo)) item.classList.add('favorited');

    item.innerHTML = `
      <span class="chapter-item-num">${i + 1}</span>
      <span class="chapter-item-title">${ch.titulo}</span>
      <span class="chapter-item-read"></span>
    `;

    item.addEventListener('click', () => {
      closeSidebar();
      goToChapter(i);
    });

    dom.chapterList.appendChild(item);
  });
}

function updateActiveChapterInList() {
  document.querySelectorAll('.chapter-item').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.index) === state.currentIndex);
  });
}

// =========================================================
// SIDEBAR
// =========================================================
function openSidebar() {
  dom.sidebar.classList.add('open');
  dom.sidebarOverlay.classList.add('visible');
}
function closeSidebar() {
  dom.sidebar.classList.remove('open');
  dom.sidebarOverlay.classList.remove('visible');
}

// =========================================================
// PANELS (Settings, Search)
// =========================================================
function openPanel(panel) {
  // Close any other open panel
  document.querySelectorAll('.panel.open').forEach(p => {
    if (p !== panel) p.classList.remove('open');
  });
  panel.classList.remove('hidden');
  panel.classList.add('open');
  dom.panelBackdrop.classList.remove('hidden');
}

function closeAllPanels() {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('open'));
  dom.panelBackdrop.classList.add('hidden');
}

// =========================================================
// COVER SCREEN
// =========================================================
function showCover() {
  dom.coverScreen.classList.remove('hidden');
  dom.coverTitle.textContent = state.book.titulo;
  dom.coverAuthor.textContent = state.book.autor;
  dom.coverDesc.textContent = state.book.descricao || '';
  dom.coverChapterCount.textContent = `${state.chapters.length} capítulos`;

  if (state.currentIndex >= 0 && state.currentIndex < state.chapters.length) {
    dom.btnResume.classList.remove('hidden');
    dom.resumeName.textContent = state.chapters[state.currentIndex].titulo;
  } else {
    dom.btnResume.classList.add('hidden');
  }
}

function hideCover() {
  dom.coverScreen.classList.add('hidden');
}

// =========================================================
// CHAPTER RENDERING
// =========================================================
async function goToChapter(index, scrollToTop = true) {
  const { chapters } = state;
  if (index < 0 || index >= chapters.length) return;

  // Fade out
  dom.chapterContainer.classList.add('fade-out');
  await sleep(200);

  state.currentIndex = index;
  const ch = chapters[index];

  let md;
  try {
    md = await fetchChapter(ch.arquivo);
  } catch (e) {
    dom.chapterContent.innerHTML = `<p style="color:var(--accent)">Erro ao carregar o capítulo.</p>`;
    dom.chapterContainer.classList.remove('fade-out');
    return;
  }

  // Render
  dom.chapterContent.innerHTML = renderMarkdown(md);

  // Meta
  dom.chapterReadTime.textContent = readingTime(md);
  dom.chapterPosLabel.textContent = `${index + 1} de ${chapters.length}`;
  dom.headerChapterInfo.textContent = `${index + 1} / ${chapters.length} — ${ch.titulo}`;

  // Nav buttons
  dom.btnPrev.disabled = index === 0;
  dom.btnNext.disabled = index === chapters.length - 1;
  dom.navIndicator.textContent = `Capítulo ${index + 1} de ${chapters.length}`;

  // Title update
  document.title = `${ch.titulo} — ${state.book.titulo}`;

  // Fade in
  dom.chapterContainer.classList.remove('fade-out');

  if (scrollToTop) window.scrollTo({ top: 0, behavior: 'instant' });

  // Mark as read
  state.readChapters.add(ch.arquivo);
  updateGlobalProgress();
  buildChapterList(dom.sidebarSearch.value);
  updateActiveChapterInList();

  // Prefetch adjacent
  prefetch(index);

  saveState();
}

// =========================================================
// SEARCH
// =========================================================
async function performSearch(query) {
  if (!query.trim()) {
    dom.searchResults.innerHTML = '';
    return;
  }

  dom.searchResults.innerHTML = '<div class="search-no-results">Buscando…</div>';

  const q = query.toLowerCase();
  const results = [];

  for (const ch of state.chapters) {
    let md = state.cache[ch.arquivo];
    if (!md) {
      try { md = await fetchChapter(ch.arquivo); } catch { continue; }
    }

    // Strip markdown for plain-text search
    const plain = md
      .replace(/#{1,6}\s+/g, '')
      .replace(/[*_`~]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/>/g, '')
      .replace(/\n+/g, ' ');

    const idx = plain.toLowerCase().indexOf(q);
    if (idx === -1) continue;

    const start = Math.max(0, idx - 60);
    const end = Math.min(plain.length, idx + query.length + 60);
    const snippet = plain.slice(start, end);
    const highlighted = snippet.replace(
      new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      m => `<mark>${m}</mark>`
    );

    results.push({ ch, snippet: (start > 0 ? '…' : '') + highlighted + (end < plain.length ? '…' : '') });
    if (results.length >= 20) break;
  }

  if (results.length === 0) {
    dom.searchResults.innerHTML = '<div class="search-no-results">Nenhum resultado encontrado.</div>';
    return;
  }

  dom.searchResults.innerHTML = results.map((r, i) => `
    <div class="search-result-item" data-chapter="${r.ch.arquivo}">
      <div class="search-result-chapter">${r.ch.titulo}</div>
      <div class="search-result-snippet">${r.snippet}</div>
    </div>
  `).join('');

  dom.searchResults.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => {
      const index = state.chapters.findIndex(c => c.arquivo === el.dataset.chapter);
      if (index >= 0) {
        closeAllPanels();
        goToChapter(index);
      }
    });
  });
}

// =========================================================
// BOOKMARK
// =========================================================
function addBookmark() {
  const ch = state.chapters[state.currentIndex];
  if (!ch) return;
  const scrollY = window.scrollY;
  const bm = { arquivo: ch.arquivo, index: state.currentIndex, scrollY, titulo: ch.titulo, date: Date.now() };
  state.bookmarks = state.bookmarks.filter(b => b.arquivo !== ch.arquivo);
  state.bookmarks.push(bm);
  saveState();
  showToast('Marcador salvo');
}

function showToast(msg) {
  dom.bookmarkToast.textContent = msg;
  dom.bookmarkToast.classList.remove('hidden');
  requestAnimationFrame(() => {
    dom.bookmarkToast.classList.add('show');
    setTimeout(() => {
      dom.bookmarkToast.classList.remove('show');
      setTimeout(() => dom.bookmarkToast.classList.add('hidden'), 350);
    }, 2000);
  });
}

// =========================================================
// KEYBOARD NAVIGATION
// =========================================================
function setupKeyboard() {
  document.addEventListener('keydown', e => {

    // Ignora quando estiver digitando
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    // Navegação forçada entre capítulos
    if (e.ctrlKey) {
      switch (e.key) {
        case 'ArrowRight':
        case 'n':
        case 'N':
          e.preventDefault();
          goToChapter(state.currentIndex + 1);
          return;

        case 'ArrowLeft':
        case 'p':
        case 'P':
          e.preventDefault();
          goToChapter(state.currentIndex - 1);
          return;

        case 'b':
        case 'B':
          e.preventDefault();
          addBookmark();
          return;
      }
    }

    switch (e.key) {

      // Desce uma tela
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        e.preventDefault();

        if (e.shiftKey) {
          // sobe
        } else {
          // desce
        }
        break;

      // Sobe uma tela
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();

        if (atTop()) {
          goToChapter(state.currentIndex - 1);
        } else {
          window.scrollBy({
            top: -window.innerHeight * 0.9,
            behavior: 'smooth'
          });
        }
        break;

      // Shift + Espaço sobe
      case ' ':
        if (e.shiftKey) {
          e.preventDefault();
          window.scrollBy({
            top: -window.innerHeight * 0.9,
            behavior: 'smooth'
          });
        }
        break;

      case 'Home':
        e.preventDefault();
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
        break;

      case 'End':
        e.preventDefault();
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth'
        });
        break;

      case 'b':
      case 'B':
        e.preventDefault();
        addBookmark();
        break;

      case 'i':
      case 'I':
        e.preventDefault();
        openSidebar();
        break;

      case 's':
      case 'S':
        e.preventDefault();
        openPanel(dom.searchPanel);
        setTimeout(() => dom.searchInput.focus(), 50);
        break;

      case 't':
      case 'T':
        e.preventDefault();
        openPanel(dom.settingsPanel);
        break;

      case 'Escape':
        closeAllPanels();
        closeSidebar();
        closeImage();
        break;

      case 'F11':
        e.preventDefault();

        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen();
        }
        break;
    }
  });
}

function atBottom() {
  const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
  return scrollTop + clientHeight >= scrollHeight - 50;
}
function atTop() {
  return (document.documentElement.scrollTop || document.body.scrollTop) < 50;
}

// =========================================================
// EVENT WIRING
// =========================================================
function setupEvents() {
  // Sidebar toggle
  $('btn-toggle-sidebar').addEventListener('click', openSidebar);
  $('btn-close-sidebar').addEventListener('click', closeSidebar);
  dom.sidebarOverlay.addEventListener('click', closeSidebar);

  // Continue reading (sidebar)
  dom.btnContinue.addEventListener('click', () => {
    closeSidebar();
    if (state.currentIndex >= 0) {
      goToChapter(state.currentIndex);
    } else {
      goToChapter(0);
    }
  });

  // Cover buttons
  dom.btnStart.addEventListener('click', () => {
    hideCover();
    goToChapter(0);
  });
  dom.btnResume.addEventListener('click', () => {
    hideCover();
    goToChapter(state.currentIndex);
  });

  // Chapter nav
  dom.btnPrev.addEventListener('click', () => goToChapter(state.currentIndex - 1));
  dom.btnNext.addEventListener('click', () => goToChapter(state.currentIndex + 1));
  dom.btnIndex.addEventListener('click', openSidebar);

  // Header actions
  $('btn-settings').addEventListener('click', () => {
    if (dom.settingsPanel.classList.contains('open')) {
      closeAllPanels();
    } else {
      openPanel(dom.settingsPanel);
    }
  });
  $('btn-search').addEventListener('click', () => {
    if (dom.searchPanel.classList.contains('open')) {
      closeAllPanels();
    } else {
      openPanel(dom.searchPanel);
      setTimeout(() => dom.searchInput.focus(), 50);
    }
  });
  $('btn-bookmark').addEventListener('click', addBookmark);

  // Panel backdrop
  dom.panelBackdrop.addEventListener('click', closeAllPanels);

  // Close panel buttons
  document.querySelectorAll('.btn-close-panel').forEach(btn => {
    btn.addEventListener('click', closeAllPanels);
  });

  // Settings
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.theme = btn.dataset.theme;
      applySettings();
      saveState();
    });
  });
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.fontSize = btn.dataset.size;
      applySettings();
      saveState();
    });
  });
  document.querySelectorAll('.lh-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.lineHeight = btn.dataset.lh;
      applySettings();
      saveState();
    });
  });
  document.querySelectorAll('.width-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.textWidth = btn.dataset.width;
      applySettings();
      saveState();
    });
  });

  // Sidebar search
  dom.sidebarSearch.addEventListener('input', e => {
    buildChapterList(e.target.value);
  });

  // Search panel
  let searchTimer;
  dom.searchInput.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => performSearch(e.target.value), 400);
  });
  $('btn-do-search').addEventListener('click', () => performSearch(dom.searchInput.value));
  dom.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') performSearch(dom.searchInput.value);
  });

  // Scroll for progress bar
  window.addEventListener('scroll', updateScrollProgress, { passive: true });

  // Keyboard
  setupKeyboard();
}

// =========================================================
// UTILS
// =========================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// =========================================================
// INIT
// =========================================================
async function init() {
  // Load persisted state
  loadState();

  // Apply settings immediately
  applySettings();

  // Fetch book index
  let book;
  try {
    const res = await fetch('livro/index.json');
    book = await res.json();
  } catch {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#888;flex-direction:column;gap:12px;">
        <p>Não foi possível carregar o arquivo <code>livro/index.json</code>.</p>
        <p style="font-size:13px">Certifique-se de que o arquivo existe e que o servidor está rodando.</p>
      </div>`;
    return;
  }

  state.book = book;
  state.chapters = book.capitulos;

  // Sidebar book info
  dom.sidebarTitle.textContent = book.titulo;
  dom.sidebarAuthor.textContent = book.autor;

  // Build chapter list
  buildChapterList();
  updateGlobalProgress();

  // Wire events
  setupEvents();

  // Show cover
  showCover();

  // If we have a stored position, prefetch that chapter in background
  if (state.currentIndex >= 0 && state.currentIndex < state.chapters.length) {
    fetchChapter(state.chapters[state.currentIndex].arquivo).catch(() => { });
  }
}

// Start
document.addEventListener('DOMContentLoaded', init);

const modal = document.getElementById("imageModal");
const modalImage = document.getElementById("modalImage");

function openImage(src) {
  modalImage.src = src;
  modal.classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeImage() {
  modal.classList.remove("show");
  document.body.style.overflow = "";
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeImage();
});