# DASHH: Voidfall

Ett 3D arena-survivalspel i tredjeperson som körs i webbläsaren. Ligger som beta
på <https://rastegar.se/games/dashh/>. Källkoden: <https://github.com/PajBram/dashh>.

**Ägare:** Paj (pajam98@hotmail.com). **Inte utvecklare** — förklara tekniska val
i klarspråk på svenska och säg tydligt till när Paj behöver göra något själv.

**Språk:** svenska överallt — mot Paj, i spelets gränssnitt, i kodkommentarer och
i den här filen. Commit-meddelanden på engelska. Att spelet är svenskt medan
rastegar.se i övrigt är engelsk är ett medvetet beslut, dokumenterat i sajtens
egen CLAUDE.md. **Översätt inte spelet.**

---

## Bärande principer

1. **Noll beroenden.** Ren WebGL2 och vanilla ES-moduler. Inget npm, inga
   bibliotek, inga byggverktyg utöver `tools/bundle.py`, inga bildfiler och inga
   ljudfiler. Maskinen saknar `node` — allt som kräver det är uteslutet.
2. **Allt genereras i kod.** Varje mesh, terräng, byggnad, monster och ljud
   skapas proceduralt när sidan laddas. Lägg inte till assets.
3. **Två världar, en motor.** `WORLD_ID` i `noise.js` styr terräng och regler.
   Vildheim är vildmark med svärd; Neotropolis är neonstad där man flyger och
   skjuter laser. Det som skiljer dem ska ligga bakom `worldId`, inte i kopierad
   kod.
4. **Mus och tumme är likvärdiga.** Allt måste gå att spela både med
   tangentbord/mus och med touch. Touchknappar trycker samma virtuella tangenter
   som tangentbordet, så spelogiken slipper veta om fingrar.
5. **Två spelsätt, samma värld.** `mode` i `game.js` är `survival` (vågor mot
   arenan, `WaveManager`) eller `adventure` (nivåer med utplacerade läger,
   `AdventureManager`). Båda använder samma monster, vapen och uppgraderingar —
   det som skiljer dem är var monstren finns och vad som avslutar en omgång.
   Äventyret är komplett enligt planen: uppdrag, shop, rustning, checkpoints
   och egna bossar (Jordvredet i Vildheim, Saneraren i Neotropolis — tre
   faser vid 2/3 och 1/3 hälsa). Vågläget behåller Voidlord/Overseer.

   **Två sorters progression i äventyret, med flit:** slumpade
   uppgraderingskort vid nivå-upp (`upgrades.js`) *och* varor man själv
   väljer för guld i shoppen mellan nivåerna (`shop.js`). Blanda inte ihop
   dem — poängen är att den ena är tur och den andra är ett beslut.

---

## Kommandon

```bash
python3 -m http.server 8123      # kör src/ direkt, öppna http://localhost:8123
python3 tools/bundle.py          # bygg enfilsversionen dist/dashh.html
```

`dist/` är byggresultat och ligger i `.gitignore`.

**Publicera till hemsidan** (separat repo i `~/rastegar.se`, GitHub Pages,
deploy vid push till `main`):

```bash
python3 tools/bundle.py
cp dist/dashh.html ~/rastegar.se/static/games/dashh.html
cd ~/rastegar.se && python3 build.py && git add -A && git commit && git push
```

Spelkortet på sajten är `content/games/dashh.json`, ramen kring spelet
`static/games/dashh-frame.js`, omslaget `static/img/games/dashh.svg`.
Fullscreen sköts av sajtens egen `static/js/fullscreen.js` — bygg ingen egen.

---

## Struktur

| Fil | Ansvar |
|---|---|
| `index.html` | canvas, HUD-markup, touchkontroller, all CSS |
| `src/math.js` | vektorer, 4x4-matriser, utjämning |
| `src/noise.js` | brus, terränghöjd, `WORLD_ID`, stadens kvarter |
| `src/meshes.js` | proceduella meshar |
| `src/gl.js` | WebGL2-lager: program, instansbatchar, billboards |
| `src/shaders.js` | all GLSL |
| `src/terrain.js` | terrängmesh, färg, utplacering, kollisionsrutnät |
| `src/renderer.js` | kamera, scenrendering, partiklar, dag/natt |
| `src/audio.js` | alla ljud syntetiseras i WebAudio |
| `src/input.js` | tangentbord, mus, pointer lock, touch |
| `src/player.js` | rörelse, dash, kamerarigg, spelarmodell |
| `src/enemies.js` | 8 fiendetyper med AI, dödsanimation, vågsystem, vaktläge |
| `src/missions.js` | äventyrets fyra uppdragstyper + bossuppdraget |
| `src/adventure.js` | äventyrsläget: nivåer, läger, uppdragsval, skyddsnät |
| `src/combat.js` | svärd, laser, eldboll, explosioner, drops |
| `src/upgrades.js` | uppgraderingskorten (slumpade vid nivå-upp) |
| `src/shop.js` | butiksvarorna man köper för guld mellan nivåerna |
| `src/hud.js` | HUD, radar, skadesiffror, menyskärmar |
| `src/game.js` | speltillstånd, hitstop, huvudloop |

---

## Sådant som är lätt att gå bakåt på

- **Kameran.** Den är intrimmad mot ArcLight (johanslekstuga.com): figuren tar
  ~15 % av bildhöjden, sitter ~60 % ner och något åt vänster. Vyn ska stå
  **blickstilla** tills spelaren aktivt vrider den — en kamera som kryper av sig
  själv var det som kändes obehagligt förut. Utan pointer lock sveper vyn först
  när pekaren når yttersta skärmkanten.
- **Siktet.** Korshåret sitter där muspekaren är, och skottet går exakt dit.
  Strålen räknas ut från kamerans *faktiska* blickriktning, inte den ideala
  vinkeln — annars blir siktet några grader fel.
- **Hitstop.** Tunga träffar fryser världen 40–90 ms. Håll andelen frysta
  bildrutor runt någon enstaka procent, annars känns det som hack.
- **Drönarnas omloppsbana.** De cirklar på 13 meters radie och 4,5 m höjd. Tar
  man bort den radiella termen spiralar de in och hamnar **rakt ovanför**
  spelaren, på 60–86° höjdvinkel — dit går det inte att sikta. Då dör de aldrig,
  vågen rensas aldrig och spawningen upphör. Det var en riktig bugg 2026-08-13.
- **Lägrens avstånd i äventyret.** Vakter vaknar när spelaren är inom ~28 m, så
  ett läger måste placeras minst 45 m bort (marginal för att lägret sprider sig
  och för att man rör sig medan nivån laddar). Läggs det närmare vaknar allt i
  samma stund nivån börjar och rusar mot spelaren — och då är kartan inte en
  karta, bara en våg som råkade starta längre bort. Det hände i första försöket
  2026-08-14.
- **Rustningen har inget tak, och ska inte få det.** Dämpningen är
  `skada / (1 + rustning * 0.06)` — avtagande, så nivå 50 ger 75 % och nivå
  100 ger 86 %, men aldrig odödlighet. Byt inte till procent per nivå: då blir
  spelaren osårbar vid nivå 17 och resten av äventyret är meningslöst.
- **Checkpointen tas när man lämnar shoppen**, inte när nivån är rensad —
  annars förloras det man precis handlade för sitt surt förvärvade guld.
  Den sparas i `localStorage` och överlever att fliken stängs. En checkpoint
  från ett *tidigare* äventyr erbjuds bara i menyn, aldrig på dödsskärmen
  (`cp.level < adventure.level`), annars katapulteras en ny körning framåt.
- **Bundlern har en enda namnrymd.** `tools/bundle.py` klistrar ihop alla
  moduler i samma scope, så två filer som döper något på toppnivå till samma
  sak fungerar i `src/` men ger en **vit skärm** i `dist/`. Det hände med
  `TYPES` (fiendetyper i `enemies.js`, uppdragstyper i `missions.js`) den
  2026-08-14. Bundlern vägrar numera bygga vid krock — testa alltid
  `dist/dashh.html`, inte bara `src/`.
- **En ny äventyrsnivå är en ny karta.** `startLevel` rensar gamla monster,
  skott och orbs. Utan det ligger allt man gick förbi kvar och staplas nivå
  för nivå tills kartan är full och spelaren dör i mellanrummet.
- **Vågens skyddsnät.** Efter 12 s i `clearing` hetsas eftersläntrare att jaga
  spelaren, efter 26 s startar nästa våg ändå. Ta inte bort det: utan det kan en
  enda oåtkomlig fiende låsa hela rundan.
- **Kamerans uppåtgräns** är 1,0 rad (~57°) just för att fiender kommer
  ovanifrån i staden. Sänk den inte tillbaka.
- **Husens avsatser bor i `noise.js`** (`b.tiers`). Utseendet i `renderer.js`,
  kollisionsrektanglarna i `terrain.js` och markhöjden i `terrainHeight` läser
  alla samma lista. Ändrar man formen på ett ställe men inte de andra går man
  på luft vid en avsats, eller studsar mot en osynlig vägg.
- **Monsterstorlek sitter i `Enemy.scale`**, som både `radius`/`height` och
  ritningens `shrink` läser. Skalar man bara modellen skjuter man på luft;
  skalar man bara radien uppstår osynliga väggar. Neotropolis maskiner går på
  1,35 — Vildheims djur och alla bossar på 1.
- **Mått i push() är hela meter**, inte halva. En bil på 3 m försvinner sedd
  från gatan trettio meter under — flygtaxibilarna är 5,4 m av det skälet.
- **Neotropolis fönster är enskilda rutor, mest släckta.** Band runt hela
  fasaden blir lysande lameller som ser ut som bokhyllor; det är mörkret
  mellan rutorna som gör att de tända läser som ljus. Höj inte andelen tända.
- **Sanerarens cirkling har en radiell term** (`(dist − ring) * 0.15`) av
  exakt samma skäl som drönarnas: utan den spiralar den in rakt över
  spelaren där siktet inte når. Uppmätt 23–27 m och ≤6° höjdvinkel — håll
  det så.
- **Vapnen låter olika.** Svärdet har låg duns + metallklang, lasern torrt
  högpassat knäpp utan bas, och båda varierar några procent i tonhöjd. Slå inte
  ihop dem till ett gemensamt träffljud igen — det var så det lät förut och det
  var det som kändes fel.
- **Porträttläge.** Smala skärmar vidgar synfältet (`renderer.js`), annars blir
  vyn ett titthål. Vidgningen är klampad — utan klamp blir gubben för liten.
- **Modulcache.** Webbläsaren cachar `src/*.js` hårt. Testar du en ändring och
  inget händer: testa `dist/dashh.html?cb=nånting` i stället.
