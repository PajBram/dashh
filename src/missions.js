// Uppdragen i äventyret — det som avslutar en nivå.
//
// Ett uppdrag äger sina egna föremål i världen, ritar dem, och avgör när
// nivån är klar (`done`) eller misslyckad (`failed`). Monstren på kartan är
// hindret, inte målet: bara jakten och bossen kräver att något dör.
import { clamp, rand, randInt, TAU } from './math.js';
import { terrainHeight, ARENA_RADIUS, clampToArena } from './noise.js';

const GOLD = [1.0, 0.82, 0.28];
const CYAN = [0.30, 0.95, 1.0];
const GREEN = [0.35, 1.0, 0.62];

/** Namn åt jaktens byte — sätts ihop av två halvor. */
const HUNT_FIRST = ['Gorrn', 'Vex', 'Malak', 'Sköldbjörn', 'Kavr', 'Thume', 'Zerrik', 'Ödesgap'];
const HUNT_LAST = ['Benkross', 'den Svultne', 'Askhjärta', 'Tvillingtand', 'den Blinde',
  'Järnkäft', 'Nattfäll', 'den Förste'];

class Mission {
  constructor(level) {
    this.level = level;
    this.done = false;
    this.failed = false;
    this.title = '';        // banderollen när nivån börjar
    this.label = '';         // rubriken i HUD:en
  }

  update() {}
  draw() {}
  markers() { return []; }
  get status() { return ''; }
}

// --------------------------------------------------------------- samla in

class CollectMission extends Mission {
  constructor(level, ctx, mgr) {
    super(level);
    this.title = 'SAMLA KRAFTKÄRNORNA';
    this.label = 'KRAFTKÄRNOR';
    const n = level < 4 ? 3 : 4;
    this.cores = [];
    const budget = mgr.plan.budget / n;
    for (let i = 0; i < n; i++) {
      const spot = mgr.campSpot(ctx, 48, ARENA_RADIUS - 14);
      mgr.spawnCamp(ctx, spot, budget);
      // kärnan ligger mitt i lägret — den är vaktad, inte gömd
      this.cores.push({ x: spot.x, z: spot.z, y: terrainHeight(spot.x, spot.z), taken: false });
    }
    this.taken = 0;
  }

  get status() { return `${this.taken} / ${this.cores.length}`; }

  update(dt, ctx) {
    const p = ctx.player.pos;
    for (const c of this.cores) {
      if (c.taken) continue;
      if (Math.hypot(c.x - p.x, c.z - p.z) < 3.6 && Math.abs(c.y + 2.6 - p.y) < 6) {
        c.taken = true;
        this.taken++;
        ctx.sound.pickup();
        ctx.sound.tone({ f: 520, f2: 1040, dur: 0.22, type: 'sine', vol: 0.1 });
        ctx.particles.burst(c.x, c.y + 2.6, c.z, 26, {
          speed: 9, life: 0.8, size: 0.5, size2: 0.05, col: GOLD, alpha: 0.95, drag: 0.6, grav: -4,
        });
        const left = this.cores.length - this.taken;
        ctx.toast(left ? `Kraftkärna tagen — ${left} kvar` : 'Sista kraftkärnan!');
        if (!left) this.done = true;
      }
    }
  }

  markers() {
    return this.cores.filter((c) => !c.taken).map((c) => ({ x: c.x, z: c.z, col: '#ffd24d' }));
  }

  draw(rend, time) {
    const B = rend.dyn;
    for (const c of this.cores) {
      if (c.taken) continue;
      // Kärnan svävar över vakternas huvuden — står den på marken göms den
      // bakom lägret och man ser aldrig vad man är där för.
      const y = c.y + 2.6 + Math.sin(time * 2 + c.x) * 0.22;
      B.octa.push(c.x, y, c.z, 0.62, 1.05, 0.62, GOLD, 0, time * 1.5, 0, 1.6);
      B.octa.push(c.x, y, c.z, 1.15, 1.9, 1.15, [1.0, 0.55, 0.12], 0, -time * 0.9, 0, 0.45);
      B.cyl.push(c.x, c.y + 5, c.z, 0.22, 5, 0.22, [1.0, 0.72, 0.2], 0, 0, 0, 0.55);
      if (Math.random() < 0.4) {
        rend.particles.spawn({
          x: c.x + rand(-0.6, 0.6), y: c.y + rand(0.2, 2.4), z: c.z + rand(-0.6, 0.6),
          vx: 0, vy: rand(0.6, 1.6), vz: 0, life: rand(0.5, 1.1),
          size: rand(0.14, 0.3), size2: 0, col: GOLD, alpha: 0.8, drag: 0.2,
        });
      }
    }
  }
}

// ------------------------------------------------------------ försvara punkt

class DefendMission extends Mission {
  constructor(level, ctx, mgr) {
    super(level);
    this.title = 'FÖRSVARA REAKTORN';
    this.label = 'LADDNING';
    const spot = mgr.campSpot(ctx, 46, ARENA_RADIUS - 24);
    this.x = spot.x; this.z = spot.z; this.y = terrainHeight(spot.x, spot.z);
    this.charge = 0;
    this.dur = Math.min(90, 48 + level * 2.5);
    this.started = false;
    this.wave = 0;
    this.spawnT = 0;
    // två läger på vägen dit, resten kommer som anfallsvågor mot reaktorn
    for (let i = 0; i < 2; i++) {
      mgr.spawnCamp(ctx, mgr.campSpot(ctx, 48, ARENA_RADIUS - 14), mgr.plan.budget * 0.25);
    }
  }

  get status() {
    if (!this.started) return 'GÅ DIT';
    return `${Math.round(this.charge * 100)} %`;
  }

  update(dt, ctx) {
    const p = ctx.player.pos;
    const d = Math.hypot(this.x - p.x, this.z - p.z);

    if (!this.started) {
      if (d < 14) {
        this.started = true;
        this.spawnT = 3;
        ctx.hud.showBanner('REAKTORN LADDAR', 'håll dig kvar', 2.4);
        ctx.sound.waveStart();
      }
      return;
    }

    // Laddar bara medan spelaren håller sig i närheten — det är så uppdraget
    // blir ett försvar och inte bara en väntan.
    if (d < 17) this.charge += dt / this.dur;
    else {
      this.charge = Math.max(0, this.charge - dt * 0.35 / this.dur);
      if (!this.warnT || this.warnT <= 0) {
        this.warnT = 3.5;
        ctx.toast('Reaktorn tappar laddning — gå tillbaka');
      }
    }
    if (this.warnT > 0) this.warnT -= dt;

    if (this.charge >= 1) {
      this.charge = 1;
      this.done = true;
      return;
    }

    // Anfallsvågor rakt mot reaktorn, vakna från start. Hinner spelaren inte
    // med håller vi igen — en hög som växer i all oändlighet är ingen strid.
    let awake = 0;
    for (const e of ctx.enemies) if (e.alive && !e.guard) awake++;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && awake < 18) {
      this.wave++;
      this.spawnT = Math.max(7, 15 - this.level * 0.4);
      const n = 2 + Math.min(6, Math.floor(this.level * 0.6) + Math.floor(this.wave / 2));
      const types = ctx.worldId === 'city'
        ? ['drone', 'drone', 'sniper', 'spitter']
        : ['grunt', 'grunt', 'spitter', 'charger'];
      for (let i = 0; i < n; i++) {
        const a = rand(TAU), r = rand(34, 46);
        const x = this.x + Math.cos(a) * r, z = this.z + Math.sin(a) * r;
        const pos = clampToArena({ x, z });
        ctx.spawnEnemy(types[randInt(0, types.length - 1)], pos.x, pos.z);
      }
      ctx.sound.tone({ f: 190, f2: 90, dur: 0.4, type: 'sawtooth', vol: 0.09 });
    }
  }

  markers() { return [{ x: this.x, z: this.z, col: '#4df3ff' }]; }

  draw(rend, time) {
    const B = rend.dyn;
    const c = this.charge;
    const col = [0.3 + c * 0.7, 0.85, 1.0];
    B.cyl.push(this.x, this.y + 0.35, this.z, 2.2, 0.35, 2.2, [0.16, 0.2, 0.3], 0, 0, 0, 0.05);
    B.cyl.push(this.x, this.y + 1.3, this.z, 0.85, 1.0, 0.85, [0.22, 0.28, 0.4], 0, 0, 0, 0.05);
    const pulse = this.started ? 1 + Math.sin(time * (4 + c * 8)) * 0.12 : 1;
    B.octa.push(this.x, this.y + 3.1, this.z, 1.1 * pulse, 1.6 * pulse, 1.1 * pulse, col,
      0, time * (0.6 + c * 2.5), 0, 0.6 + c * 1.4);
    // laddningsringen växer runt kärnan
    B.cyl.push(this.x, this.y + 2.2 + c * 1.8, this.z, 1.7, 0.06, 1.7, CYAN, 0, 0, 0, 1.3);
    // ljuspelaren gör reaktorn hittbar över trädtopparna
    B.cyl.push(this.x, this.y + 7, this.z, 0.2, 7, 0.2, CYAN, 0, 0, 0, 0.4 + c * 0.5);
    if (this.started && Math.random() < 0.55) {
      const a = rand(TAU);
      rend.particles.spawn({
        x: this.x + Math.cos(a) * 2.1, y: this.y + rand(0.3, 1), z: this.z + Math.sin(a) * 2.1,
        vx: 0, vy: rand(1.5, 3.5), vz: 0, life: rand(0.5, 1.0),
        size: rand(0.16, 0.34), size2: 0, col: CYAN, alpha: 0.85, drag: 0.15,
      });
    }
  }
}

// ------------------------------------------------------------------- jakt

class HuntMission extends Mission {
  constructor(level, ctx, mgr) {
    super(level);
    this.name = `${HUNT_FIRST[randInt(0, HUNT_FIRST.length - 1)]} ${HUNT_LAST[randInt(0, HUNT_LAST.length - 1)]}`;
    this.title = 'SPÅRA UPP MÅLET';
    this.label = this.name.toUpperCase();

    // ett par vanliga läger, och längst bort lägret där bytet håller till
    const camps = Math.max(1, mgr.plan.camps - 1);
    for (let i = 0; i < camps; i++) {
      mgr.spawnCamp(ctx, mgr.campSpot(ctx, 48, ARENA_RADIUS - 14), mgr.plan.budget / mgr.plan.camps);
    }
    const lair = mgr.campSpot(ctx, 62, ARENA_RADIUS - 16);
    mgr.spawnCamp(ctx, lair, mgr.plan.budget / mgr.plan.camps);   // livvakter
    const type = ctx.worldId === 'city'
      ? (level >= 4 ? 'hover' : 'sniper')
      : (level >= 5 ? 'tank' : 'charger');
    const e = ctx.spawnEnemy(type, lair.x, lair.z, true);
    e.postGuard(rand(22, 28));
    // eliten: tåligare, hårdare och guldskimrande så den känns igen på håll
    e.maxHp = Math.round(e.maxHp * 3.2);
    e.hp = e.maxHp;
    e.dmg *= 1.3;
    e.elite = true;
    e.eliteName = this.name;
    e.col = [1.0, 0.78, 0.25];
    this.target = e;
    this.announced = false;
  }

  get status() {
    const t = this.target;
    if (!t.alive) return 'FÄLLD';
    return `${Math.max(0, Math.round(t.hp / t.maxHp * 100))} %`;
  }

  update(dt, ctx) {
    const t = this.target;
    if (!t.alive) {
      if (!this.done) {
        this.done = true;
        ctx.hud.setBoss(null);
        ctx.hud.showBanner('MÅLET FÄLLT', this.name, 2.4);
      }
      return;
    }
    if (!this.announced && !t.guard) {
      this.announced = true;
      ctx.hud.setBoss(t, this.name.toUpperCase());
      ctx.hud.showBanner(this.name.toUpperCase(), 'har fått syn på dig', 2.6);
      ctx.sound.bossSpawn();
    }
  }

  markers() {
    return this.target.alive ? [{ x: this.target.pos.x, z: this.target.pos.z, col: '#ffd24d' }] : [];
  }

  draw(rend, time) {
    const t = this.target;
    if (!t.alive) return;
    // en roterande markör ovanför bytet, så man ser vem det är i vimlet
    rend.dyn.octa.push(t.pos.x, t.pos.y + t.height + 1.5 + Math.sin(time * 3) * 0.16,
      t.pos.z, 0.34, 0.6, 0.34, GOLD, Math.PI, time * 2.4, 0, 1.6);
  }
}

// -------------------------------------------------------------- eskortera

class EscortMission extends Mission {
  constructor(level, ctx, mgr) {
    super(level);
    this.title = 'ESKORTERA LASTAREN';
    this.label = 'LASTAREN';

    const p = ctx.player.pos;
    const a = rand(TAU);
    this.x = p.x + Math.cos(a) * 8;
    this.z = p.z + Math.sin(a) * 8;
    this.y = terrainHeight(this.x, this.z);

    // målet ligger tvärs över kartan, med hela vägen innanför arenan
    const dir = Math.atan2(-this.z, -this.x) + rand(-0.8, 0.8);
    const len = rand(100, 140);
    const goal = clampToArena({
      x: this.x + Math.cos(dir) * len,
      z: this.z + Math.sin(dir) * len,
    });
    this.goal = { x: goal.x, z: goal.z };
    this.routeLen = Math.hypot(this.goal.x - this.x, this.goal.z - this.z);

    this.maxHp = 240 + level * 30;
    this.hp = this.maxHp;
    this.speed = 3.4;
    this.waiting = true;

    // lägren står längs vägen — resan är gatloppet
    for (const f of [0.45, 0.7, 0.92]) {
      const bx = this.x + (this.goal.x - this.x) * f;
      const bz = this.z + (this.goal.z - this.z) * f;
      const side = rand(-14, 14);
      const nx = -(this.goal.z - this.z) / this.routeLen, nz = (this.goal.x - this.x) / this.routeLen;
      const spot = clampToArena({ x: bx + nx * side, z: bz + nz * side });
      mgr.spawnCamp(ctx, { x: spot.x, z: spot.z }, mgr.plan.budget / 3);
    }
  }

  get status() { return `${Math.max(0, Math.round(this.hp / this.maxHp * 100))} %`; }

  update(dt, ctx) {
    if (this.done || this.failed) return;
    const p = ctx.player.pos;
    const toGoal = Math.hypot(this.goal.x - this.x, this.goal.z - this.z);

    // Lastaren väntar in spelaren i stället för att rulla iväg ensam — en
    // följeslagare man springer efter är bara irriterande.
    const near = Math.hypot(this.x - p.x, this.z - p.z) < 26;
    this.waiting = !near;
    if (near && toGoal > 5) {
      const k = this.speed * dt / toGoal;
      this.x += (this.goal.x - this.x) * k;
      this.z += (this.goal.z - this.z) * k;
    }
    // den svävar, så ingen sten eller backe kan sätta stopp
    this.y += ((terrainHeight(this.x, this.z) + 1.6) - this.y) * Math.min(1, dt * 3);

    // Skada från monster som står intill, reparation när det är lugnt.
    // Fler än fyra på en gång räknas inte — annars smälter lastaren bort på
    // några sekunder så fort ett läger vaknar, och då är uppdraget förlorat
    // innan man hunnit dit.
    let threat = 0;
    for (const e of ctx.enemies) {
      if (!e.alive || e.guard) continue;
      if (Math.hypot(e.pos.x - this.x, e.pos.z - this.z) < 4.5) threat++;
    }
    threat = Math.min(4, threat);
    if (threat) {
      this.hp -= threat * (4 + this.level * 0.4) * dt;
      if (Math.random() < 0.5) {
        ctx.particles.spawn({
          x: this.x + rand(-1, 1), y: this.y + rand(0, 1.4), z: this.z + rand(-1, 1),
          vx: rand(-1, 1), vy: rand(1, 3), vz: rand(-1, 1), life: rand(0.3, 0.6),
          size: rand(0.2, 0.45), size2: 0, col: [1.0, 0.45, 0.2], alpha: 0.9, drag: 0.5,
        });
      }
      if (!this.hurtT || this.hurtT <= 0) { this.hurtT = 4; ctx.toast('Lastaren är under attack!'); }
    } else if (this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + 12 * dt);
    }
    if (this.hurtT > 0) this.hurtT -= dt;

    if (this.hp <= 0) { this.hp = 0; this.failed = true; return; }
    if (toGoal <= 5) {
      this.done = true;
      ctx.particles.burst(this.x, this.y + 1, this.z, 30, {
        speed: 10, life: 0.9, size: 0.6, size2: 0.05, col: GREEN, alpha: 0.95, drag: 0.6, grav: -4,
      });
    }
  }

  markers() {
    return [{ x: this.x, z: this.z, col: '#5cffa0' }, { x: this.goal.x, z: this.goal.z, col: '#4df3ff' }];
  }

  draw(rend, time) {
    const B = rend.dyn;
    const hurt = this.hp / this.maxHp;
    // Mässing och blinkande ljus, inte grått — annars ser lastaren ut som
    // ännu ett stenblock i landskapet och man tappar bort den.
    const body = [0.68, 0.52, 0.26];
    const bob = Math.sin(time * 2.2) * 0.14;
    const y = this.y + bob;
    B.box.push(this.x, y + 1.0, this.z, 1.9, 1.15, 1.4, body, 0, time * 0.25, 0, 0.1);
    B.box.push(this.x, y + 2.2, this.z, 1.1, 0.35, 0.85, [0.35, 0.3, 0.2], 0, time * 0.25, 0, 0.05);
    // ljuset ovanpå skiftar mot rött när den är illa däran
    B.sphere.push(this.x, y + 2.85, this.z, 0.42, 0.42, 0.42,
      [1.0, 0.25 + hurt * 0.7, 0.2 + hurt * 0.4], 0, 0, 0, 1.6);
    B.cyl.push(this.x, y + 0.15, this.z, 1.7, 0.12, 1.7, CYAN, 0, 0, 0, 1.0);
    for (let i = 0; i < 4; i++) {
      const a = time * 1.1 + i * (TAU / 4);
      B.sphere.push(this.x + Math.cos(a) * 1.9, y + 0.55, this.z + Math.sin(a) * 1.9,
        0.2, 0.2, 0.2, CYAN, 0, 0, 0, 1.3);
    }
    if (Math.random() < 0.5) {
      rend.particles.spawn({
        x: this.x + rand(-0.8, 0.8), y: y - 0.2, z: this.z + rand(-0.8, 0.8),
        vx: 0, vy: rand(-1.6, -0.6), vz: 0, life: rand(0.3, 0.6),
        size: rand(0.12, 0.26), size2: 0, col: CYAN, alpha: 0.5, drag: 0.3,
      });
    }
    // målpelaren syns på långt håll
    const gy = terrainHeight(this.goal.x, this.goal.z);
    B.cyl.push(this.goal.x, gy + 6, this.goal.z, 0.16, 6, 0.16, CYAN, 0, 0, 0, 1.1);
    B.octa.push(this.goal.x, gy + 12.5 + Math.sin(time * 2) * 0.4, this.goal.z,
      0.7, 1.1, 0.7, CYAN, 0, time * 1.2, 0, 1.4);
  }
}

// ------------------------------------------------------------------- boss

class BossMission extends Mission {
  constructor(level, ctx, mgr) {
    super(level);
    this.title = 'NÅGOT VÄNTAR DÄR UTE';
    this.label = 'BOSSEN';
    for (let i = 0; i < mgr.plan.camps; i++) {
      mgr.spawnCamp(ctx, mgr.campSpot(ctx, 48, ARENA_RADIUS - 14), mgr.plan.budget / mgr.plan.camps);
    }
    const spot = mgr.campSpot(ctx, 62, ARENA_RADIUS - 18);
    // äventyret har egna bossar — vågläget behåller sina
    const type = ctx.worldId === 'city' ? 'cityboss' : 'vildboss';
    const e = ctx.spawnEnemy(type, spot.x, spot.z, true);
    e.postGuard(38);
    this.target = e;
  }

  get status() {
    const t = this.target;
    if (!t.alive) return 'FÄLLD';
    return t.guard ? 'HITTA DEN' : `${Math.max(0, Math.round(t.hp / t.maxHp * 100))} %`;
  }

  update(dt, ctx) {
    if (!this.target.alive && !this.done) this.done = true;
  }

  markers() {
    return this.target.alive ? [{ x: this.target.pos.x, z: this.target.pos.z, col: '#ff3d7f' }] : [];
  }
}

// ---------------------------------------------------------------- val av typ

// Namnet måste vara eget: bundlern slår ihop alla moduler till en enda
// namnrymd, och `TYPES` är redan fiendetyperna i enemies.js.
const MISSION_TYPES = ['collect', 'hunt', 'defend', 'escort'];

/** Väljer uppdragstyp: nivå 1 lär ut kartan, sedan varieras det. */
export function pickMissionType(level, last) {
  if (level === 1) return 'collect';
  if (level === 2) return 'hunt';
  const pool = MISSION_TYPES.filter((t) => t !== last && (t !== 'escort' || level >= 4));
  return pool[randInt(0, pool.length - 1)];
}

export function createMission(type, level, ctx, mgr) {
  switch (type) {
    case 'boss': return new BossMission(level, ctx, mgr);
    case 'defend': return new DefendMission(level, ctx, mgr);
    case 'hunt': return new HuntMission(level, ctx, mgr);
    case 'escort': return new EscortMission(level, ctx, mgr);
    default: return new CollectMission(level, ctx, mgr);
  }
}
