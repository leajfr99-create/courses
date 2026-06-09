import { initLayout } from './nav.js';
import { Data, param, esc } from './data.js';
import { Progress } from './storage.js';

// Mise en forme en ligne légère : **gras**, *italique*, `code`. (Contenu rédigé, sûr.)
function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code class="kbd">$1</code>');
}

function renderSection(s) {
  const head = s.heading ? `<h2>${esc(s.heading)}</h2>` : '';
  if (s.type === 'callout') {
    const body = s.html ? inline(s.html) : (s.items || []).map(inline).join('<br>');
    return `<div class="fiche-section">${head}<div class="callout ${esc(s.tone || '')}"><div class="callout-body">${body}</div></div></div>`;
  }
  if (s.type === 'table') {
    return `<div class="fiche-section">${head}<div class="tbl-wrap"><table class="tbl">
      <thead><tr>${(s.columns || []).map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${(s.rows || []).map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></div>`;
  }
  if (s.type === 'definition') {
    return `<div class="fiche-section">${head}<dl class="def">${(s.items || []).map((it) =>
      `<dt>${esc(it.t || it.term)}</dt><dd>${inline(it.d || it.def)}</dd>`).join('')}</dl></div>`;
  }
  // bullets par défaut
  return `<div class="fiche-section">${head}<ul class="prose">${(s.items || []).map((x) => `<li>${inline(x)}</li>`).join('')}</ul></div>`;
}

(async function () {
  await initLayout({ page: 'fiche' });
  const main = document.getElementById('main');
  const slug = param('id');
  if (!slug) { main.innerHTML = '<div class="error-card">Aucune fiche sélectionnée.</div>'; return; }

  let d;
  try { d = await Data.fiche(slug); }
  catch (e) { main.innerHTML = `<div class="error-card">Impossible de charger cette fiche.</div>`; return; }

  const hasContent = (d.sections || []).length > 0;

  main.innerHTML = `
    <p class="breadcrumb"><a href="./index.html">Accueil</a> › <a href="./fiches.html">Fiches</a> › ${esc(slug.toUpperCase())}</p>
    <p class="eyebrow">Fiche de révision</p>
    <h1>${esc(d.title || 'Fiche')}</h1>
    <div class="btn-row" style="margin:.8rem 0">
      <a class="btn btn-soft" href="./cours.html?id=${slug}">📖 Cours complet</a>
      <a class="btn btn-soft" href="./quiz.html?set=cours&mode=lesson&lesson=${slug}">🎯 QCM associé</a>
      ${hasContent ? '<button class="btn btn-ghost" id="read-btn"></button>' : ''}
    </div>
    ${d.summary ? `<div class="callout tip"><div class="callout-body"><b>En bref.</b> ${inline(d.summary)}</div></div>` : ''}
    ${hasContent
      ? `<div style="max-width:74ch">${(d.sections).map(renderSection).join('')}</div>`
      : `<div class="banner info" style="margin-top:1rem">📝<div><b>Fiche en préparation</b>Le contenu de cette fiche n'a pas encore été rédigé. En attendant, consulte le cours complet.</div></div>`}
    `;

  if (hasContent) {
    const readBtn = document.getElementById('read-btn');
    const refresh = () => {
      const read = Progress.lesson(slug).ficheRead;
      readBtn.innerHTML = read ? '✓ Fiche révisée' : 'Marquer comme révisée';
      readBtn.classList.toggle('btn-soft', read);
    };
    refresh();
    readBtn.addEventListener('click', () => {
      Progress.updateLesson(slug, { ficheRead: !Progress.lesson(slug).ficheRead });
      refresh();
    });
  }
})();
