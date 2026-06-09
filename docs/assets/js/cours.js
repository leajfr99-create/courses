import { initLayout } from './nav.js';
import { Data, param, esc } from './data.js';
import { Progress } from './storage.js';

function renderBlock(b) {
  if (b.type === 'heading') {
    const tag = b.level === 3 ? 'h3' : 'h2';
    return `<${tag} id="${esc(b.id)}">${esc(b.text)}</${tag}>`;
  }
  if (b.type === 'list') {
    return `<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  }
  return `<p>${esc(b.text)}</p>`;
}

(async function () {
  await initLayout({ page: 'cours' });
  const main = document.getElementById('main');
  const slug = param('id');
  if (!slug) { main.innerHTML = '<div class="error-card">Aucun cours sélectionné.</div>'; return; }

  let d;
  try { d = await Data.cours(slug); }
  catch (e) { main.innerHTML = `<div class="error-card">Impossible de charger ce cours.<br><small>${esc(e.message)}</small></div>`; return; }

  const banner = d.extractionStatus !== 'ok'
    ? `<div class="banner warn">${'⚠️'}<div><b>Extraction partielle</b>Ce cours a été généré automatiquement depuis le PDF et peut comporter des passages incomplets. Réfère-toi au PDF d'origine en cas de doute.</div></div>`
    : '';

  const toc = (d.toc || []).length
    ? `<aside class="toc" aria-label="Sommaire du cours">
         <div class="toc-title">Sommaire</div>
         ${d.toc.map((t) => `<a href="#${esc(t.id)}" class="lvl-${t.level}">${esc(t.label)}</a>`).join('')}
       </aside>`
    : '';

  main.innerHTML = `
    <p class="breadcrumb"><a href="./index.html">Accueil</a> › ${esc(d.code)}</p>
    <p class="eyebrow">${esc(d.code)} · ${esc(d.prof || '')}</p>
    <h1>${esc(d.title)}</h1>
    <div class="btn-row" style="margin:.8rem 0 .4rem">
      <a class="btn btn-soft" href="./fiche.html?id=${slug}">📄 Fiche de révision</a>
      <a class="btn btn-soft" href="./quiz.html?set=cours&mode=lesson&lesson=${slug}">🎯 Tester mes connaissances</a>
      <button class="btn btn-ghost" id="read-btn"></button>
    </div>
    ${banner}
    <div class="reader">
      <article class="prose" id="prose">${(d.blocks || []).map(renderBlock).join('')}</article>
      ${toc}
    </div>
    <p class="footer">Source : ${esc(d.sourceFile || '')}</p>`;

  // Bouton « marquer comme lu »
  const readBtn = document.getElementById('read-btn');
  const refreshBtn = () => {
    const read = Progress.lesson(slug).coursRead;
    readBtn.innerHTML = read ? '✓ Cours lu' : 'Marquer comme lu';
    readBtn.classList.toggle('btn-soft', read);
  };
  refreshBtn();
  readBtn.addEventListener('click', () => {
    const read = Progress.lesson(slug).coursRead;
    Progress.updateLesson(slug, { coursRead: !read });
    refreshBtn();
  });

  // Mise en évidence du sommaire au défilement
  const links = [...document.querySelectorAll('.toc a')];
  const heads = [...document.querySelectorAll('.prose h2, .prose h3')];
  if (links.length && 'IntersectionObserver' in window) {
    const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          links.forEach((a) => a.classList.remove('active'));
          const a = byId.get(en.target.id);
          if (a) a.classList.add('active');
        }
      });
    }, { rootMargin: '0px 0px -75% 0px', threshold: 0 });
    heads.forEach((h) => obs.observe(h));
  }
})();
