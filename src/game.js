// Spelets nav: tillstånd, huvudloop och limmet mellan alla system.
import { clamp, lerp, rand, TAU } from './math.js';
import { Renderer, computeEnv } from './renderer.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { HUD } from './hud.js';
import { Player } from './player.js';
import { Enemy, WaveManager } from './enemies.js';
import { AdventureManager, CHECKPOINT_EVERY } from './adventure.js';
import { Combat } from './combat.js';
import { rollChoices, recalc } from './upgrades.js';
import { WARES, REPAIR, priceOf, repairPrice } from './shop.js';
import { terrainHeight, WATER_LEVEL, SEASON, randomSeasonId } from './noise.js';

const DAY_LENGTH = 320;   // sekunder per dygn

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.particles = this.renderer.particles;
    this.colliders = this.renderer.props.grid;
    this.input = new Input(canvas);
    this.sound = new Sound();
    this.hud = new HUD();
    this.combat = new Combat();
    this.waves = new WaveManager();
    this.adventure = new AdventureManager();
    this.player = new Player(this);
    this.enemies = [];
    this.state = 'menu';
    this.worldId = 'wild';
    this.mode = 'survival';   // 'survival' = vågor, 'adventure' = nivåer
    this.usedLock = false;
    this.best = this.loadBest();
    this.checkpoint = this.loadCheckpoint();
    this.fps = 60;
    this.frameCount = 0;
    this.resetRun();

    this.input.onLockChange = (locked) => {
      if (locked) this.usedLock = true;
      else if (this.state === 'playing' && this.usedLock) this.pause();
    };
    canvas.addEventListener('mousedown', () => {
      if (this.state === 'playing' && !this.input.locked && !this.input.touch) this.input.requestLock();
    });
    for (const el of document.querySelectorAll('.tBtn')) this.input.bindButton(el);
  }

  // ---------------------------------------------------------------- tillstånd

  loadBest() {
    const empty = { wave: 0, kills: 0, stage: 0 };
    try {
      return Object.assign(empty, JSON.parse(localStorage.getItem('dashh.best')));
    } catch (e) { return empty; }
  }

  saveBest() {
    this.best.wave = Math.max(this.best.wave, this.waves.wave);
    this.best.stage = Math.max(this.best.stage, this.adventure.level);
    this.best.kills = Math.max(this.best.kills, this.kills);
    try { localStorage.setItem('dashh.best', JSON.stringify(this.best)); } catch (e) { /* ignoreras */ }
  }

  /* Highscore-listan på sidan utanför.
   *
   * Spelet kör i en iframe på rastegar.se och når inte sidans poängsystem
   * direkt, så de två beskeden som behövs — "en runda började" och "den
   * slutade, så här gick det" — skickas ut med postMessage. Kör spelet
   * utanför en ram händer ingenting; window.parent är då fönstret självt
   * och ingen lyssnar.
   *
   * Bara ÖVERLEVNAD rapporteras. Äventyret återupptas från checkpoints, så
   * en körning där är flera försök och går inte att jämföra med någon annans.
   *
   * DEN HÄR KODEN MÅSTE BO HÄR, inte i den byggda filen på sajten. Den låg
   * först inklistrad i `static/games/dashh.html`, och nästa `bundle.py` hade
   * raderat highscore-listan utan att någon märkt det.
   */
  runScore() {
    // Vågen i kvadrat: djup ska väga tyngre än uthållighet, så våg 20 är värd
    // fyra gånger våg 10 och inte två. Kills är belöningen inne i varje våg.
    return this.waves.wave * this.waves.wave * 50 + this.kills * 25;
  }

  postToPage(payload) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, window.location.origin);
      }
    } catch (e) { /* ingen ram, eller annan origin — strunt samma */ }
  }

  reportStart() {
    if (this.mode !== 'survival') return;
    this.postToPage({ dashh: 'run-start' });
  }

  reportEnd() {
    if (this.mode !== 'survival') return;
    this.postToPage({
      dashh: 'run-over',
      score: this.runScore(),
      wave: this.waves.wave,
      kills: this.kills,
    });
  }

  /** Svårighetstrappan: vågnummer i överlevnad, nivånummer i äventyret. */
  get tier() {
    return this.mode === 'adventure' ? Math.max(1, this.adventure.level) : this.waves.wave;
  }

  resetRun() {
    this.player.reset();
    this.enemies.length = 0;
    this.combat.reset();
    this.waves.reset();
    this.adventure.reset();
    this.particles.list.length = 0;
    this.upgradeLevels = new Map();
    this.shopLevels = new Map();
    this.gold = 0;
    this.goldEarned = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNeeded = 12;
    this.kills = 0;
    this.elapsed = 0;
    this.damageDealt = 0;
    this.dayTime = 0.34;   // förmiddag — se computeEnv
    this.time = 0;
    this.pendingLevelUps = 0;
    this.ambientTimer = 0;
    this.hitstop = 0;
    this.interludeT = 0;
    // vädret: 0 = uppehåll, 1 = ösregn. Byggs upp och avtar långsamt.
    this.rain = 0;
    this.rainTarget = 0;
    this.weatherTimer = rand(40, 100);
    this.lightning = 0;
    this.thunderTimer = 0;
    this.hud.clearFloaters();
    this.hud.setBoss(null);
  }

  start(worldId, mode, checkpoint = null) {
    if (worldId) this.worldId = worldId;
    if (mode) this.mode = mode;
    if (checkpoint) this.worldId = checkpoint.world;
    // Varje körning i Vildheim får sin årstid. Checkpointen minns sin, så
    // man återvänder till samma skog man lämnade.
    this.season = checkpoint && checkpoint.season ? checkpoint.season : randomSeasonId();
    this.renderer.buildWorld(this.worldId, this.season);
    this.colliders = this.renderer.props.grid;
    this.buildings = this.renderer.props.buildings || null;   // taksnipern behöver dem
    this.sound.init();
    this.sound.resume();
    this.resetRun();
    if (checkpoint) this.applyCheckpoint(checkpoint);
    this.state = 'playing';
    this.reportStart();
    this.hud.hideOverlay();
    this.hud.setMode(this.mode);
    this.hud.showHUD(true);
    const adv = this.mode === 'adventure';
    if (checkpoint) {
      this.hud.showBanner(`LEVEL ${checkpoint.level + 1}`, 'you pick up where you left off', 3);
    } else if (this.worldId === 'city') {
      this.hud.showBanner('NEOTROPOLIS', adv ? 'head out into the city' : 'hold space — fly', 3);
    } else {
      this.hud.showBanner('VILDHEIM', SEASON.name.toLowerCase(), 3);
    }
    this.input.enabled = true;
    if (!this.input.touch) this.input.requestLock();
  }

  showMenu() {
    this.state = 'menu';
    this.input.enabled = false;
    this.input.releaseLock();
    this.hud.showHUD(false);
    this.hud.showModes((m) => this.chooseMode(m));
  }

  /** Spelsättet är valt — nu väljer man värld, eller fortsätter där man var. */
  chooseMode(mode) {
    this.mode = mode;
    const cp = mode === 'adventure' ? this.checkpoint : null;
    this.hud.showStart((w) => this.start(w, mode), this.input.touch, mode,
      () => this.showMenu(), cp, () => this.start(cp.world, mode, cp));
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.releaseLock();
    this.hud.showPause(() => this.resume());
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.enabled = true;
    this.hud.hideOverlay();
    if (!this.input.touch) this.input.requestLock();
    this.sound.resume();
  }

  die() {
    this.state = 'dead';
    this.player.alive = false;
    this.input.enabled = false;
    this.input.releaseLock();
    this.sound.gameOver();
    this.particles.burst(this.player.pos.x, this.player.pos.y + 1.2, this.player.pos.z, 40, {
      speed: 12, life: 1.1, size: 1.0, size2: 0.1, col: [0.4, 0.9, 1.0], alpha: 0.9, drag: 0.7, grav: -8,
    });
    this.saveBest();
    this.reportEnd();
    setTimeout(() => {
      if (this.state !== 'dead') return;
      // I äventyret börjar man om från senast klarade checkpoint, med exakt
      // den utrustning man hade där. Finns ingen checkpoint börjar man om.
      // …men bara om checkpointen hör till just den här körningen. En gammal
      // sparning från ett tidigare äventyr ska inte katapultera en framåt.
      const c = this.checkpoint;
      const cp = this.mode === 'adventure' && c && c.world === this.worldId
        && c.level < this.adventure.level ? c : null;
      this.hud.showGameOver(this, () => this.start(this.worldId, this.mode, cp),
        () => this.showMenu(), cp);
    }, 900);
  }

  // ------------------------------------------------------- gränssnitt utåt

  toast(msg) { this.hud.toast(msg); }

  /** Kort frys vid tunga träffar — det är den som ger slaget tyngd. */
  freeze(sec) { this.hitstop = Math.min(0.16, Math.max(this.hitstop, sec)); }

  /** Skadesiffra som flyger upp ur fienden. */
  floater(x, y, z, amount, crit, key) { this.hud.floater(x, y, z, amount, crit, key); }

  /**
   * `quiet` används av äventyret: monstren står redan på kartan när nivån
   * börjar, så de ska varken ryka in ur tomma intet eller basunera ut sig.
   */
  spawnEnemy(type, x, z, quiet = false) {
    const e = new Enemy(type, x, z, this.tier, this.worldId);
    this.enemies.push(e);
    if (!quiet) {
      this.particles.burst(x, terrainHeight(x, z) + 1, z, e.boss ? 40 : 12, {
        speed: e.boss ? 14 : 6, life: 0.6, size: e.boss ? 1.4 : 0.6,
        col: e.col, alpha: 0.9, drag: 0.7, grav: -4,
      });
      if (e.boss) this.announceBoss(e);
    }
    return e;
  }

  /**
   * En ny äventyrsnivå är en ny karta: det som var kvar av den förra —
   * monster man gick förbi, skott i luften, orbs på marken — försvinner.
   * Utan det staplas monstren på varandra nivå för nivå.
   */
  clearScene() {
    this.enemies.length = 0;
    this.combat.reset();
    this.hud.setBoss(null);
  }

  /** Bosshälsan och fanfaren — i äventyret först när man stöter på den. */
  announceBoss(e) {
    const city = this.worldId === 'city';
    const name = e.def.bossName || (city ? 'OVERSEER' : 'VOIDLORD');
    const sub = e.def.bossSub || (city ? 'the overseer wakes' : 'the voidlord rises');
    this.hud.setBoss(e, name);
    this.hud.showBanner('BOSS', sub, 3);
    this.sound.bossSpawn();
    this.player.shake = 1.2;
  }

  onBossWake(e) { this.announceBoss(e); }

  spawnEnemyBullet(e, target, speed, dmg) { this.combat.enemyBullet(e, target, speed, dmg); }
  spawnEnemyBulletDir(e, dx, dy, dz, speed, dmg) { this.combat.enemyBulletDir(e, dx, dy, dz, speed, dmg); }
  spawnEnemyLob(e, target, hSpeed, dmg, size) { this.combat.enemyLob(e, target, hSpeed, dmg, size); }
  shockwave(x, y, z, r, dmg) { this.combat.shockwave(this, x, y, z, r, dmg); }

  onEnemyKilled(e) {
    this.kills++;
    this.adventure.onKill();
    this.sound.kill();
    this.particles.burst(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, e.boss ? 60 : 16, {
      speed: e.boss ? 16 : 8, life: e.boss ? 1.2 : 0.55, size: e.boss ? 1.5 : 0.6, size2: 0.1,
      col: e.col, alpha: 0.95, drag: 0.7, grav: -6,
    });
    this.combat.dropLoot(this, e);
    this.player.shake = Math.min(1.2, this.player.shake + (e.boss ? 1.0 : 0.12));
    if (e.boss) {
      this.hud.setBoss(null);
      this.hud.showBanner('BOSS DOWN', '', 2.6);
      this.player.shake = 1.0;
    }
  }

  addXP(n) {
    this.xp += n;
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.level++;
      this.xpNeeded = Math.round(12 + this.level * 7 + Math.pow(this.level, 1.7));
      this.pendingLevelUps++;
    }
    if (this.pendingLevelUps > 0 && this.state === 'playing') this.openLevelUp();
  }

  /**
   * Vädret i Vildheim. Regnet kommer och går av sig självt, byggs upp över
   * en halv minut och avtar lika långsamt — inget slås på och av. Under
   * ösregn slår blixtar ner, och åskan hörs efter en fördröjning som beror
   * på hur långt bort nedslaget var, som i verkligheten.
   *
   * Neotropolis regnar inte: det är en inomhusnatt av neon, och regn där
   * skulle bara skymma sikten i en värld där man redan flyger blint.
   */
  updateWeather(dt) {
    if (this.worldId === 'city') { this.rain = 0; this.lightning = 0; return; }

    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      // ungefär var tredje väderomslag blir regn, resten uppehåll
      this.rainTarget = Math.random() < 0.35 ? rand(0.45, 1) : 0;
      this.weatherTimer = this.rainTarget > 0 ? rand(50, 110) : rand(70, 160);
      if (this.rainTarget > 0.8) this.toast('The sky is darkening');
    }
    this.rain += clamp(this.rainTarget - this.rain, -dt * 0.06, dt * 0.045);

    this.lightning = Math.max(0, this.lightning - dt * 3.2);
    if (this.rain > 0.75) {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) {
        this.thunderTimer = rand(6, 22);
        this.lightning = 1;
        // avståndet styr både ljusstyrkan och hur länge det dröjer till dånet
        const far = rand(0.2, 1);
        this.sound.thunder(far);
        this.player.shake = Math.min(1.2, this.player.shake + (1 - far) * 0.5);
      }
    }

    // regndroppar: streck som faller runt spelaren och tar slut vid marken
    if (this.rain > 0.05) {
      const p = this.player.pos;
      const drops = Math.round(this.rain * 26);
      for (let i = 0; i < drops; i++) {
        const a = rand(TAU), d = Math.sqrt(Math.random()) * 26;
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        const gh = Math.max(terrainHeight(x, z), WATER_LEVEL);
        this.particles.spawn({
          x, y: gh + rand(6, 17), z,
          vx: rand(-1, 1), vy: -rand(26, 36), vz: rand(-1, 1),
          life: rand(0.35, 0.6), size: rand(0.06, 0.13), size2: 0.03,
          col: [0.62, 0.78, 0.95], alpha: 0.5, drag: 0,
        });
      }
    }
  }

  addGold(n) {
    this.gold += n;
    this.goldEarned += n;
  }

  addArmor(n) {
    const p = this.player;
    p.armor += n;
    this.sound.tone({ f: 300, f2: 520, dur: 0.16, type: 'triangle', vol: 0.10 });
    this.sound.tone({ f: 600, f2: 900, dur: 0.12, type: 'sine', vol: 0.06, delay: 0.05 });
    this.toast(`🪖 Armour ${p.armor}`);
    this.particles.burst(p.pos.x, p.pos.y + 1.4, p.pos.z, 14, {
      speed: 6, life: 0.5, size: 0.4, size2: 0.05,
      col: [0.72, 0.82, 1.0], alpha: 0.9, drag: 0.6, grav: -3,
    });
  }

  // ------------------------------------------------------------ checkpoints

  /**
   * Var tionde nivå sparas hela utrustningen — och den sparas när man
   * lämnar shoppen, inte när nivån tog slut, så det man hann köpa följer med.
   */
  saveCheckpoint() {
    const p = this.player;
    this.checkpoint = {
      world: this.worldId,
      season: this.season,
      level: this.adventure.level,
      stats: Object.assign({}, p.stats),
      hp: p.hp,
      armor: p.armor,
      gold: this.gold,
      goldEarned: this.goldEarned,
      kills: this.kills,
      damageDealt: this.damageDealt,
      elapsed: this.elapsed,
      xpLevel: this.level,
      xp: this.xp,
      xpNeeded: this.xpNeeded,
      upgrades: [...this.upgradeLevels],
      shop: [...this.shopLevels],
    };
    try { localStorage.setItem('dashh.checkpoint', JSON.stringify(this.checkpoint)); } catch (e) { /* ignoreras */ }
    this.hud.showBanner('CHECKPOINT', `level ${this.adventure.level} saved`, 2.6);
    this.toast(`Checkpoint: level ${this.adventure.level}`);
  }

  loadCheckpoint() {
    try {
      const cp = JSON.parse(localStorage.getItem('dashh.checkpoint'));
      return cp && cp.level ? cp : null;
    } catch (e) { return null; }
  }

  clearCheckpoint() {
    this.checkpoint = null;
    try { localStorage.removeItem('dashh.checkpoint'); } catch (e) { /* ignoreras */ }
  }

  /** Plockar tillbaka spelaren till hur hen såg ut vid checkpointen. */
  applyCheckpoint(cp) {
    const p = this.player;
    Object.assign(p.stats, cp.stats);
    recalc(p.stats);
    p.hp = Math.min(cp.hp, p.stats.maxHp);
    p.armor = cp.armor || 0;
    p.dashCharges = p.stats.dashMax;
    this.gold = cp.gold;
    this.goldEarned = cp.goldEarned || cp.gold;
    this.kills = cp.kills || 0;
    this.damageDealt = cp.damageDealt || 0;
    this.elapsed = cp.elapsed || 0;
    this.level = cp.xpLevel || 1;
    this.xp = cp.xp || 0;
    this.xpNeeded = cp.xpNeeded || 12;
    this.upgradeLevels = new Map(cp.upgrades || []);
    this.shopLevels = new Map(cp.shop || []);
    this.adventure.level = cp.level;      // nästa nivå blir den efter checkpointen
  }

  /** Ett köp i shoppen. Priset stiger för varje exemplar man redan har. */
  buy(id) {
    const p = this.player;
    if (id === REPAIR.id) {
      const cost = repairPrice(p);
      if (!cost || cost > this.gold) { this.sound.denied(); return false; }
      this.gold -= cost;
      p.heal(p.stats.maxHp);
      this.sound.buy();
      return true;
    }
    const w = WARES.find((q) => q.id === id);
    if (!w) return false;
    const owned = this.shopLevels.get(id) || 0;
    const cost = priceOf(w, owned);
    if (owned >= w.max || cost > this.gold) { this.sound.denied(); return false; }
    this.gold -= cost;
    w.apply(p.stats, p);
    recalc(p.stats);
    this.shopLevels.set(id, owned + 1);
    this.sound.buy();
    return true;
  }

  openLevelUp() {
    this.state = 'levelup';
    this.input.enabled = false;
    this.input.releaseLock();
    this.sound.levelUp();
    this.choices = rollChoices(this.upgradeLevels, 3, this.worldId);
    this.hud.showLevelUp(this.level, this.choices, (i) => this.pickUpgrade(i));
  }

  pickUpgrade(i) {
    const u = this.choices[i];
    if (!u) return;
    u.apply(this.player.stats, this.player);
    recalc(this.player.stats);
    this.upgradeLevels.set(u.id, (this.upgradeLevels.get(u.id) || 0) + 1);
    this.toast(`${u.icon} ${u.name}`);
    this.pendingLevelUps--;
    this.sound.pickup();
    if (this.pendingLevelUps > 0) { this.openLevelUp(); return; }
    this.state = 'playing';
    this.input.enabled = true;
    this.hud.hideOverlay();
    if (!this.input.touch) this.input.requestLock();
  }

  onWaveStart(wave, isBoss) {
    this.hud.showBanner(`WAVE ${wave}`, isBoss ? 'something big is coming' : '');
    this.sound.waveStart();
  }

  onWaveClear(wave) {
    this.hud.showBanner('WAVE CLEARED', 'next one starts shortly', 2.0);
    this.toast(`Wave ${wave} cleared`);
    this.player.heal(this.player.stats.maxHp * 0.08);
  }

  // ------------------------------------------------------------- äventyret

  onLevelStart(level, isBoss, plan, mission) {
    this.hud.showBanner(`LEVEL ${level}`, mission ? mission.title.toLowerCase() : '', 2.6);
    this.sound.waveStart();
    if (level === 1) this.toast('The radar marks your objectives — gold and blue');
    else if (plan.size === 'long') this.toast('A big map this time');
  }

  onLevelClear(level) {
    const reward = 60 + level * 25;
    this.addGold(reward);
    this.levelReward = reward;
    this.hud.showBanner('LEVEL CLEARED', `+${reward} gold`, 2.4);
    this.sound.levelUp();
    this.player.heal(this.player.stats.maxHp * 0.15);
    this.interludeT = 2.0;      // en andhämtning innan shoppen
  }

  /** Uppdraget gick om intet — nivån görs om från början. */
  onLevelFailed(level, mission) {
    this.hud.showBanner('MISSION FAILED', '', 2.4);
    this.sound.gameOver();
    this.state = 'failed';
    this.input.enabled = false;
    this.input.releaseLock();
    this.hud.setBoss(null);
    setTimeout(() => {
      if (this.state !== 'failed') return;
      this.hud.showFailed(this, mission, () => {
        this.enemies.length = 0;
        this.combat.reset();
        this.adventure.retryLevel();
        this.continueRun();
      });
    }, 1200);
  }

  openInterlude() {
    this.state = 'interlude';
    this.input.enabled = false;
    this.input.releaseLock();
    this.showShop();
  }

  /** Shoppen ritas om efter varje köp, så guld och priser alltid stämmer. */
  showShop() {
    this.hud.showShop(this, (id) => {
      if (this.buy(id)) this.showShop();
    }, () => this.continueRun());
  }

  /** Vidare från mellanskärmen till nästa nivå. */
  continueRun() {
    this.hud.hideOverlay();
    // Checkpointen tas när man lämnar shoppen, så köpen räknas med.
    if (this.adventure.state === 'cleared' && this.adventure.level % CHECKPOINT_EVERY === 0) {
      this.saveCheckpoint();
    }
    this.adventure.nextLevel();
    if (this.pendingLevelUps > 0) { this.openLevelUp(); return; }
    this.state = 'playing';
    this.input.enabled = true;
    if (!this.input.touch) this.input.requestLock();
    this.sound.resume();
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    this.time += dt;
    this.elapsed += dt;
    this.dayTime = (this.dayTime + dt / DAY_LENGTH) % 1;

    const p = this.player;
    p.update(dt, this.input, this);

    // attack: svärd i Vildheim, laser i Neotropolis
    if (this.input.fireDown && p.fireTimer <= 0) {
      if (this.worldId === 'wild') this.combat.swordSwing(this);
      else this.combat.playerShoot(this);
    } else p.aimDir(this.enemies);

    /*
     * Parering på höger musknapp (eller Q). Bara i Vildheim: där möter man
     * spottare och bossar som kastar saker, och man har ett svärd att slå
     * tillbaka med. I Neotropolis flyger man undan i stället.
     */
    if (this.worldId === 'wild' && (this.input.parryPressed || this.input.pressed('KeyQ'))) {
      if (p.tryParry()) {
        this.sound.parryMiss();
        this.particles.burst(p.pos.x, p.pos.y + 1.3, p.pos.z, 10, {
          speed: 5, life: 0.25, size: 0.4, col: [0.8, 0.9, 1.0], alpha: 0.7, drag: 0.8,
        });
      }
    }

    // eldboll på C (bara Vildheim, 10 s nedkylning)
    if (this.worldId === 'wild' && this.input.pressed('KeyC') && p.alive) {
      if (p.fireballCd <= 0) this.combat.castFireball(this);
      else this.toast(`🔥 Eldboll om ${Math.ceil(p.fireballCd)} s`);
    }

    // drönare
    if (p.stats.drones > 0 && p.droneTimer <= 0) {
      let target = null, bestD = 46;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d < bestD) { bestD = d; target = e; }
      }
      if (target) {
        for (let i = 0; i < p.stats.drones; i++) {
          const a = p.droneAngle + (i / p.stats.drones) * TAU;
          this.combat.droneShoot(this, p.pos.x + Math.cos(a) * 2.1, p.pos.y + 2.4, p.pos.z + Math.sin(a) * 2.1, target);
        }
        p.droneTimer = 1.15;
      } else p.droneTimer = 0.3;
    }

    if (this.mode === 'adventure') {
      this.adventure.update(dt, this);
      if (this.interludeT > 0) {
        this.interludeT -= dt;
        if (this.interludeT <= 0) this.openInterlude();
      }
    } else this.waves.update(dt, this);

    for (const e of this.enemies) {
      if (e.alive) e.update(dt, this);
      else if (e.death > 0) e.updateDeath(dt, this);
    }
    if (this.enemies.some((e) => !e.alive && e.death <= 0)) {
      this.enemies = this.enemies.filter((e) => e.alive || e.death > 0);
    }

    this.combat.update(dt, this);
    this.particles.update(dt);

    this.updateWeather(dt);

    /*
     * Luften ska aldrig vara tom. Vad som svävar i den beror på var och när:
     * pollen som driver i solen, eldflugor som blinkar i skymningen, och
     * asklika flagor i stadens eviga natt. De föds runt spelaren och lever
     * några sekunder — inget behöver hållas reda på.
     */
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      const env = this.env || computeEnv(this.dayTime, this.worldId);
      const night = env.night;
      const city = this.worldId === 'city';
      this.ambientTimer = city ? 0.09 : night > 0.45 ? 0.14 : 0.05;
      const a = rand(TAU), d = rand(6, 34);
      const x = p.pos.x + Math.cos(a) * d, z = p.pos.z + Math.sin(a) * d;
      const gh = terrainHeight(x, z);
      const base = Math.max(gh, WATER_LEVEL);

      if (city) {
        // stoft och glödflagor som stiger mellan husen
        this.particles.spawn({
          x, y: base + rand(0.5, 14), z,
          vx: rand(-0.5, 0.5), vy: rand(0.4, 1.6), vz: rand(-0.5, 0.5),
          life: rand(2.4, 5.0), size: rand(0.07, 0.17), size2: 0,
          col: Math.random() < 0.3 ? [1.0, 0.45, 0.65] : [0.45, 0.85, 1.0],
          alpha: 0.5, drag: 0.06,
        });
      } else if (night > 0.45) {
        // eldflugor: få, långsamma, låga över marken och gulgröna
        this.particles.spawn({
          x, y: base + rand(0.3, 2.6), z,
          vx: rand(-0.35, 0.35), vy: rand(-0.15, 0.35), vz: rand(-0.35, 0.35),
          life: rand(2.6, 5.2), size: rand(0.13, 0.26), size2: 0.02,
          col: [0.75, 1.0, 0.35], alpha: 0.9, drag: 0.9,
        });
      } else {
        // pollen: mängder av små ljusa flagor som dalar sakta i dagsljuset
        this.particles.spawn({
          x, y: base + rand(0.4, 6.5), z,
          vx: rand(-0.5, 0.5), vy: rand(-0.25, 0.12), vz: rand(-0.5, 0.5),
          life: rand(3.0, 6.0), size: rand(0.06, 0.15), size2: 0,
          col: [1.0, 0.97, 0.80], alpha: 0.34, drag: 0.03,
        });
      }
    }

    if (!p.alive && this.state === 'playing') this.die();
  }

  // ------------------------------------------------------------------ render

  render() {
    const r = this.renderer;
    const p = this.player;
    this.env = computeEnv(this.dayTime, this.worldId);
    if (this.rain > 0.02) this.applyRainToEnv(this.env);
    r.clearBatches();
    if (p.alive) p.draw(r, this.time);
    for (const e of this.enemies) e.draw(r, this.time);
    this.combat.draw(r, this.time);
    if (this.mode === 'adventure') this.adventure.draw(r, this.time);
    r.render(p.camera(this.time), this.env, this.time, p.pos);
  }

  /**
   * Regnet dränker färgen ur landskapet: solen dämpas, dimman kryper
   * närmare och allt gråas ner. Blixten gör tvärtom under ett ögonblick —
   * hela världen blir vit och skuggorna försvinner.
   */
  applyRainToEnv(env) {
    const w = this.rain;
    const grey = (c, t) => {
      const l = (c[0] + c[1] + c[2]) / 3;
      return [lerp(c[0], l * 0.82, t), lerp(c[1], l * 0.84, t), lerp(c[2], l * 0.95, t)];
    };
    env.sunCol = [env.sunCol[0] * (1 - w * 0.55), env.sunCol[1] * (1 - w * 0.55), env.sunCol[2] * (1 - w * 0.5)];
    env.fogCol = grey(env.fogCol, w * 0.8);
    env.skyTop = grey(env.skyTop, w * 0.75);
    env.skyHor = grey(env.skyHor, w * 0.75);
    env.amb = [env.amb[0] * (1 - w * 0.2), env.amb[1] * (1 - w * 0.18), env.amb[2] * (1 - w * 0.1)];
    env.fogNear = lerp(env.fogNear, 16, w);
    env.fogFar = lerp(env.fogFar, 92, w);
    env.clouds = Math.min(1, env.clouds + w * 0.6);
    env.wind = [env.wind[0] * (1 + w), env.wind[1] * (1 + w)];

    const f = this.lightning;
    if (f > 0) {
      const flash = f * f;
      env.amb = [env.amb[0] + flash * 1.5, env.amb[1] + flash * 1.6, env.amb[2] + flash * 1.9];
      env.fogCol = [env.fogCol[0] + flash * 0.5, env.fogCol[1] + flash * 0.52, env.fogCol[2] + flash * 0.6];
      env.skyTop = [env.skyTop[0] + flash * 0.7, env.skyTop[1] + flash * 0.75, env.skyTop[2] + flash * 0.9];
      env.skyHor = [env.skyHor[0] + flash * 0.7, env.skyHor[1] + flash * 0.75, env.skyHor[2] + flash * 0.9];
    }
  }

  // -------------------------------------------------------------------- loop

  frame(now) {
    const dt = Math.min(0.05, (now - (this.lastTime || now)) / 1000);
    this.lastTime = now;
    this.frameCount++;
    this.fps = lerp(this.fps, 1 / Math.max(dt, 0.0001), 0.1);

    if (this.state === 'playing') {
      if (this.input.pressed('Escape') || this.input.pressed('KeyP')) this.pause();
      else if (this.hitstop > 0) this.hitstop -= dt;   // världen står still, bilden rullar
      else this.update(dt);
    } else if (this.state === 'paused') {
      if (this.input.pressed('Escape') || this.input.pressed('KeyP')) this.resume();
    } else if (this.state === 'interlude') {
      if (this.input.pressed('Space') || this.input.pressed('Enter')) this.continueRun();
      this.particles.update(dt * 0.25);
    } else if (this.state === 'levelup') {
      // Siffrorna markerar, enter tar. Samma två steg som med musen, så ett
      // reflexmässigt tryck mitt i striden inte kan välja åt en.
      for (let i = 0; i < 3; i++) {
        if (this.input.pressed(`Digit${i + 1}`) || this.input.pressed(`Numpad${i + 1}`)) {
          if (this.hud.selectUpgrade) this.hud.selectUpgrade(i);
          break;
        }
      }
      if ((this.input.pressed('Enter') || this.input.pressed('NumpadEnter')
        || this.input.pressed('Space')) && this.hud.confirmUpgrade) this.hud.confirmUpgrade();
      this.particles.update(dt * 0.25);
    } else {
      // meny eller game over: låt världen leva vidare i bakgrunden
      this.time += dt;
      this.dayTime = (this.dayTime + dt / DAY_LENGTH) % 1;
      this.particles.update(dt);
      if (this.state !== 'dead' && this.state !== 'failed') {
        this.player.camYaw += dt * 0.06;
        this.player.updateCamera(dt, 0);
      }
    }

    if (this.state !== 'menu') this.hud.update(this, dt);
    this.render();
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  run() {
    this.player.updateCamera(0.016, 0);
    requestAnimationFrame((t) => this.frame(t));
  }
}
