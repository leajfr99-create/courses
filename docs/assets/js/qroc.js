import { initLayout } from './nav.js';
import { Data, param, esc } from './data.js';

const DIFF_LABEL = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile' };
let MANIFEST = null;
let main;
let lastId = null; // évite de retirer deux fois de suite la même question

// Mise en forme en ligne légère : **gras**, *italique*, `code`.
function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code class="kbd">$1</code>');
}

const lessonsWithQroc = () =>
  (MANIFEST.lessons || []).filter((l) => l.hasQroc !== false).sort((a, b) => a.order - b.order);

// ----------------------------------------------------------------------- //
// Écran de configuration : choix du cours
// ----------------------------------------------------------------------- //
function renderHub(preselect) {
  const lessons = lessonsWithQroc();
  const opts = lessons.map((l) =>
    `<option value="${l.slug}" ${l.slug === preselect ? 'selected' : ''}>${esc(l.code)} — ${esc(l.shortTitle)}</option>`).join('');

  main.innerHTML = `
    <p class="breadcrumb"><a href="./index.html">Accueil</a> › QROC</p>
    <h1>QROC — Question à réponse ouverte courte</h1>
    <p class="lead">Choisis un cours&nbsp;: une question est tirée <b>au hasard</b>. Rédige ta réponse au brouillon, puis compare-la à la proposition de correction.</p>

    <div class="card" style="margin-top:1.2rem;max-width:680px">
      <div class="field">
        <label for="course">Cours (FC01 → FC06)</label>
        <select id="course" class="chipselect" style="width:100%">
          ${opts || '<option>Aucun cours disponible</option>'}
        </select>
      </div>
      <div class="btn-row" style="margin-top:1rem">
        <button class="btn btn-primary btn-lg" id="draw" ${lessons.length ? '' : 'disabled'}>🎲 Tirer une question</button>
      </div>
      <p class="muted" style="margin:.7rem 0 0;font-size:.85rem">5 à 6 QROC par cours, comme à l'examen (réponses courtes rédigées).</p>
    </div>`;

  const drawBtn = document.getElementById('draw');
  if (drawBtn) drawBtn.addEventListener('click', () => drawQuestion(document.getElementById('course').value));
}

// ----------------------------------------------------------------------- //
// Tirage et affichage d'une question
// ----------------------------------------------------------------------- //
async function drawQuestion(slug) {
  main.innerHTML = '<div class="spinner"></div>';
  let d;
  try { d = await Data.qroc(slug); }
  catch (e) {
    main.innerHTML = `<div class="error-card">Impossible de charger les QROC de ce cours.<br>
      <small>${esc(e.message)}</small></div>
      <div class="btn-row" style="justify-content:center"><a class="btn btn-ghost" href="./qroc.html">← Retour</a></div>`;
    return;
  }
  const pool = d.questions || [];
  if (!pool.length) {
    renderHub(slug);
    const msg = document.querySelector('.card .muted');
    if (msg) msg.textContent = "Aucune QROC disponible pour ce cours pour l'instant.";
    return;
  }
  let q = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1) {
    let guard = 0;
    while (q.id === lastId && guard++ < 8) q = pool[Math.floor(Math.random() * pool.length)];
  }
  lastId = q.id;
  renderQuestion(slug, q);
}

function correctionHTML(q) {
  const pts = q.keyPoints || [];
  return `
    <div class="callout cle">
      <div class="callout-title">✅ Proposition de réponse rédigée</div>
      <div class="callout-body">${inline(q.answer || '')}</div>
    </div>
    ${pts.length ? `<div class="callout def">
      <div class="callout-title">🎯 Points clés attendus (barème)</div>
      <div class="callout-body"><ul class="c-list">${pts.map((x) => `<li>${inline(x)}</li>`).join('')}</ul></div>
    </div>` : ''}
    ${q.trap ? `<div class="callout piege">
      <div class="callout-title">⚠️ Piège à éviter</div>
      <div class="callout-body">${inline(q.trap)}</div>
    </div>` : ''}`;
}

function renderQuestion(slug, q) {
  const lesson = (MANIFEST.lessons || []).find((l) => l.slug === slug) || {};

  main.innerHTML = `
    <p class="breadcrumb"><a href="./index.html">Accueil</a> › <a href="./qroc.html">QROC</a> › ${esc(lesson.code || '')}</p>
    <div class="quiz-head">
      <div class="quiz-meta">
        <span class="pill">${esc(lesson.code || '')}</span>
        ${q.difficulty ? `<span class="pill ${q.difficulty}">${DIFF_LABEL[q.difficulty] || q.difficulty}</span>` : ''}
        ${q.points ? `<span class="pill">${esc(String(q.points))} pts</span>` : ''}
      </div>
      <a class="btn btn-ghost" href="./qroc.html" style="font-size:.82rem">Changer de cours</a>
    </div>

    <div class="card qroc-card">
      <p class="qroc-eyebrow">${esc(lesson.shortTitle || '')}</p>
      <p class="qstem">${inline(q.question || '')}</p>

      <div class="field">
        <label for="ans">Ta réponse (brouillon — facultatif)</label>
        <textarea id="ans" class="qroc-input" rows="5" placeholder="Rédige ta réponse ici, puis affiche la correction pour te corriger…"></textarea>
      </div>

      <div class="btn-row" style="margin-top:.6rem">
        <button class="btn btn-primary" id="reveal">Afficher la correction</button>
        <button class="btn btn-ghost" id="another">🎲 Autre question</button>
        <a class="btn btn-ghost" href="./cours.html?id=${esc(slug)}">📖 Revoir le cours</a>
      </div>

      <div id="qroc-correction" aria-live="polite"></div>
    </div>`;

  const reveal = document.getElementById('reveal');
  reveal.addEventListener('click', () => {
    const slot = document.getElementById('qroc-correction');
    slot.innerHTML = correctionHTML(q);
    reveal.style.display = 'none';
    slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  document.getElementById('another').addEventListener('click', () => drawQuestion(slug));
}

// ----------------------------------------------------------------------- //
(async function () {
  MANIFEST = await initLayout({ page: 'qroc' });
  main = document.getElementById('main');
  const id = param('id');
  const valid = id && lessonsWithQroc().some((l) => l.slug === id);
  if (valid) drawQuestion(id);
  else renderHub();
})();
