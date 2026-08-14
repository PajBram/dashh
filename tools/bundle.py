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
    "renderer.js", "audio.js", "input.js", "upgrades.js", "shop.js", "player.js",
    "enemies.js", "missions.js", "adventure.js", "combat.js", "hud.js", "game.js", "main.js",
]

IMPORT_RE = re.compile(r"^import\s.*?;\s*$", re.M | re.S)
EXPORT_KW_RE = re.compile(r"^export\s+(?=(?:const|let|var|function|class)\b)", re.M)
# namn deklarerade längst ut i en modul (utan indrag)
TOPLEVEL_RE = re.compile(r"^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)", re.M)


def check_collisions(modules: dict) -> None:
    """
    Alla moduler hamnar i samma namnrymd i enfilsversionen. Två filer som
    döper något till samma sak funkar därför i src/ men ger en vit skärm i
    dist/ — det ska upptäckas här, inte av den som spelar.
    """
    seen = {}
    clashes = []
    for name, code in modules.items():
        for decl in set(TOPLEVEL_RE.findall(code)):
            if decl in seen:
                clashes.append(f"{decl} finns i både {seen[decl]} och {name}")
            else:
                seen[decl] = name
    if clashes:
        sys.exit("namnkrock mellan moduler:\n  " + "\n  ".join(clashes))


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

    modules = {}
    for name in ORDER:
        modules[name] = strip_module_syntax((SRC / name).read_text(encoding="utf-8"), name)
    check_collisions(modules)
    bundle = "\n\n".join(f"// ═══ {n} ═══\n{c}" for n, c in modules.items())

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
