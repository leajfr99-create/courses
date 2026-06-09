#!/usr/bin/env python3
"""
Pipeline de construction (bibliothèque standard uniquement).

- Extrait le texte des PDF de cours -> docs/content/cours/<slug>.json (structuré).
- Écrit docs/content/manifest.json (liste des cours + annales) pour le client.
- Crée des gabarits vides pour fiches/quiz/annales SANS jamais écraser l'existant.
- Valide le contenu rédigé (QCM, fiches) : `python tools/build.py --check`.

Usage :
    python tools/build.py            # tout construire
    python tools/build.py --only fc05
    python tools/build.py --check    # valider uniquement le contenu rédigé
    python tools/build.py --report   # rapport de qualité d'extraction
"""
import json
import os
import re
import sys
import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf_extract  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
CONTENT = os.path.join(DOCS, "content")
COURS_DIR = os.path.join(CONTENT, "cours")
FICHES_DIR = os.path.join(CONTENT, "fiches")
QUIZ_DIR = os.path.join(CONTENT, "quiz")
ANNALES_DIR = os.path.join(CONTENT, "annales")

TODAY = datetime.date.today().isoformat()

# --------------------------------------------------------------------------- #
# Métadonnées des cours et annales (slug découplé des noms de fichiers)
# --------------------------------------------------------------------------- #
LESSONS = [
    {"slug": "fc01", "code": "FC01", "order": 1, "prof": "Pr. Paul",
     "title": "Vieillissement du système immunitaire",
     "shortTitle": "Immunosénescence",
     "file": "FC01-Paul-Vieillissement-du-systeme-immunitaire-12.01-1 2.pdf"},
    {"slug": "fc02", "code": "FC02", "order": 2, "prof": "Pr. Paul",
     "title": "Mécanismes physiopathologiques des maladies auto-immunes",
     "shortTitle": "Maladies auto-immunes (MAI)",
     "file": "FC02-PAUL-MAI-15.01.docx (2).pdf"},
    {"slug": "fc03", "code": "FC03", "order": 3, "prof": "Pr. Berger",
     "title": "Développement du système immunitaire à la naissance et immunité de la grossesse",
     "shortTitle": "Grossesse & naissance",
     "file": "FC03-BERGER-Systeme-immunitaire-pendant-la-grossesse-et-a-la-naissance-19.01.docx.pdf"},
    {"slug": "fc04a", "code": "FC04a", "order": 4, "prof": "Pr. Marotte",
     "title": "Physiopathologie de la polyarthrite rhumatoïde",
     "shortTitle": "Polyarthrite rhumatoïde (PR)",
     "file": "FC04a-MAROTTE-Physiopathologie-de-la-polyarthrite-rhumatoide-21.02.pdf"},
    {"slug": "fc04b", "code": "FC04b", "order": 5, "prof": "Pr. Marotte",
     "title": "Physiopathologie des spondylarthrites",
     "shortTitle": "Spondylarthrites (SpA)",
     "file": "FC04b-MAROTTE-Physiopathologie-des-spondyloarthrites-21-01-26.pdf"},
    {"slug": "fc05", "code": "FC05", "order": 6, "prof": "Dr. Waeckel",
     "title": "Thérapies cellulaires",
     "shortTitle": "Thérapies cellulaires",
     "file": "FC05-WAECKEL-Therapies-celIulaires-23-01-26.pdf"},
    {"slug": "fc06", "code": "FC06", "order": 7, "prof": "Pr. Maillard",
     "title": "Mécanismes d’action des immunoglobulines polyvalentes",
     "shortTitle": "Immunoglobulines (IgIV)",
     "file": "FC06-Maillard-Meěcanismes d’action des immunoglobulines polyvalentes-23.01.pdf"},
]

ANNALES = [
    {"year": 2015, "slug": "a2015", "file": "2015- Immuno- Sujet session 1(1).pdf"},
    {"year": 2016, "slug": "a2016", "file": "2016 Session 1- Immunologie- Sujet session 1(1).pdf"},
    {"year": 2017, "slug": "a2017", "file": "2017-immunopatho-Sujet(1).pdf"},
    {"year": 2018, "slug": "a2018", "file": "2018-immunopatho-Sujet(2).pdf"},
    {"year": 2019, "slug": "a2019", "file": "2019-Immunopathologie-Sujet(2).pdf"},
    {"year": 2022, "slug": "a2022", "file": "2022-immunopathologie-Sujet(2).pdf"},
    {"year": 2023, "slug": "a2023", "file": "2023-Immuno-sujet(3).pdf"},
    {"year": 2024, "slug": "a2024", "file": "2024 Sujet Immunopathologie 2024(4).pdf"},
]

DIFFICULTIES = {"facile", "moyen", "difficile"}

# --------------------------------------------------------------------------- #
# Normalisation et segmentation
# --------------------------------------------------------------------------- #
BOILER_RE = [
    re.compile(r"^\s*Page\s+\d+\s*(/|sur)\s*\d+\s*$", re.I),
    re.compile(r"^\s*\d{1,2}/\d{1,2}/\d{2,4}\b.*"),          # en-têtes datés de prise de notes
    re.compile(r"^\s*UE\s*2\b.*", re.I),
    re.compile(r"^\s*Tutorat d.Années Supérieures.*", re.I),
]


def _clean_line(s):
    s = s.replace(" ", " ")
    s = re.sub(r"[ \t]+", " ", s).strip()
    s = s.replace("--", "-")
    return s


def normalize(pages):
    """pages: list[str] -> list[str] de lignes nettoyées (sans répétitions ni bruit)."""
    per_page_lines = []
    freq = {}
    for pg in pages:
        lines = [_clean_line(x) for x in pg.split("\n")]
        seen = set()
        for ln in lines:
            if ln and ln not in seen:
                freq[ln] = freq.get(ln, 0) + 1
                seen.add(ln)
        per_page_lines.append(lines)

    npages = max(len(pages), 1)
    repeated = {ln for ln, c in freq.items() if c >= max(3, npages * 0.4) and len(ln) < 110}

    out = []
    blank = False
    for lines in per_page_lines:
        for ln in lines:
            if not ln:
                if not blank and out:
                    out.append("")
                    blank = True
                continue
            if ln in repeated:
                continue
            if any(rx.match(ln) for rx in BOILER_RE):
                continue
            if len(ln) <= 1:
                continue
            out.append(ln)
            blank = False
        if out and not blank:
            out.append("")
            blank = True
    while out and out[-1] == "":
        out.pop()
    return out


_BULLET_RE = re.compile(r"^\s*([•●▪‣◦·\-–*o])\s+(.*)")
_ROMAN_RE = re.compile(r"^(I{1,3}|IV|V|VI{0,3}|IX|X)[\.\)]\s+(.+)$")
_NUM_HEAD_RE = re.compile(r"^(\d{1,2})[\.\)]\s+(.+)$")


def _slug_anchor(text):
    t = text.lower()
    t = (t.replace("é", "e").replace("è", "e").replace("ê", "e").replace("à", "a")
         .replace("â", "a").replace("ô", "o").replace("î", "i").replace("ï", "i")
         .replace("ç", "c").replace("ù", "u").replace("û", "u").replace("œ", "oe"))
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return t[:60] or "section"


def _is_heading(ln):
    if _ROMAN_RE.match(ln):
        return 2, _ROMAN_RE.match(ln).group(0)
    m = _NUM_HEAD_RE.match(ln)
    if m and len(ln) < 80:
        return 3, ln
    letters = [c for c in ln if c.isalpha()]
    if (8 <= len(ln) <= 80 and letters and sum(c.isupper() for c in letters) / len(letters) > 0.85
            and len(ln.split()) >= 2 and not ln.endswith(".")):
        return 2, ln
    return None


def _ends_open(s):
    return not re.search(r"[.;:!?»)\]]\s*$", s)


def segment(lines):
    """Transforme les lignes en blocs structurés + table des matières."""
    blocks = []
    toc = []
    i = 0
    n = len(lines)
    used = set()

    def add_heading(level, text):
        text = text.strip()
        anchor = _slug_anchor(text)
        base = anchor
        k = 2
        while anchor in used:
            anchor = f"{base}-{k}"
            k += 1
        used.add(anchor)
        blocks.append({"type": "heading", "level": level, "id": anchor, "text": text})
        toc.append({"id": anchor, "label": text, "level": level})

    while i < n:
        ln = lines[i]
        if ln == "":
            i += 1
            continue
        hd = _is_heading(ln)
        if hd:
            add_heading(hd[0], hd[1])
            i += 1
            continue
        bm = _BULLET_RE.match(ln)
        if bm:
            items = []
            while i < n and lines[i] != "":
                m2 = _BULLET_RE.match(lines[i])
                if m2:
                    items.append(m2.group(2).strip())
                elif items and _ends_open(items[-1]) is not None:
                    # continuation d'un item sur la ligne suivante
                    items[-1] = (items[-1] + " " + lines[i].strip()).strip()
                else:
                    break
                i += 1
            items = [x for x in items if x]
            if items:
                blocks.append({"type": "list", "items": items})
            continue
        # paragraphe : joindre les lignes enroulées jusqu'à une ligne vide / titre / puce
        buff = [ln]
        i += 1
        while i < n and lines[i] != "" and not _is_heading(lines[i]) and not _BULLET_RE.match(lines[i]):
            buff.append(lines[i])
            i += 1
        text = " ".join(buff)
        text = re.sub(r"(\w)-\s+(\w)", r"\1\2", text)  # recolle les coupures de mots
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= 3:
            blocks.append({"type": "paragraph", "text": text})
    return blocks, toc


# --------------------------------------------------------------------------- #
# Construction des cours
# --------------------------------------------------------------------------- #
def _garbled_ratio(text):
    if not text:
        return 1.0
    bad = sum(1 for c in text if ord(c) > 0x2BFF and not c.isspace())
    return bad / len(text)


def build_cours(lesson, report=False):
    path = os.path.join(ROOT, lesson["file"])
    if not os.path.exists(path):
        print(f"  [!] PDF introuvable : {lesson['file']}")
        return None
    pages = pdf_extract.extract_pages(path)
    lines = normalize(pages)
    blocks, toc = segment(lines)
    full = "\n".join(lines)
    gr = _garbled_ratio(full)
    status = "ok" if gr < 0.02 and len(full) > 1500 else ("partial" if len(full) > 500 else "garbled")
    data = {
        "slug": lesson["slug"],
        "code": lesson["code"],
        "title": lesson["title"],
        "prof": lesson["prof"],
        "sourceFile": lesson["file"],
        "generatedAt": TODAY,
        "extractionStatus": status,
        "toc": toc,
        "blocks": blocks,
    }
    out_path = os.path.join(COURS_DIR, lesson["slug"] + ".json")
    assert os.path.abspath(out_path).startswith(os.path.abspath(COURS_DIR)), "écriture hors cours/"
    os.makedirs(COURS_DIR, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    nhead = sum(1 for b in blocks if b["type"] == "heading")
    print(f"  {lesson['slug']:6} {status:8} {len(pages):2} pages  {len(blocks):3} blocs "
          f"({nhead} titres)  {len(full):6} car.  garbled={gr:.3f}")
    return status


# --------------------------------------------------------------------------- #
# Manifest + gabarits
# --------------------------------------------------------------------------- #
def _has_questions(path):
    if not os.path.exists(path):
        return False, 0
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        q = d.get("questions", [])
        return len(q) > 0, len(q)
    except Exception:
        return False, 0


def _fiche_filled(path):
    if not os.path.exists(path):
        return False
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return len(d.get("sections", [])) > 0
    except Exception:
        return False


def write_manifest():
    lessons = []
    for L in LESSONS:
        cours_path = os.path.join(COURS_DIR, L["slug"] + ".json")
        quiz_path = os.path.join(QUIZ_DIR, L["slug"] + ".json")
        fiche_path = os.path.join(FICHES_DIR, L["slug"] + ".json")
        has_quiz, nq = _has_questions(quiz_path)
        lessons.append({
            "slug": L["slug"], "code": L["code"], "order": L["order"],
            "title": L["title"], "shortTitle": L["shortTitle"], "prof": L["prof"],
            "hasCours": os.path.exists(cours_path),
            "hasFiche": _fiche_filled(fiche_path),
            "hasQuiz": has_quiz, "quizCount": nq,
        })
    annales = []
    for A in ANNALES:
        p = os.path.join(ANNALES_DIR, A["slug"] + ".json")
        has, nq = _has_questions(p)
        annales.append({"year": A["year"], "slug": A["slug"],
                        "title": f"Annales {A['year']}", "available": has, "quizCount": nq})
    manifest = {"version": 1, "generatedAt": TODAY, "lessons": lessons, "annales": annales}
    os.makedirs(CONTENT, exist_ok=True)
    with open(os.path.join(CONTENT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f"  manifest.json : {len(lessons)} cours, {len(annales)} annales")


def ensure_stubs():
    os.makedirs(FICHES_DIR, exist_ok=True)
    os.makedirs(QUIZ_DIR, exist_ok=True)
    os.makedirs(ANNALES_DIR, exist_ok=True)
    created = 0
    for L in LESSONS:
        fp = os.path.join(FICHES_DIR, L["slug"] + ".json")
        if not os.path.exists(fp):
            with open(fp, "w", encoding="utf-8") as f:
                json.dump({"slug": L["slug"], "title": f"Fiche — {L['shortTitle']}",
                           "updated": TODAY, "summary": "", "sections": []},
                          f, ensure_ascii=False, indent=1)
            created += 1
        qp = os.path.join(QUIZ_DIR, L["slug"] + ".json")
        if not os.path.exists(qp):
            with open(qp, "w", encoding="utf-8") as f:
                json.dump({"slug": L["slug"], "title": f"QCM — {L['shortTitle']}",
                           "unofficialKey": False, "questions": []},
                          f, ensure_ascii=False, indent=1)
            created += 1
    for A in ANNALES:
        ap = os.path.join(ANNALES_DIR, A["slug"] + ".json")
        if not os.path.exists(ap):
            with open(ap, "w", encoding="utf-8") as f:
                json.dump({"slug": A["slug"], "year": A["year"],
                           "title": f"Annales {A['year']}", "unofficialKey": True,
                           "questions": []}, f, ensure_ascii=False, indent=1)
            created += 1
    if created:
        print(f"  {created} gabarit(s) créé(s) (aucun écrasement)")


# --------------------------------------------------------------------------- #
# Validation du contenu rédigé
# --------------------------------------------------------------------------- #
def _validate_questions(path, label, errors):
    if not os.path.exists(path):
        return
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except Exception as e:
        errors.append(f"{label}: JSON invalide ({e})")
        return
    ids = set()
    for q in d.get("questions", []):
        qid = q.get("id")
        if not qid:
            errors.append(f"{label}: question sans id")
        elif qid in ids:
            errors.append(f"{label}: id dupliqué {qid}")
        ids.add(qid)
        opts = q.get("options", [])
        if len(opts) < 2:
            errors.append(f"{label}/{qid}: moins de 2 options")
        cor = q.get("correct", [])
        if not isinstance(cor, list) or not cor:
            errors.append(f"{label}/{qid}: 'correct' doit être une liste non vide")
        else:
            for c in cor:
                if not isinstance(c, int) or c < 0 or c >= len(opts):
                    errors.append(f"{label}/{qid}: index correct hors limites ({c})")
        if q.get("difficulty") not in DIFFICULTIES:
            errors.append(f"{label}/{qid}: difficulté invalide ({q.get('difficulty')})")
        if not q.get("explanation"):
            errors.append(f"{label}/{qid}: explication manquante")


def check():
    errors = []
    for L in LESSONS:
        _validate_questions(os.path.join(QUIZ_DIR, L["slug"] + ".json"), f"quiz/{L['slug']}", errors)
    for A in ANNALES:
        _validate_questions(os.path.join(ANNALES_DIR, A["slug"] + ".json"), f"annales/{A['slug']}", errors)
    if errors:
        print("VALIDATION : %d erreur(s)" % len(errors))
        for e in errors:
            print("  -", e)
        return 1
    print("VALIDATION : OK")
    return 0


# --------------------------------------------------------------------------- #
def main():
    args = sys.argv[1:]
    if "--check" in args:
        sys.exit(check())
    only = None
    if "--only" in args:
        only = args[args.index("--only") + 1]
    report = "--report" in args
    print("Construction des cours :")
    for L in LESSONS:
        if only and L["slug"] != only:
            continue
        build_cours(L, report=report)
    ensure_stubs()
    write_manifest()
    print("Terminé.")


if __name__ == "__main__":
    main()
