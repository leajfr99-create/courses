import { initLayout } from './nav.js';
import { Progress } from './storage.js';
import { esc } from './data.js';

(async function () {
  const manifest = await initLayout({ page: 'fiches' });
  const lessons = (manifest.lessons || []).sort((a, b) => a.order - b.order);
  document.getElementById('grid').innerHTML = lessons.map((L) => {
    const p = Progress.lesson(L.slug);
    const ready = L.hasFiche;
    return `<a class="card lesson-card" href="./fiche.html?id=${L.slug}">
      <span class="code">${esc(L.code)}</span>
      <h3>${esc(L.shortTitle)}</h3>
      <p class="prof">${esc(L.title)}</p>
      <div class="chips">
        ${ready ? '<span class="chip ok">✓ Disponible</span>' : '<span class="chip warn">En préparation</span>'}
        ${p.ficheRead ? '<span class="chip ok">Révisée</span>' : ''}
      </div>
    </a>`;
  }).join('');
})();
