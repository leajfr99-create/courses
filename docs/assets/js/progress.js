import { initLayout } from './nav.js';
import { Progress } from './storage.js';
import { esc } from './data.js';

(async function () {
  const manifest = await initLayout({ page: 'progres' });
  const main = document.getElementById('main');
  const lessons = (manifest.lessons || []).sort((a, b) => a.order - b.order);
  const prog = Progress.all();

  let coursRead = 0, fichesRead = 0, scored = 0, sum = 0, weakTotal = 0;
  const rows = lessons.map((L) => {
    const p = Progress.lesson(L.slug);
    if (p.coursRead) coursRead++;
    if (p.ficheRead) fichesRead++;
    if (p.bestScorePct != null) { scored++; sum += p.bestScorePct; }
    weakTotal += (p.weakIds || []).length;
    const tick = (b) => b ? '<span style="color:var(--c-success)">✓</span>' : '<span class="muted">—</span>';
    return `<tr>
      <td><a href="./cours.html?id=${L.slug}"><b>${esc(L.code)}</b> ${esc(L.shortTitle)}</a></td>
      <td style="text-align:center">${tick(p.coursRead)}</td>
      <td style="text-align:center">${tick(p.ficheRead)}</td>
      <td style="text-align:center">${p.bestScorePct != null ? p.bestScorePct + '%' : '<span class="muted">—</span>'}</td>
      <td style="text-align:center">${p.attempts || 0}</td>
      <td style="text-align:center">${(p.weakIds || []).length
        ? `<a href="./quiz.html?set=cours&mode=lesson&lesson=${L.slug}">${(p.weakIds || []).length} à revoir</a>`
        : '<span class="muted">0</span>'}</td>
    </tr>`;
  }).join('');

  const completion = lessons.length ? Math.round((coursRead / lessons.length) * 100) : 0;
  const avg = scored ? Math.round(sum / scored) : 0;

  const history = (prog.history || []).slice(0, 12).map((h) => {
    const label = h.scope.mode === 'lesson' ? (h.scope.lesson || '').toUpperCase()
      : h.scope.mode === 'annales' ? (h.scope.annales || '').replace('a', 'Annales ')
      : 'QCM mixte';
    return `<tr><td>${esc(h.date)}</td><td>${esc(label)}</td><td style="text-align:center">${h.n}</td><td style="text-align:center"><b>${h.pct}%</b></td></tr>`;
  }).join('');

  main.innerHTML = `
    <p class="breadcrumb"><a href="./index.html">Accueil</a> › Progression</p>
    <h1>Ma progression</h1>

    <div class="card" style="display:flex;gap:1.6rem;align-items:center;flex-wrap:wrap;margin:1rem 0">
      <div class="score-ring" style="--p:${completion}"><b>${completion}%</b></div>
      <div class="stat">
        <div><div class="num">${coursRead}/${lessons.length}</div><div class="lbl">cours lus</div></div>
        <div><div class="num">${fichesRead}/${lessons.length}</div><div class="lbl">fiches révisées</div></div>
        <div><div class="num">${scored ? avg + '%' : '—'}</div><div class="lbl">score moyen</div></div>
        <div><div class="num">${weakTotal}</div><div class="lbl">questions à revoir</div></div>
      </div>
    </div>

    <h2>Détail par cours</h2>
    <div class="card" style="overflow-x:auto">
      <table class="progress">
        <thead><tr><th>Cours</th><th>Cours lu</th><th>Fiche</th><th>Meilleur score</th><th>Tentatives</th><th>À revoir</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <h2>Historique récent</h2>
    <div class="card" style="overflow-x:auto">
      ${history ? `<table class="progress">
        <thead><tr><th>Date</th><th>Quiz</th><th>Questions</th><th>Score</th></tr></thead>
        <tbody>${history}</tbody></table>`
      : '<p class="muted" style="margin:0">Aucun quiz réalisé pour l\'instant. <a href="./quiz.html">Lance-toi&nbsp;!</a></p>'}
    </div>

    <div class="btn-row" style="margin-top:1.6rem">
      <button class="btn btn-ghost" id="reset">🗑️ Réinitialiser ma progression</button>
    </div>`;

  document.getElementById('reset').addEventListener('click', () => {
    if (confirm('Effacer toute ta progression (scores, lectures, historique) ? Cette action est irréversible.')) {
      Progress.reset();
      location.reload();
    }
  });
})();
