// Construction du chrome partagé : barre latérale, barre supérieure, thème, tiroir mobile.
import { Data } from './data.js';
import { Prefs, Progress } from './storage.js';

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17h14"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h6"/>',
  quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7"/><path d="M12 16.5h.01"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M10 12h4"/>',
  mix: '<path d="M4 7h6l4 10h6"/><path d="M14 7h6M4 17h6"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5 4 4M20 20l-1-1M5 19l-1 1M20 4l-1 1"/>',
  moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.6 6.6 0 0 0 21 12.8Z"/>',
};
const icon = (n, cls = 'ico') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

export function applyTheme() {
  const t = Prefs.get().theme;
  const root = document.documentElement;
  if (t === 'dark') root.setAttribute('data-theme', 'dark');
  else if (t === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}

function toggleTheme() {
  const cur = Prefs.get().theme;
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = cur === 'dark' || (cur === 'auto' && sysDark);
  Prefs.set({ theme: isDark ? 'light' : 'dark' });
  applyTheme();
  updateThemeBtn();
}

function updateThemeBtn() {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const t = Prefs.get().theme;
  const isDark = t === 'dark' || (t === 'auto' && sysDark);
  btn.innerHTML = icon(isDark ? 'sun' : 'moon', 'ico');
  btn.setAttribute('aria-label', isDark ? 'Activer le thème clair' : 'Activer le thème sombre');
}

function here(page, id) {
  const path = location.pathname.split('/').pop() || 'index.html';
  const curId = new URLSearchParams(location.search).get('id');
  if (page !== path) return false;
  return id ? id === curId : true;
}

export async function initLayout(active = {}) {
  applyTheme();
  let manifest = { lessons: [], annales: [] };
  try { manifest = await Data.manifest(); } catch (e) { /* tolérant */ }

  const lessonLinks = manifest.lessons
    .sort((a, b) => a.order - b.order)
    .map((L) => {
      const on = here('cours.html', L.slug) ? ' active' : '';
      const done = Progress.lesson(L.slug).coursRead ? ' done' : '';
      const badge = Progress.lesson(L.slug).coursRead ? '<span class="badge">lu</span>' : '';
      return `<a href="./cours.html?id=${L.slug}" class="${on}${done}">${icon('book')}<span>${L.code} · ${L.shortTitle}</span>${badge}</a>`;
    }).join('');

  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="brand">
        <span class="logo">Im</span>
        <span><b>Immuno&nbsp;Révise</b><small>Immunopathologie · UE2</small></span>
      </div>
      <nav class="nav" aria-label="Navigation principale">
        <a href="./index.html" class="${here('index.html') ? 'active' : ''}">${icon('home')}<span>Accueil</span></a>
        <div class="group-title">Cours</div>
        ${lessonLinks}
        <div class="group-title">Révision</div>
        <a href="./fiches.html" class="${here('fiches.html') ? 'active' : ''}">${icon('card')}<span>Fiches de révision</span></a>
        <a href="./quiz.html" class="${here('quiz.html') && !location.search.includes('annales') ? 'active' : ''}">${icon('quiz')}<span>QCM des cours</span></a>
        <a href="./quiz.html?set=annales" class="${location.search.includes('annales') ? 'active' : ''}">${icon('archive')}<span>Annales 2015–2024</span></a>
        <a href="./quiz.html?set=cours&mode=mixte&auto=1">${icon('mix')}<span>QCM mixte</span></a>
        <a href="./qroc.html" class="${here('qroc.html') ? 'active' : ''}">${icon('pen')}<span>QROC (réponse courte)</span></a>
        <div class="group-title">Suivi</div>
        <a href="./progres.html" class="${here('progres.html') ? 'active' : ''}">${icon('chart')}<span>Ma progression</span></a>
      </nav>
      <div style="margin-top:auto;padding:1rem 1.25rem;color:var(--c-text-faint);font-size:.74rem">
        Site personnel de révision · hébergé sur GitHub Pages
      </div>`;
  }

  const topbar = document.getElementById('topbar');
  if (topbar) {
    topbar.innerHTML = `
      <button class="icon-btn" id="menu-btn" aria-label="Ouvrir le menu" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button>
      <div class="brand" style="border:0;padding:0;flex:1"><span class="logo" style="width:30px;height:30px;flex-basis:30px;font-size:.85rem">Im</span><b style="font-size:.95rem">Immuno Révise</b></div>
      <button class="icon-btn" id="theme-btn"></button>`;
  } else {
    // bouton thème ancré dans la barre latérale si pas de barre supérieure visible
  }

  // Thème
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  updateThemeBtn();

  // Tiroir mobile
  const menuBtn = document.getElementById('menu-btn');
  const scrim = document.querySelector('.scrim');
  const openDrawer = (open) => {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (scrim) scrim.classList.toggle('show', open);
    if (menuBtn) menuBtn.setAttribute('aria-expanded', String(open));
    if (open) { const f = sidebar.querySelector('a'); if (f) f.focus(); }
  };
  if (menuBtn) menuBtn.addEventListener('click', () => openDrawer(!sidebar.classList.contains('open')));
  if (scrim) scrim.addEventListener('click', () => openDrawer(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openDrawer(false); });

  return manifest;
}
