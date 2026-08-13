#!/usr/bin/env python3
"""Slår ihop index.html + src/*.js till en självständig dist/dashh.html.

Modulerna skrivs med toppnivå-`import`/`export`, så bundlingen är enkel:
strippa import-rader, ta bort `export`-nyckelord och konkatenera i
beroendeordning inuti en enda <script type="module">.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "dist" / "dashh.html"

# Beroendeordning (löv först).
ORDER = [
    "math.js", "noise.js", "meshes.js", "gl.js", "shaders.js", "terrain.js",
    "renderer.js", "audio.js", "input.js", "upgrades.js", "player.js",
    "enemies.js", "combat.js", "hud.js", "game.js", "main.js",
]

IMPORT_RE = re.compile(r"^import\s.*?;\s*$", re.M | re.S)
EXPORT_KW_RE = re.compile(r"^export\s+(?=(?:const|let|var|function|class)\b)", re.M)


def strip_module_syntax(code: str, name: str) -> str:
    if re.search(r"^import \* as", code, re.M):
        sys.exit(f"{name}: namespace-import (import * as) stöds inte av bundlern")
    code = IMPORT_RE.sub("", code)
    code, _ = EXPORT_KW_RE.subn("", code)
    if re.search(r"^\s*export\b", code, re.M):
        sys.exit(f"{name}: kvarvarande export-sats som bundlern inte hanterar")
    return code.strip()


def main() -> None:
    missing = [n for n in ORDER if not (SRC / n).exists()]
    extra = [p.name for p in SRC.glob("*.js") if p.name not in ORDER]
    if missing or extra:
        sys.exit(f"ORDER stämmer inte med src/: saknas={missing} okända={extra}")

    parts = []
    for name in ORDER:
        code = strip_module_syntax((SRC / name).read_text(encoding="utf-8"), name)
        parts.append(f"// ═══ {name} ═══\n{code}")
    bundle = "\n\n".join(parts)

    html = (ROOT / "index.html").read_text(encoding="utf-8")
    tag = '<script type="module" src="src/main.js"></script>'
    if tag not in html:
        sys.exit("hittar inte module-script-taggen i index.html")
    html = html.replace(tag, "<script>\n" + bundle + "\n</script>")
    # file://-felmeddelandet behövs inte i enfilsversionen
    html = re.sub(r"<script>\s*// Visa ett begripligt fel.*?</script>", "", html, flags=re.S)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"Skrev {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} kB)")


if __name__ == "__main__":
    main()
