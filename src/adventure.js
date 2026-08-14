// Äventyrsläget: nivåer med utplacerade monster i stället för vågor mot arenan.
//
// Skillnaden mot vågläget är var monstren finns. Här står de i läger utspridda
// över kartan och rör sig inte förrän spelaren kommer nära — annars vore en
// "karta" bara en våg som råkar ha startat längre bort.
import { rand, randInt, TAU } from './math.js';
import { terrainHeight, WATER_LEVEL, ARENA_RADIUS } from './noise.js';
import { pickMissionType, createMission } from './missions.js';

export const CHECKPOINT_EVERY = 10;   // var tionde nivå sparas som utgångspunkt

export class AdventureManager {
  constructor() { this.reset(); }

  reset() {
    this.level = 0;
    this.state = 'idle';     // idle → running → cleared
    this.timer = 1.0;
    this.total = 0;          // monster nivån började med
    this.sinceKill = 0;
    this.levelTime = 0;
    this.hunted = false;
    this.plan = null;
    this.mission = null;
    this.lastType = null;
    this.forceType = null;
    this.missionType = null;
  }

  isBossLevel(level) { return level % 3 === 0; }

  /**
   * Nivåns omfång varierar med flit: en kort utrensning, en vanlig runda eller
   * en lång vandring. Enformig längd gör att alla nivåer smälter ihop.
   * Försvar och eskort skapar eget motstånd och får därför färre läger.
   */
  makePlan(level, type) {
    if (type === 'boss') return { size: 'boss', camps: 2, budget: 5 + level * 1.5 };
    if (type === 'defend') return { size: 'kort', camps: 2, budget: 6 + level * 1.4 };
    if (type === 'escort') return { size: 'lång', camps: 3, budget: 9 + level * 2.2 };
    const r = Math.random();
    if (r < 0.30) return { size: 'kort', camps: 2, budget: 5 + level * 1.7 };
    if (r < 0.75) return { size: 'vanlig', camps: 4, budget: 8 + level * 2.3 };
    return { size: 'lång', camps: 6, budget: 11 + level * 3.0 };
  }

  /** Monsterlista för ett läger, prisad så svårare typer blir färre. */
  compose(budget, level, worldId) {
    const list = [];
    const options = [];
    if (worldId === 'city') {
      options.push(['drone', 0.7]);
      if (level >= 2) options.push(['sniper', 2.5]);
      if (level >= 3) options.push(['spitter', 1.6]);
      if (level >= 4) options.push(['hover', 4.2]);
    } else {
      options.push(['grunt', 1]);
      if (level >= 2) options.push(['spitter', 1.6]);
      if (level >= 3) options.push(['charger', 2.2]);
      if (level >= 5) options.push(['tank', 3.4]);
    }
    let spent = 0;
    while (spent < budget) {
      const [type, cost] = options[randInt(0, options.length - 1)];
      if (type === 'drone') {
        const n = randInt(2, 4);
        for (let i = 0; i < n; i++) list.push('drone');
        spent += cost * n;
      } else {
        list.push(type);
        spent += cost;
      }
    }
    return list;
  }

  /**
   * En plats för ett läger: inte ovanpå spelaren, inte i vattnet.
   *
   * Avståndet till spelaren måste vara större än vakternas syn (max 28 m),
   * annars vaknar hela lägret i samma stund som nivån börjar och rusar mot
   * en — då är det ingen karta att utforska, bara en våg som startade långt
   * bort. Marginalen är tilltagen för att lägret sprider sig några meter.
   */
  campSpot(ctx, minR, maxR) {
    for (let tries = 0; tries < 40; tries++) {
      const a = rand(TAU);
      const d = rand(minR, maxR);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.hypot(x - ctx.player.pos.x, z - ctx.player.pos.z) < 45) continue;
      if (ctx.worldId !== 'city' && terrainHeight(x, z) < WATER_LEVEL + 0.6) continue;
      return { x, z };
    }
    const a = rand(TAU);
    return { x: Math.cos(a) * maxR * 0.8, z: Math.sin(a) * maxR * 0.8 };
  }

  /**
   * Ett läger: några monster kring en plats, alla på post.
   * Uppdragen ropar själva på den här när de bestämt var motståndet ska stå.
   */
  spawnCamp(ctx, spot, budget) {
    const list = this.compose(Math.max(2, budget), this.level, ctx.worldId);
    const out = [];
    for (const type of list) {
      const a = rand(TAU), d = rand(0, 7);
      const e = ctx.spawnEnemy(type, spot.x + Math.cos(a) * d, spot.z + Math.sin(a) * d, true);
      // Vaknar när spelaren kommer inom ett kvarters avstånd — nära nog att
      // lägret hinner ses innan det rör sig, långt nog att man inte
      // överraskas bakifrån.
      e.postGuard(rand(22, 28));
      out.push(e);
    }
    return out;
  }

  startLevel(ctx) {
    ctx.clearScene();
    this.level++;
    const boss = this.isBossLevel(this.level);
    const type = boss ? 'boss' : (this.forceType || pickMissionType(this.level, this.lastType));
    this.forceType = null;
    if (!boss) this.lastType = type;
    this.plan = this.makePlan(this.level, type);
    // uppdraget placerar ut både sina egna föremål och lägren
    this.mission = createMission(type, this.level, ctx, this);
    this.missionType = type;

    this.total = ctx.enemies.length;
    this.sinceKill = 0;
    this.levelTime = 0;
    this.hunted = false;
    this.state = 'running';
    ctx.onLevelStart(this.level, boss, this.plan, this.mission);
  }

  onKill() { this.sinceKill = 0; }

  /** Efter en avklarad nivå — anropas när spelaren lämnat mellanskärmen. */
  nextLevel() {
    this.mission = null;
    this.state = 'idle';
    this.timer = 0.5;
  }

  /** Misslyckat uppdrag: samma nivå och samma uppgift görs om från början. */
  retryLevel() {
    this.forceType = this.missionType;
    this.level--;
    this.nextLevel();
  }

  draw(rend, time) {
    if (this.mission) this.mission.draw(rend, time);
  }

  update(dt, ctx) {
    if (this.state === 'idle') {
      this.timer -= dt;
      if (this.timer <= 0) this.startLevel(ctx);
      return;
    }
    if (this.state !== 'running') return;

    this.levelTime += dt;
    this.sinceKill += dt;

    const m = this.mission;
    if (m) {
      m.update(dt, ctx);
      if (m.failed) {
        this.state = 'failed';
        ctx.onLevelFailed(this.level, m);
        return;
      }
      if (m.done) {
        this.state = 'cleared';
        ctx.onLevelClear(this.level);
        return;
      }
    }

    // Skyddsnätet, samma tanke som i vågläget: en nivå får aldrig kunna låsa
    // sig för att det som ska dödas står oåtkomligt någonstans. Efter fyra
    // minuter kommer allt som lever i stället till spelaren.
    if (!this.hunted && this.levelTime > 240) {
      this.hunted = true;
      for (const e of ctx.enemies) {
        if (!e.alive) continue;
        e.wake(ctx);
        e.enrage = true;
      }
      ctx.toast('Allt som lever söker upp dig');
    }
  }
}
