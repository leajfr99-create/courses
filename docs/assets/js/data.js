// Chargement des données JSON (chemins relatifs pour GitHub Pages en sous-dossier).
const cache = new Map();

async function getJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Échec du chargement : ${path} (${res.status})`);
  const data = await res.json();
  cache.set(path, data);
  return data;
}

export const Data = {
  manifest() { return getJSON('./content/manifest.json'); },
  cours(slug) { return getJSON(`./content/cours/${slug}.json`); },
  fiche(slug) { return getJSON(`./content/fiches/${slug}.json`); },
  quiz(slug) { return getJSON(`./content/quiz/${slug}.json`); },
  qroc(slug) { return getJSON(`./content/qroc/${slug}.json`); },
  annales(slug) { return getJSON(`./content/annales/${slug}.json`); },
};

// Récupère un paramètre d'URL.
export function param(name) {
  return new URLSearchParams(location.search).get(name);
}

// Échappement HTML.
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Mélange de Fisher-Yates (renvoie une copie).
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
