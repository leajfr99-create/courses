"""
Extracteur de texte PDF — bibliothèque standard Python uniquement.

Gère :
- objets directs et objets compressés (ObjStm) + flux xref ;
- polices Type0/Identity-H (codes 2 octets) et polices simples (TrueType/Type1, 1 octet) ;
- CMaps ToUnicode (beginbfchar, beginbfrange formes <dst> ET [<u1> <u2> ...]) ;
- reconstruction des espaces/sauts de ligne par géométrie (largeurs de glyphes /W, /Widths,
  matrice de texte Tm/Td/TD/T*, espacement Tc/Tw, échelle Tz).

API : extract_pages(path) -> list[str] ; extract_text(path) -> str.
"""
import re
import zlib


# --------------------------------------------------------------------------- #
# Analyse des objets PDF
# --------------------------------------------------------------------------- #
def _parse_objects(data):
    objs = {}
    matches = list(re.finditer(rb"(\d+)\s+(\d+)\s+obj\b", data))
    for i, m in enumerate(matches):
        num = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(data)
        body = data[start:end]
        sm = re.search(rb"stream\r?\n", body)
        stream = None
        dpart = body
        if sm:
            dpart = body[: sm.start()]
            st = sm.end()
            es = body.find(b"endstream", st)
            stream = body[st:es] if es != -1 else None
        objs[num] = (dpart, stream)
    return objs


def _inflate(s):
    if s is None:
        return None
    for cand in (s, s.rstrip(b"\r\n "), s[:-1], s[:-2]):
        try:
            return zlib.decompress(cand)
        except Exception:
            continue
    try:
        return zlib.decompressobj().decompress(s)
    except Exception:
        return None


def _expand_objstm(objs):
    extra = {}
    for num, (d, s) in list(objs.items()):
        if b"/ObjStm" in d and s is not None:
            dec = _inflate(s)
            if not dec:
                continue
            nM = re.search(rb"/N\s+(\d+)", d)
            fM = re.search(rb"/First\s+(\d+)", d)
            if not (nM and fM):
                continue
            N = int(nM.group(1))
            first = int(fM.group(1))
            header = dec[:first].split()
            try:
                nums = [int(x) for x in header[0::2]]
                offs = [int(x) for x in header[1::2]]
            except ValueError:
                continue
            for j in range(min(N, len(nums))):
                o = first + offs[j]
                e = first + offs[j + 1] if j + 1 < len(offs) else len(dec)
                extra[nums[j]] = (dec[o:e], None)
    objs.update(extra)
    return objs


def _ref(token):
    m = re.match(rb"(\d+)\s+\d+\s+R", token.strip())
    return int(m.group(1)) if m else None


def _find_array(d, key):
    """Renvoie le contenu (octets) du tableau qui suit `key`, gestion des crochets imbriqués."""
    m = re.search(key + rb"\s*\[", d)
    if not m:
        return None
    i = m.end()
    depth = 1
    out = bytearray()
    while i < len(d) and depth > 0:
        c = d[i]
        if c == 0x5B:
            depth += 1
            out.append(c)
        elif c == 0x5D:
            depth -= 1
            if depth == 0:
                break
            out.append(c)
        else:
            out.append(c)
        i += 1
    return bytes(out)


# --------------------------------------------------------------------------- #
# CMap ToUnicode
# --------------------------------------------------------------------------- #
def _safe_cp(cp):
    if 0xD800 <= cp <= 0xDFFF or cp > 0x10FFFF:
        return ""
    try:
        return chr(cp)
    except Exception:
        return ""


def _decode_hexstr(h):
    h = h.strip()
    return "".join(_safe_cp(int(h[j : j + 4], 16)) for j in range(0, len(h) - len(h) % 4 or len(h), 4)) if h else ""


def _parse_tounicode(dec):
    cmap = {}
    txt = dec.decode("latin-1")
    for blk in re.findall(r"beginbfchar(.*?)endbfchar", txt, re.DOTALL):
        for a, b in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
            cmap[int(a, 16)] = _decode_hexstr(b)
    for blk in re.findall(r"beginbfrange(.*?)endbfrange", txt, re.DOTALL):
        # forme tableau : <lo> <hi> [<u1> <u2> ...]
        def arr_repl(m):
            lo = int(m.group(1), 16)
            for k, dh in enumerate(re.findall(r"<([0-9A-Fa-f]+)>", m.group(3))):
                cmap[lo + k] = _decode_hexstr(dh)
            return " "

        blk2 = re.sub(
            r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[((?:\s*<[0-9A-Fa-f]+>)+)\s*\]",
            arr_repl,
            blk,
            flags=re.DOTALL,
        )
        # forme destination : <lo> <hi> <dst>
        for lo, hi, dst in re.findall(
            r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk2
        ):
            li, hii, base = int(lo, 16), int(hi, 16), int(dst, 16)
            for k in range(min(hii - li + 1, 65536)):
                cmap[li + k] = _safe_cp(base + k)
    return cmap


# --------------------------------------------------------------------------- #
# Polices : ToUnicode + largeurs
# --------------------------------------------------------------------------- #
def _parse_W(arr_bytes):
    """Analyse un tableau /W de police CID -> {cid: largeur}."""
    widths = {}
    toks = re.findall(rb"\[|\]|-?\d+\.?\d*", arr_bytes)
    i = 0
    n = len(toks)
    while i < n:
        if toks[i] in (b"[", b"]"):
            i += 1
            continue
        c = int(float(toks[i]))
        i += 1
        if i < n and toks[i] == b"[":
            i += 1  # entre dans la liste
            k = 0
            while i < n and toks[i] != b"]":
                widths[c + k] = float(toks[i])
                k += 1
                i += 1
            if i < n:
                i += 1  # saute ]
        elif i + 1 < n:
            c2 = int(float(toks[i]))
            w = float(toks[i + 1])
            for cc in range(c, min(c2 + 1, c + 70000)):
                widths[cc] = w
            i += 2
    return widths


def _parse_font(objs, fontnum, cache):
    if fontnum in cache:
        return cache[fontnum]
    info = {"cmap": {}, "two": True, "widths": {}, "dw": 500.0}
    if fontnum not in objs:
        cache[fontnum] = info
        return info
    d = objs[fontnum][0]
    is_type0 = b"/Type0" in d
    info["two"] = is_type0
    # ToUnicode
    tm = re.search(rb"/ToUnicode\s+(\d+)\s+\d+\s+R", d)
    if tm:
        r = int(tm.group(1))
        if r in objs and objs[r][1]:
            dec = _inflate(objs[r][1])
            if dec:
                info["cmap"] = _parse_tounicode(dec)
    if is_type0:
        info["dw"] = 1000.0
        dm = re.search(rb"/DescendantFonts\s*(\[?\s*\d+\s+\d+\s+R)", d)
        if dm:
            r = _ref(dm.group(1).lstrip(b"[").strip())
            if r in objs:
                dd = objs[r][0]
                dwm = re.search(rb"/DW\s+(-?\d+\.?\d*)", dd)
                if dwm:
                    info["dw"] = float(dwm.group(1))
                warr = _find_array(dd, rb"/W")
                if warr:
                    info["widths"] = _parse_W(warr)
    else:
        info["dw"] = 500.0
        fcm = re.search(rb"/FirstChar\s+(\d+)", d)
        warr = _find_array(d, rb"/Widths")
        if fcm and warr:
            fc = int(fcm.group(1))
            ws = [float(x) for x in re.findall(rb"-?\d+\.?\d*", warr)]
            for k, w in enumerate(ws):
                info["widths"][fc + k] = w
        if not info["cmap"]:
            info["cmap"] = _encoding_cmap(objs, d)
    cache[fontnum] = info
    return info


# Noms de glyphes courants -> Unicode (pour /Differences).
_GLYPHS = {
    "space": " ", "exclam": "!", "quotedbl": '"', "numbersign": "#", "dollar": "$",
    "percent": "%", "ampersand": "&", "quotesingle": "'", "parenleft": "(",
    "parenright": ")", "asterisk": "*", "plus": "+", "comma": ",", "hyphen": "-",
    "period": ".", "slash": "/", "colon": ":", "semicolon": ";", "less": "<",
    "equal": "=", "greater": ">", "question": "?", "at": "@", "bracketleft": "[",
    "backslash": "\\", "bracketright": "]", "underscore": "_", "braceleft": "{",
    "bar": "|", "braceright": "}", "asciitilde": "~",
    "bullet": "•", "periodcentered": "·", "endash": "–",
    "emdash": "—", "quoteleft": "‘", "quoteright": "’",
    "quotedblleft": "“", "quotedblright": "”", "ellipsis": "…",
    "guillemotleft": "«", "guillemotright": "»", "degree": "°",
    "eacute": "é", "egrave": "è", "ecircumflex": "ê",
    "edieresis": "ë", "agrave": "à", "acircumflex": "â",
    "ccedilla": "ç", "ugrave": "ù", "ucircumflex": "û",
    "icircumflex": "î", "idieresis": "ï", "ocircumflex": "ô",
    "Eacute": "É", "Egrave": "È", "Agrave": "À", "Ccedilla": "Ç",
    "oe": "œ", "OE": "Œ", "ae": "æ", "fi": "fi", "fl": "fl",
}


def _glyph_to_unicode(name):
    if name in _GLYPHS:
        return _GLYPHS[name]
    if name.startswith("uni") and len(name) >= 7:
        try:
            return _safe_cp(int(name[3:7], 16))
        except Exception:
            return ""
    if len(name) == 1:
        return name
    return ""


def _encoding_cmap(objs, d):
    """Construit code -> caractère pour une police simple sans ToUnicode."""
    base = "cp1252"  # WinAnsi par défaut
    diffs = None
    enc = re.search(rb"/Encoding\s*(/[A-Za-z0-9]+|\d+\s+\d+\s+R)", d)
    if enc:
        v = enc.group(1)
        if v.startswith(b"/"):
            if v == b"/MacRomanEncoding":
                base = "mac_roman"
            elif v == b"/StandardEncoding":
                base = "latin-1"
        else:
            r = _ref(v)
            if r in objs:
                ed = objs[r][0]
                if re.search(rb"/BaseEncoding\s*/MacRomanEncoding", ed):
                    base = "mac_roman"
                diffs = _find_array(ed, rb"/Differences")
    cmap = {}
    for code in range(32, 256):
        try:
            ch = bytes([code]).decode(base)
            if ch.isprintable():
                cmap[code] = ch
        except Exception:
            pass
    if diffs:
        cur = 0
        for tok in re.findall(rb"\d+|/[A-Za-z0-9._]+", diffs):
            if tok[:1] != b"/":
                cur = int(tok)
            else:
                u = _glyph_to_unicode(tok[1:].decode("latin-1"))
                if u:
                    cmap[cur] = u
                cur += 1
    return cmap


# --------------------------------------------------------------------------- #
# Tokeniseur de flux de contenu
# --------------------------------------------------------------------------- #
def _unescape(b):
    out = bytearray()
    i = 0
    mp = {0x6E: 0x0A, 0x72: 0x0D, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0C,
          0x28: 0x28, 0x29: 0x29, 0x5C: 0x5C}
    while i < len(b):
        c = b[i]
        if c == 0x5C and i + 1 < len(b):
            nx = b[i + 1]
            if nx in mp:
                out.append(mp[nx]); i += 2; continue
            if 0x30 <= nx <= 0x37:
                mm = re.match(rb"[0-7]{1,3}", b[i + 1 : i + 4])
                s = mm.group(0)
                out.append(int(s, 8) & 0xFF); i += 1 + len(s); continue
            if nx in (0x0A, 0x0D):
                i += 2; continue
            out.append(nx); i += 2; continue
        out.append(c); i += 1
    return bytes(out)


_DELIM = set(b" \t\r\n\x00\x0c/[]<>(){}%")


def _tokenize(s):
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c in b" \t\r\n\x00\x0c":
            i += 1; continue
        if c == 0x25:  # commentaire %
            j = s.find(b"\n", i); i = j + 1 if j != -1 else n; continue
        if c == 0x28:  # (
            depth = 1; j = i + 1; buf = bytearray()
            while j < n and depth > 0:
                ch = s[j]
                if ch == 0x5C and j + 1 < n:
                    buf.append(s[j]); buf.append(s[j + 1]); j += 2; continue
                if ch == 0x28:
                    depth += 1
                elif ch == 0x29:
                    depth -= 1
                    if depth == 0:
                        j += 1; break
                buf.append(ch); j += 1
            yield ("str", bytes(buf)); i = j; continue
        if c == 0x3C:  # <
            if i + 1 < n and s[i + 1] == 0x3C:
                yield ("op", "<<"); i += 2; continue
            j = s.find(b">", i)
            if j == -1:
                break
            yield ("hex", s[i + 1 : j]); i = j + 1; continue
        if c == 0x3E:
            if i + 1 < n and s[i + 1] == 0x3E:
                yield ("op", ">>"); i += 2; continue
            i += 1; continue
        if c == 0x5B:
            yield ("arr_open", "["); i += 1; continue
        if c == 0x5D:
            yield ("arr_close", "]"); i += 1; continue
        if c == 0x2F:  # /nom (sans le slash initial)
            j = i + 1
            while j < n and s[j] not in _DELIM:
                j += 1
            yield ("name", s[i + 1 : j].decode("latin-1")); i = j; continue
        j = i
        while j < n and s[j] not in _DELIM:
            j += 1
        w = s[i:j]; i = j
        if re.fullmatch(rb"[-+]?\d*\.?\d+", w):
            yield ("num", float(w))
        else:
            yield ("op", w.decode("latin-1"))


# --------------------------------------------------------------------------- #
# Interprétation du texte
# --------------------------------------------------------------------------- #
def _decode_content(content, page_fonts):
    out = []
    stack = []
    fontsize = 1.0
    curfont = None
    Tc = 0.0
    Tw = 0.0
    Th = 1.0
    TL = 0.0
    Tm = [1, 0, 0, 1, 0, 0]
    Tlm = [1, 0, 0, 1, 0, 0]
    state = {"px": None, "py": None}

    def fi():
        return page_fonts.get(curfont, {"cmap": {}, "two": True, "widths": {}, "dw": 500.0})

    def show(sval):
        if sval is None:
            return
        typ, raw = sval
        if typ == "str":
            raw = _unescape(raw)
        else:
            hx = re.sub(rb"\s", b"", raw)
            if len(hx) % 2:
                hx += b"0"
            try:
                raw = bytes.fromhex(hx.decode("latin-1"))
            except Exception:
                return
        info = fi()
        cmap, two, widths, dw = info["cmap"], info["two"], info["widths"], info["dw"]
        if two:
            codes = [raw[k] * 256 + raw[k + 1] for k in range(0, len(raw) - 1, 2)]
        else:
            codes = list(raw)
        # échelle horizontale de la matrice de texte (la taille de police peut être
        # portée par Tm plutôt que par Tf)
        a, b = Tm[0], Tm[1]
        scale = (a * a + b * b) ** 0.5 or 1.0
        eff = max(fontsize * scale, 1e-3)
        x = Tm[4]
        y = Tm[5]
        for code in codes:
            ch = cmap.get(code, "")
            disp = (widths.get(code, dw) / 1000.0 * fontsize
                    + Tc + (Tw if (code == 32 and not two) else 0)) * Th
            adv = disp * scale
            if state["px"] is not None:
                dy = abs(y - state["py"])
                if dy > 1.8 * eff:
                    out.append("\n\n")
                elif dy > 0.4 * eff:
                    out.append("\n")
                elif (x - state["px"]) > 0.20 * eff and not (ch and ch.isspace()):
                    out.append(" ")
            out.append(ch)
            x += adv
            state["px"] = x
            state["py"] = y
        Tm[4] = x

    for typ, val in _tokenize(content):
        if typ == "num":
            stack.append(val)
        elif typ == "name":
            stack.append(("name", val))
        elif typ == "str":
            stack.append(("str", val))
        elif typ == "hex":
            stack.append(("hex", val))
        elif typ == "arr_open":
            stack.append("[")
        elif typ == "arr_close":
            arr = []
            while stack and stack[-1] != "[":
                arr.append(stack.pop())
            if stack:
                stack.pop()
            arr.reverse()
            stack.append(("arr", arr))
        elif typ == "op":
            op = val
            if op == "BT":
                Tm = [1, 0, 0, 1, 0, 0]; Tlm = Tm[:]
            elif op == "Tf":
                if stack:
                    fontsize = stack[-1] if isinstance(stack[-1], float) else 1.0
                if len(stack) >= 2 and isinstance(stack[-2], tuple) and stack[-2][0] == "name":
                    curfont = stack[-2][1]
                stack = []
            elif op == "Tm":
                nums = [v for v in stack if isinstance(v, float)]
                if len(nums) >= 6:
                    Tm = nums[-6:]; Tlm = Tm[:]
                stack = []
            elif op in ("Td", "TD"):
                nums = [v for v in stack if isinstance(v, float)]
                if len(nums) >= 2:
                    tx, ty = nums[-2], nums[-1]
                    if op == "TD":
                        TL = -ty
                    a, b, c, d, e, f = Tlm
                    Tlm = [a, b, c, d, e + tx * a + ty * c, f + tx * b + ty * d]
                    Tm = Tlm[:]
                stack = []
            elif op == "T*":
                a, b, c, d, e, f = Tlm
                ty = -TL
                Tlm = [a, b, c, d, e + ty * c, f + ty * d]
                Tm = Tlm[:]
            elif op == "TL":
                if stack and isinstance(stack[-1], float):
                    TL = stack[-1]
                stack = []
            elif op == "Tc":
                if stack and isinstance(stack[-1], float):
                    Tc = stack[-1]
                stack = []
            elif op == "Tw":
                if stack and isinstance(stack[-1], float):
                    Tw = stack[-1]
                stack = []
            elif op == "Tz":
                if stack and isinstance(stack[-1], float):
                    Th = stack[-1] / 100.0
                stack = []
            elif op in ("Tj", "'", '"'):
                if op in ("'", '"'):
                    a, b, c, d, e, f = Tlm
                    ty = -TL
                    Tlm = [a, b, c, d, e + ty * c, f + ty * d]
                    Tm = Tlm[:]
                sval = next((s for s in reversed(stack)
                             if isinstance(s, tuple) and s[0] in ("str", "hex")), None)
                show(sval)
                stack = []
            elif op == "TJ":
                arr = next((s for s in reversed(stack)
                            if isinstance(s, tuple) and s[0] == "arr"), None)
                if arr:
                    for el in arr[1]:
                        if isinstance(el, float):
                            sc = (Tm[0] ** 2 + Tm[1] ** 2) ** 0.5 or 1.0
                            Tm[4] -= (el / 1000.0) * fontsize * Th * sc
                        elif isinstance(el, tuple) and el[0] in ("str", "hex"):
                            show(el)
                stack = []
            else:
                stack = []
    return "".join(out)


# --------------------------------------------------------------------------- #
# API publique
# --------------------------------------------------------------------------- #
def _page_fonts(objs, page_dict):
    """Construit {nom_police: info} pour une page donnée."""
    fdict = None
    rm = re.search(rb"/Font\s*(<<.*?>>|\d+\s+\d+\s+R)", page_dict, re.DOTALL)
    if rm:
        v = rm.group(1)
        if v.startswith(b"<<"):
            fdict = v
        else:
            r = _ref(v)
            if r in objs:
                fr = re.search(rb"/Font\s*(<<.*?>>)", objs[r][0], re.DOTALL)
                fdict = fr.group(1) if fr else objs[r][0]
    if not fdict:
        rr = re.search(rb"/Resources\s+(\d+\s+\d+\s+R)", page_dict)
        if rr:
            r = _ref(rr.group(1))
            if r in objs:
                fr = re.search(rb"/Font\s*(<<.*?>>)", objs[r][0], re.DOTALL)
                fdict = fr.group(1) if fr else None
    page_fonts = {}
    if fdict:
        cache = {}
        for nm, rn in re.findall(rb"/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R", fdict):
            page_fonts[nm.decode("latin-1")] = _parse_font(objs, int(rn), cache)
    return page_fonts


def _ordered_pages(objs):
    """Renvoie les dictionnaires de pages dans l'ordre du document si possible."""
    pages = [(n, d) for n, (d, s) in objs.items()
             if b"/Type" in d and re.search(rb"/Type\s*/Page\b", d) and b"/Pages" not in d]
    # tri par numéro d'objet (approxime l'ordre dans ces fichiers)
    pages.sort(key=lambda t: t[0])
    return pages


def extract_pages(path):
    data = open(path, "rb").read()
    objs = _expand_objstm(_parse_objects(data))
    out = []
    for num, d in _ordered_pages(objs):
        pf = _page_fonts(objs, d)
        cm = re.search(rb"/Contents\s+(\d+\s+\d+\s+R|\[[^\]]*\])", d)
        content = b""
        if cm:
            for rr in re.findall(rb"(\d+)\s+\d+\s+R", cm.group(1)):
                r = int(rr)
                if r in objs and objs[r][1]:
                    dec = _inflate(objs[r][1])
                    if dec:
                        content += dec + b"\n"
        if content and pf:
            out.append(_decode_content(content, pf))
        else:
            out.append("")
    return out


def extract_text(path):
    return "\n".join(extract_pages(path))


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        pages = extract_pages(p)
        txt = "\n".join(pages)
        print(f"=== {p} : {len(pages)} pages, {len(txt)} caractères ===")
        print(txt[:2000])
