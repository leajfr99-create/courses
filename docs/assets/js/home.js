import { initLayout } from './nav.js';
import { Progress } from './storage.js';
import { esc } from './data.js';

function chip(ok, label) {
  return `<span class="chip ${ok ? 'ok' : ''}">${ok ? '✓ ' : ''}${esc(label)}</span>`;
}

(async function () {
  const manifest = await initLayout({ page: 'home' });
  const lessons = (manifest.lessons || []).sort((a, b) => a.order - b.order);

  // Statistiques globales
  let coursRead = 0, fichesRead = 0, scored = 0, scoreSum = 0;
  for (const L of lessons) {
    const p = Progress.lesson(L.slug);
    if (p.coursRead) coursRead++;
    if (p.ficheRead) fichesRead++;
    if (p.bestScorePct != null) { scored++; scoreSum += p.bestScorePct; }
  }
  const avg = scored ? Math.round(scoreSum / scored) : 0;
  const pct = lessons.length ? Math.round((coursRead / lessons.length) * 100) : 0;
  document.getElementById('stats').innerHTML = `
    <div><div class="num">${coursRead}/${lessons.length}</div><div class="lbl">cours lus</div></div>
    <div><div class="num">${fichesRead}/${lessons.length}</div><div class="lbl">fiches révisées</div></div>
    <div><div class="num">${scored ? avg + '%' : '—'}</div><div class="lbl">score moyen aux QCM</div></div>
    <div><div class="num">${Progress.all().history.length}</div><div class="lbl">quiz réalisés</div></div>`;
  document.getElementById('global-bar').style.width = pct + '%';

  // Cartes des cours
  const grid = document.getElementById('lesson-grid');
  grid.innerHTML = lessons.map((L) => {
    const p = Progress.lesson(L.slug);
    const score = p.bestScorePct != null ? `${p.bestScorePct}%` : '—';
    return `<a class="card lesson-card" href="./cours.html?id=${L.slug}">
      <span class="code">${esc(L.code)} · ${esc(L.prof)}</span>
      <h3>${esc(L.title)}</h3>
      <div class="chips">
        ${chip(p.coursRead, 'Cours')}
        ${chip(p.ficheRead, 'Fiche')}
        <span class="chip ${p.bestScorePct != null ? 'accent' : ''}">QCM ${score}</span>
      </div>
    </a>`;
  }).join('');
})();
