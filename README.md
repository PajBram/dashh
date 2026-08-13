# DASHH — Voidfall

Ett 3D arena-survivalspel i tredjeperson, byggt i ren WebGL2 utan några som
helst beroenden — inga bibliotek, inga byggverktyg, inga assets att ladda.
Överlev vågor av fiender, samla XP, välj uppgraderingar och möt en boss var
femte våg. Kärnmekaniken är **dash**: en snabb förflyttning med
osårbarhetsfönster.

## Två världar

Vid start väljer du värld:

- **VILDHEIM** — procedurgenererad vildmark med skogar, sjöar, berg och
  dag/natt-cykel. Du är en krigare i läder som slåss med **svärd** och
  kastar **eldboll** med `C` (10 s nedkylning). Tre hugg i följd ger en
  **finisher** — överhandshugg med glödande klinga, extra skada och lyft.
  Eldbollen lämnar **brinnande mark** som fortsätter skada i några sekunder.
- **NEOTROPOLIS** — neonstad i evig natt. Du är en cyborg som **flyger**
  (håll mellanslag) mellan skyskraporna och skjuter laser ur handflatorna.
  Hustaken går att landa på, och staden har sin egen robotpark:
  **svärmdrönare** som cirklar högt och störtdyker, **taksnipers** som
  slår sig ner på hustaken och telegraferar skottet med en röd siktlinje,
  och **hover-plattformar** med frontsköld som måste flankeras.
  Bossen heter OVERSEER och kallar in drönare.

## Spela lokalt

```bash
python3 -m http.server 8123
```

Öppna sedan <http://localhost:8123>. (ES-moduler kräver en http-server —
`index.html` kan inte öppnas direkt från Finder. Det kan däremot
`dist/dashh.html`, som är hela spelet i en enda fil.)

## Kontroller

| Tangent | Funktion |
|---|---|
| `WASD` / pilar | Rör dig (relativt kameran) |
| Mus | Sikta — korshåret följer pekaren. Vid skärmkanten svepar vyn (360°). Klicka för muslås, då blir det vanlig FPS-styrning |
| Vänsterklick | Attack — svärd (3-hugg-kombo) i Vildheim, laser i Neotropolis |
| `C` | Eldboll, 10 s nedkylning (Vildheim) |
| `Shift` / `E` | Dash |
| Mellanslag | Hoppa (Vildheim) · håll för att flyga (Neotropolis) |
| Mushjul | Zooma kameran |
| `1`–`3` | Välj uppgraderingskort |
| `Esc` / `P` | Paus |

## Lägga upp spelet på din hemsida

**Alternativ 1 — en enda fil (enklast).** Ladda upp `dist/dashh.html` till
ditt webbhotell och länka till den, eller bädda in den på en sida:

```html
<iframe src="dashh.html"
        style="width:100%;aspect-ratio:16/9;border:0"
        allow="fullscreen; pointer-lock"
        allowfullscreen></iframe>
```

**Alternativ 2 — modulär.** Ladda upp `index.html` och hela `src/`-mappen
som de är. Kräver bara att sidan servas över http/https (vilket alla
webbhotell gör).

Har du ändrat något i `src/`? Bygg om enfilsversionen med:

```bash
python3 tools/bundle.py
```

## Kodstruktur

| Fil | Ansvar |
|---|---|
| `src/math.js` | vektor/matris-matte, slump, utjämning |
| `src/noise.js` | värdebrus, terränghöjd, arenagräns |
| `src/meshes.js` | procedurgenererade meshar |
| `src/gl.js` | WebGL2-lager: program, instansbatchar, billboards |
| `src/shaders.js` | all GLSL (terräng, instanser, skuggor, partiklar, himmel, vatten) |
| `src/terrain.js` | terrängmesh, färgsättning, utplacering av träd/stenar, kollisionsrutnät |
| `src/renderer.js` | kamera, scenrendering, partikelsystem, dag/natt-palett |
| `src/audio.js` | alla ljud syntetiseras i WebAudio |
| `src/input.js` | tangentbord, mus, pointer lock |
| `src/player.js` | rörelse, dash, tredjepersonskamera, spelarmodell |
| `src/enemies.js` | 8 fiendetyper med AI (3 unika för staden) + vågsystemet |
| `src/combat.js` | projektiler, explosioner, drops, upplockning |
| `src/upgrades.js` | de 16 uppgraderingskorten |
| `src/hud.js` | HUD, minimap, menyskärmar |
| `src/game.js` | speltillstånd och huvudloop |
