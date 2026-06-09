// Persistance locale (localStorage), espace de noms versionné. Tolérant aux pannes.
const NS = 'immuno.v1';

function _get(key, fallback) {
  try {
    const raw = localStorage.getItem(`${NS}.${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function _set(key, value) {
  try {
    localStorage.setItem(`${NS}.${key}`, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

const DEFAULT_PROGRESS = { version: 1, perLesson: {}, history: [] };

export const Progress = {
  all() { return _get('progress', structuredClone(DEFAULT_PROGRESS)); },
  lesson(slug) {
    const p = this.all();
    return p.perLesson[slug] || { coursRead: false, ficheRead: false, bestScorePct: null, attempts: 0, weakIds: [], masteredIds: [] };
  },
  updateLesson(slug, patch) {
    const p = this.all();
    p.perLesson[slug] = { ...this.lesson(slug), ...patch };
    _set('progress', p);
    return p.perLesson[slug];
  },
  markRead(slug, what) { // 'coursRead' | 'ficheRead'
    return this.updateLesson(slug, { [what]: true });
  },
  recordAttempt(scope, pct, results) {
    const p = this.all();
    const slug = scope.mode === 'lesson' ? scope.lesson : (scope.mode === 'annales' ? scope.annales : '_mixte');
    if (scope.mode === 'lesson' || scope.mode === 'annales') {
      const cur = p.perLesson[slug] || { attempts: 0, bestScorePct: null, weakIds: [], masteredIds: [], coursRead: false, ficheRead: false };
      cur.attempts = (cur.attempts || 0) + 1;
      cur.bestScorePct = Math.max(cur.bestScorePct || 0, pct);
      const weak = new Set(cur.weakIds || []);
      const mastered = new Set(cur.masteredIds || []);
      for (const r of results) {
        if (r.correct) { weak.delete(r.id); if (!r.hintUsed) mastered.add(r.id); }
        else { weak.add(r.id); mastered.delete(r.id); }
      }
      cur.weakIds = [...weak];
      cur.masteredIds = [...mastered];
      p.perLesson[slug] = cur;
    }
    p.history = p.history || [];
    p.history.unshift({ scope, pct, date: new Date().toISOString().slice(0, 10), n: results.length });
    p.history = p.history.slice(0, 60);
    _set('progress', p);
  },
  reset() {
    try { localStorage.removeItem(`${NS}.progress`); } catch (e) {}
  },
};

export const Prefs = {
  get() { return _get('prefs', { theme: 'auto', lastDifficulty: 'tous' }); },
  set(patch) { const v = { ...this.get(), ...patch }; _set('prefs', v); return v; },
};

export const ActiveAttempt = {
  get() { return _get('activeAttempt', null); },
  set(v) { _set('activeAttempt', v); },
  clear() { try { localStorage.removeItem(`${NS}.activeAttempt`); } catch (e) {} },
};
