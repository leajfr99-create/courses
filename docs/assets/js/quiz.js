import { initLayout } from './nav.js';
import { Data, param, esc, shuffle } from './data.js';
import { Progress } from './storage.js';

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
const DIFF_LABEL = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile' };
let MANIFEST = null;
let main;

const arrEq = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

// ----------------------------------------------------------------------- //
// Chargement des questions selon la portée
// ----------------------------------------------------------------------- //
async function loadQuestions(cfg) {
  let qs = [];
  if (cfg.set === 'annales') {
    const d = await Data.annales(cfg.annales);
    qs = (d.questions || []).map((q) => ({ ...q, _src: d.title, _unofficial: !!d.unofficialKey }));
  } else if (cfg.mode === 'lesson') {
    const d = await Data.quiz(cfg.lesson);
    qs = (d.questions || []).map((q) => ({ ...q, _src: d.title }));
  } else { // mixte sur tous les cours
    const slugs = (MANIFEST.lessons || []).filter((l) => l.hasQuiz).map((l) => l.slug);
    const all = await Promise.all(slugs.map((s) => Data.quiz(s).catch(() => ({ questions: [] }))));
    all.forEach((d) => (d.questions || []).forEach((q) => qs.push({ ...q, _src: d.title })));
  }
  if (cfg.level && cfg.level !== 'tous') qs = qs.filter((q) => q.difficulty === cfg.level);
  return qs;
}

// ----------------------------------------------------------------------- //
// Écran de configuration (hub)
// ----------------------------------------------------------------------- //
function renderHub(preset = {}) {
  const set = preset.set || 'cours';
  const lessons = (MANIFEST.lessons || []).filter((l) => l.hasQuiz);
  const annales = (MANIFEST.annales || []).filter((a) => a.available);

  const lessonOpts = lessons.map((l) =>
    `<option value="${l.slug}">${esc(l.code)} — ${esc(l.shortTitle)} (${l.quizCount})</option>`).join('');
  const annalesOpts = annales.map((a) =>
    `<option value="${a.slug}">${esc(a.title)} (${a.quizCount})</option>`).join('');

  main.innerHTML = `
    <p class="breadcrumb"><a href="./index.html">Accueil</a> › QCM</p>
    <h1>Quiz interactif</h1>
    <p class="lead">Choisis une source, une difficulté, et lance-toi. Score, indices et explications inclus.</p>

    <div class="card" style="margin-top:1.2rem;max-width:680px">
      <div class="field">
        <label>Source des questions</label>
        <div class="seg" id="seg-set">
          <button data-v="cours" aria-pressed="${set === 'cours'}">QCM des cours</button>
          <button data-v="annales" aria-pressed="${set === 'annales'}">Annales 2015–2024</button>
        </div>
      </div>

      <div id="cours-box" style="${set === 'annales' ? 'display:none' : ''}">
        <div class="field">
          <label for="scope">Portée</label>
          <select id="scope" class="chipselect" style="width:100%">
            <option value="__mix">🎲 Tous les cours (mixte)</option>
            ${lessonOpts}
          </select>
        </div>
      </div>

      <div id="annales-box" style="${set === 'annales' ? '' : 'display:none'}">
        <div class="field">
          <label for="year">Année</label>
          <select id="year" class="chipselect" style="width:100%">${annalesOpts || '<option>Aucune annale disponible</option>'}</select>
        </div>
        <div class="banner warn" style="margin:.2rem 0 0">⚠️<div><b>Corrigé non officiel</b>Les réponses des annales sont une reconstitution&nbsp;: elles peuvent comporter des erreurs. À confronter au cours.</div></div>
      </div>

      <div class="field">
        <label>Difficulté</label>
        <div class="seg" id="seg-level">
          <button data-v="tous" aria-pressed="true">Toutes</button>
          <button data-v="facile" aria-pressed="false">Facile</button>
          <button data-v="moyen" aria-pressed="false">Moyen</button>
          <button data-v="difficile" aria-pressed="false">Difficile</button>
        </div>
      </div>

      <div class="field">
        <label>Nombre de questions</label>
        <div class="seg" id="seg-count">
          <button data-v="10" aria-pressed="true">10</button>
          <button data-v="20" aria-pressed="false">20</button>
          <button data-v="0" aria-pressed="false">Toutes</button>
        </div>
      </div>

      <div class="btn-row" style="margin-top:1rem">
        <button class="btn btn-primary btn-lg" id="start">Commencer</button>
      </div>
      <p class="muted" id="hub-msg" style="margin:.6rem 0 0;font-size:.85rem"></p>
    </div>`;

  const segPick = (id, cb) => {
    const seg = document.getElementById(id);
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (cb) cb(b.dataset.v);
    });
  };
  let level = 'tous', count = 10, curSet = set;
  segPick('seg-set', (v) => {
    curSet = v;
    document.getElementById('cours-box').style.display = v === 'cours' ? '' : 'none';
    document.getElementById('annales-box').style.display = v === 'annales' ? '' : 'none';
  });
  segPick('seg-level', (v) => (level = v));
  segPick('seg-count', (v) => (count = parseInt(v, 10)));

  document.getElementById('start').addEventListener('click', async () => {
    const cfg = { set: curSet, level, count };
    if (curSet === 'annales') {
      cfg.mode = 'annales';
      cfg.annales = document.getElementById('year').value;
    } else {
      const scope = document.getElementById('scope').value;
      if (scope === '__mix') { cfg.mode = 'mixte'; }
      else { cfg.mode = 'lesson'; cfg.lesson = scope; }
    }
    await startQuiz(cfg);
  });
}

// ----------------------------------------------------------------------- //
// Déroulement du quiz
// ----------------------------------------------------------------------- //
async function startQuiz(cfg) {
  main.innerHTML = '<div class="spinner"></div>';
  let pool;
  try { pool = await loadQuestions(cfg); }
  catch (e) { main.innerHTML = `<div class="error-card">Erreur de chargement.<br><small>${esc(e.message)}</small></div>`; return; }

  if (!pool.length) {
    renderHub(cfg);
    document.getElementById('hub-msg').textContent =
      "Aucune question disponible pour ce choix. Essaie une autre source ou difficulté.";
    return;
  }
  let questions = shuffle(pool);
  if (cfg.count && cfg.count > 0) questions = questions.slice(0, cfg.count);
  // mélange des options
  questions = questions.map((q) => ({ q, order: shuffle(q.options.map((_, i) => i)) }));

  const state = { cfg, questions, i: 0, results: [], answers: new Map(), hintUsed: new Set() };
  runQuestion(state);
}

function runQuestion(state) {
  const { questions, i } = state;
  const total = questions.length;
  const { q, order } = questions[i];
  const score = state.results.filter((r) => r.correct).length;
  const multi = (q.correct || []).length > 1 || q.type === 'multiple';
  const unofficial = q._unofficial;

  main.innerHTML = `
    ${unofficial ? `<div class="banner warn">⚠️<div><b>Annale — corrigé non officiel</b>La réponse peut être erronée. Vérifie avec le cours.</div></div>` : ''}
    <div class="quiz-head">
      <div class="quiz-meta">
        <span class="pill">Question ${i + 1} / ${total}</span>
        ${q.difficulty ? `<span class="pill ${q.difficulty}">${DIFF_LABEL[q.difficulty] || q.difficulty}</span>` : ''}
        <span class="pill">Score : ${score}</span>
      </div>
      <a class="btn btn-ghost" href="./quiz.html" style="font-size:.82rem">Quitter</a>
    </div>
    <div class="bar" style="margin-bottom:1.2rem"><span style="width:${(i / total) * 100}%"></span></div>

    <div class="card">
      <p class="muted" style="font-size:.8rem;margin:0">${esc(q._src || '')}</p>
      <p class="qstem">${esc(q.stem)}</p>
      ${multi ? '<p class="muted" style="font-size:.82rem;margin-top:-.6rem">Plusieurs réponses possibles.</p>' : ''}
      <fieldset class="options" id="options">
        <legend class="sr-only">${esc(q.stem)}</legend>
        ${order.map((origIdx, pos) => `
          <label class="option" data-orig="${origIdx}">
            <input type="${multi ? 'checkbox' : 'radio'}" name="opt" value="${origIdx}">
            <span class="key">${KEYS[pos]}</span>
            <span class="otext">${esc(q.options[origIdx])}</span>
            <span class="mark"></span>
          </label>`).join('')}
      </fieldset>
      <div id="hint-slot"></div>
      <div class="btn-row" style="margin-top:1.1rem">
        ${q.hint ? '<button class="btn btn-ghost" id="hint-btn">💡 Indice</button>' : ''}
        <button class="btn btn-primary" id="validate" disabled>Valider</button>
      </div>
      <div id="feedback"></div>
    </div>`;

  const fieldset = document.getElementById('options');
  const validate = document.getElementById('validate');
  const getPicked = () => [...fieldset.querySelectorAll('input:checked')].map((x) => parseInt(x.value, 10));
  fieldset.addEventListener('change', () => { validate.disabled = getPicked().length === 0; });

  const hintBtn = document.getElementById('hint-btn');
  if (hintBtn) hintBtn.addEventListener('click', () => {
    state.hintUsed.add(q.id);
    document.getElementById('hint-slot').innerHTML = `<div class="hintbox">💡 ${esc(q.hint)}</div>`;
    hintBtn.disabled = true;
  });

  validate.addEventListener('click', () => grade(state, getPicked()));

  // Clavier : 1–6 pour sélectionner, Entrée pour valider
  const keyHandler = (e) => {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= order.length) {
      const input = fieldset.querySelectorAll('input')[n - 1];
      if (input && !input.disabled) {
        if (input.type === 'radio') input.checked = true; else input.checked = !input.checked;
        fieldset.dispatchEvent(new Event('change'));
      }
    } else if (e.key === 'Enter' && !validate.disabled) {
      validate.click();
    }
  };
  document.addEventListener('keydown', keyHandler);
  state._cleanup = () => document.removeEventListener('keydown', keyHandler);
}

function grade(state, picked) {
  const { questions, i } = state;
  const { q } = questions[i];
  const correct = q.correct || [];
  const isCorrect = arrEq(picked, correct);
  if (state._cleanup) state._cleanup();

  const fieldset = document.getElementById('options');
  fieldset.querySelectorAll('.option').forEach((opt) => {
    const idx = parseInt(opt.dataset.orig, 10);
    opt.classList.add('locked');
    opt.querySelector('input').disabled = true;
    if (correct.includes(idx)) { opt.classList.add('correct'); opt.querySelector('.mark').textContent = '✓'; }
    else if (picked.includes(idx)) { opt.classList.add('wrong'); opt.querySelector('.mark').textContent = '✗'; }
  });

  document.getElementById('validate').style.display = 'none';
  const hintBtn = document.getElementById('hint-btn');
  if (hintBtn) hintBtn.style.display = 'none';

  const last = i === questions.length - 1;
  document.getElementById('feedback').innerHTML = `
    <div class="feedback ${isCorrect ? 'ok' : 'ko'}" role="status" aria-live="polite">
      <h4>${isCorrect ? '✓ Bonne réponse&nbsp;!' : '✗ Réponse incorrecte'}</h4>
      ${(!isCorrect || q.explanation) ? `<div class="explain"><b>Explication.</b> ${esc(q.explanation || '')}</div>` : ''}
      ${q.source ? `<p class="muted" style="font-size:.8rem;margin:.5rem 0 0">📖 ${esc(q.source)}</p>` : ''}
      <div class="btn-row" style="margin-top:1rem">
        <button class="btn btn-primary" id="next">${last ? 'Voir le résultat' : 'Question suivante'}</button>
      </div>
    </div>`;

  state.results.push({ id: q.id, correct: isCorrect, hintUsed: state.hintUsed.has(q.id), difficulty: q.difficulty });

  const nextBtn = document.getElementById('next');
  nextBtn.focus();
  function kh(e) { if (e.key === 'Enter') { e.preventDefault(); goNext(); } }
  const goNext = () => {
    document.removeEventListener('keydown', kh);
    if (last) { renderSummary(state); }
    else { state.i++; runQuestion(state); }
  };
  nextBtn.addEventListener('click', goNext);
  document.addEventListener('keydown', kh);
}

function renderSummary(state) {
  const { results, cfg } = state;
  const total = results.length;
  const good = results.filter((r) => r.correct).length;
  const pct = Math.round((good / total) * 100);

  // Enregistrement
  const scope = cfg.mode === 'lesson' ? { mode: 'lesson', lesson: cfg.lesson }
    : cfg.mode === 'annales' ? { mode: 'annales', annales: cfg.annales }
    : { mode: 'mixte', set: cfg.set };
  Progress.recordAttempt(scope, pct, results);

  // Répartition par difficulté
  const byDiff = {};
  results.forEach((r) => {
    const k = r.difficulty || 'autre';
    byDiff[k] = byDiff[k] || { g: 0, n: 0 };
    byDiff[k].n++; if (r.correct) byDiff[k].g++;
  });
  const diffRows = Object.entries(byDiff).map(([k, v]) =>
    `<span class="pill ${k}">${DIFF_LABEL[k] || k} : ${v.g}/${v.n}</span>`).join(' ');

  const wrongIds = new Set(results.filter((r) => !r.correct).map((r) => r.id));
  const wrong = state.questions.filter(({ q }) => wrongIds.has(q.id));

  const msg = pct >= 80 ? 'Excellent&nbsp;! 🎉' : pct >= 60 ? 'Bien, continue&nbsp;!' : 'À retravailler — courage&nbsp;!';

  main.innerHTML = `
    <p class="breadcrumb"><a href="./index.html">Accueil</a> › QCM › Résultat</p>
    <h1>Résultat</h1>
    <div class="card" style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap">
      <div class="score-ring" style="--p:${pct}"><b>${pct}%</b></div>
      <div>
        <h3 style="margin:0">${msg}</h3>
        <p class="lead" style="margin:.2rem 0">${good} bonnes réponses sur ${total}.</p>
        <div style="margin-top:.5rem">${diffRows}</div>
      </div>
    </div>

    <div class="btn-row" style="margin:1.2rem 0">
      ${wrong.length ? '<button class="btn btn-primary" id="retry-wrong">↻ Refaire les ' + wrong.length + ' ratées</button>' : ''}
      <button class="btn btn-ghost" id="again">Recommencer ce quiz</button>
      <a class="btn btn-ghost" href="./quiz.html">Nouveau quiz</a>
    </div>

    ${wrong.length ? `<h2>À revoir</h2>${wrong.map(({ q }) => `
      <div class="card" style="margin-bottom:.8rem">
        <p class="qstem" style="font-size:1.02rem">${esc(q.stem)}</p>
        <p style="margin:.2rem 0"><b style="color:var(--c-success)">Bonne réponse :</b>
          ${(q.correct || []).map((c) => esc(q.options[c])).join(' ; ')}</p>
        ${q.explanation ? `<p class="muted">${esc(q.explanation)}</p>` : ''}
      </div>`).join('')}` : '<div class="banner info">🌟<div><b>Sans faute&nbsp;!</b>Toutes les réponses étaient correctes.</div></div>'}
  `;

  const retry = document.getElementById('retry-wrong');
  if (retry) retry.addEventListener('click', () => {
    const subset = wrong.map(({ q }) => ({ q, order: shuffle(q.options.map((_, i) => i)) }));
    runQuestion({ cfg, questions: subset, i: 0, results: [], answers: new Map(), hintUsed: new Set() });
  });
  document.getElementById('again').addEventListener('click', () => startQuiz(cfg));
}

// ----------------------------------------------------------------------- //
(async function () {
  MANIFEST = await initLayout({ page: 'quiz' });
  main = document.getElementById('main');
  const set = param('set') || 'cours';
  const mode = param('mode');
  const auto = param('auto');

  if (auto === '1' && mode === 'mixte') {
    await startQuiz({ set: 'cours', mode: 'mixte', level: 'tous', count: 10 });
  } else if (mode === 'lesson' && param('lesson')) {
    await startQuiz({ set: 'cours', mode: 'lesson', lesson: param('lesson'), level: 'tous', count: 0 });
  } else {
    renderHub({ set });
  }
})();
