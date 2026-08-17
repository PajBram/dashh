// Fiendetyper, deras AI och vågsystemet.
import { clamp, lerp, rand, randInt, TAU, angleDelta, distXZ, smoothstep } from './math.js';
import { terrainHeight, WATER_LEVEL, clampToArena, ARENA_RADIUS } from './noise.js';

export const TYPES = {
  grunt:   { hp: 22,  speed: 6.7, radius: 0.70, height: 1.7, dmg: 9,  xp: 3,  col: [0.93, 0.28, 0.30], ai: 'melee' },
  spitter: { hp: 17,  speed: 4.7, radius: 0.65, height: 1.6, dmg: 8,  xp: 5,  col: [0.66, 0.34, 0.96], ai: 'ranged', range: 22, cool: 2.1, bullet: 27 },
  charger: { hp: 38,  speed: 5.4, radius: 0.85, height: 1.9, dmg: 19, xp: 8,  col: [0.98, 0.62, 0.16], ai: 'charge' },
  tank:    { hp: 105, speed: 3.0, radius: 1.35, height: 2.5, dmg: 25, xp: 15, col: [0.28, 0.80, 0.62], ai: 'melee' },
  boss:    { hp: 560, speed: 3.7, radius: 2.60, height: 4.6, dmg: 34, xp: 90, col: [1.00, 0.24, 0.50], ai: 'boss', cool: 1.5, bullet: 22 },

  // --- Neotropolis egna maskiner (utnyttjar att striden är i tre dimensioner)
  drone:  { hp: 14,  speed: 10.5, radius: 0.50, height: 0.9, dmg: 7,  xp: 3,  col: [1.00, 0.85, 0.25], ai: 'drone', turn: 11 },
  sniper: { hp: 34,  speed: 7.6,  radius: 0.70, height: 1.6, dmg: 24, xp: 10, col: [0.35, 1.00, 0.72], ai: 'sniper', turn: 5, cool: 2.6, bullet: 70 },
  hover:  { hp: 155, speed: 3.4,  radius: 1.90, height: 2.0, dmg: 20, xp: 17, col: [0.55, 0.60, 1.00], ai: 'hover', turn: 0.8, cool: 2.4, bullet: 32, shield: true },

  // --- Äventyrets egna bossar: en per värld, med faser vid 2/3 och 1/3 hälsa
  vildboss: { hp: 760, speed: 3.1, radius: 2.40, height: 5.2, dmg: 30, xp: 120, col: [0.50, 0.53, 0.40], ai: 'vildboss', cool: 1.4, bullet: 22, boss: true, bossName: 'THE EARTHWRATH', bossSub: 'the ground rises' },
  cityboss: { hp: 660, speed: 6.2, radius: 2.10, height: 2.6, dmg: 26, xp: 120, col: [0.90, 0.94, 1.00], ai: 'cityboss', cool: 1.3, bullet: 34, boss: true, bossName: 'THE SANITISER', bossSub: 'the city clears you away', turn: 3 },
};

// Neotropolis-varianternas neonskal.
const CITY_COLS = {
  grunt: [1.0, 0.22, 0.5], spitter: [0.4, 0.9, 1.0], charger: [1.0, 0.55, 0.1],
  tank: [0.45, 0.5, 1.0], boss: [0.85, 0.2, 1.0],
};

export class Enemy {
  constructor(type, x, z, wave, worldId = 'wild') {
    const t = TYPES[type];
    this.type = type;
    this.def = t;
    this.boss = type === 'boss' || !!t.boss;
    this.bossPhase = 1;      // äventyrsbossarna trappar upp vid 2/3 och 1/3
    this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    this.fly = worldId === 'city';
    const hpMul = 1 + (wave - 1) * 0.23 + (wave > 10 ? (wave - 10) * 0.09 : 0);
    this.maxHp = Math.round(t.hp * hpMul);
    this.hp = this.maxHp;
    this.dmg = t.dmg * (1 + (wave - 1) * 0.07);
    this.speed = t.speed * (1 + Math.min(0.35, (wave - 1) * 0.018));
    // Neotropolis maskiner är byggda större än Vildheims djur. Skalan sitter
    // här så att träffytan, höjden och modellen växer i takt — skalar man
    // bara ritningen träffar man luft, och skalar man bara radien blir det
    // osynliga väggar. Bossarna har redan sin storlek och lämnas ifred.
    this.scale = this.fly && !this.boss ? 1.35 : 1;
    this.radius = t.radius * this.scale;
    this.height = t.height * this.scale;
    this.xp = t.xp;
    this.col = ((this.fly && CITY_COLS[type]) || t.col).slice();
    this.pos = { x, y: terrainHeight(x, z), z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.alive = true;
    this.flash = 0;
    this.hitCd = 0;
    this.fireCd = rand(0.4, 1.6);
    this.state = 'idle';
    this.stateT = 0;
    this.phase = rand(TAU);
    this.grounded = true;
    this.slow = 0;
    this.attackIndex = 0;
    this.walk = rand(TAU);   // gångcykel, drivs av faktisk fart
    this.planar = 0;
    this.perch = null;       // taksnipern: byggnaden den sitter på
    this.aimT = 0;
    this.aimPitch = 0;
    this.shieldFlash = 0;
    this.death = 0;          // > 0 medan kroppen faller ihop
    this.deathMax = 0.62;
    this.enrage = false;     // sätts om vågen drar ut på tiden
    this.guard = false;      // äventyrsläget: står på post tills spelaren närmar sig
    this.home = null;
    this.aggroRange = 0;
  }

  /**
   * Ställer monstret på post: det stannar kring platsen där det står och
   * vaknar först när spelaren kommer inom `range`, eller när något skadar det.
   */
  postGuard(range = 28) {
    this.guard = true;
    this.home = { x: this.pos.x, z: this.pos.z };
    this.aggroRange = range;
    this.patrolR = rand(1.5, 4.5);
    this.patrolSpeed = rand(0.16, 0.34);
    return this;
  }

  /** Vaknar ur sin post och börjar bete sig som vanligt. */
  wake(ctx) {
    if (!this.guard) return;
    this.guard = false;
    this.state = 'idle';
    ctx.particles.burst(this.pos.x, this.pos.y + this.height * 0.95, this.pos.z, 6, {
      speed: 4, life: 0.45, size: 0.35, size2: 0.05,
      col: [1.0, 0.8, 0.35], alpha: 0.9, drag: 0.6, grav: -3,
    });
    if (this.boss && ctx.onBossWake) ctx.onBossWake(this);
  }

  damage(n, ctx, crit) {
    if (!this.alive) return 0;
    // hover-plattformens frontsköld: måste flankeras
    if (this.def.shield) {
      const src = ctx.player.pos;
      const ang = Math.atan2(src.x - this.pos.x, src.z - this.pos.z);
      if (Math.abs(angleDelta(this.yaw, ang)) < 1.05) {
        n *= 0.2;
        this.shieldFlash = 1;
        const fx = this.pos.x + Math.sin(this.yaw) * 1.6, fz = this.pos.z + Math.cos(this.yaw) * 1.6;
        ctx.particles.burst(fx, this.pos.y + 1.3, fz, 5, {
          speed: 5, life: 0.25, size: 0.4, col: [0.6, 0.85, 1.0], alpha: 0.9, drag: 0.7,
        });
      }
    }
    ctx.damageDealt += Math.min(n, this.hp);
    this.hp -= n;
    this.flash = 1;
    ctx.particles.burst(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z, crit ? 10 : 5, {
      speed: crit ? 9 : 5, life: 0.34, size: crit ? 0.5 : 0.34,
      col: crit ? [1.0, 0.85, 0.3] : [1.0, 0.55, 0.35], alpha: 0.9, drag: 0.5, grav: -6,
    });
    ctx.floater(this.pos.x, this.pos.y + this.height * 0.75, this.pos.z, Math.round(n), crit, this);
    if (this.hp <= 0) {
      this.alive = false;
      this.death = this.deathMax = this.boss ? 1.3 : 0.62;
      this.vel.y = this.fly ? -2 : 3.5;      // svävare tappar höjd, markbundna studsar till
      ctx.freeze(this.boss ? 0.16 : 0.05);
      return 1;
    }
    if (crit) ctx.freeze(0.045);
    return 0;
  }

  /** Kroppen faller framåt, sjunker ihop och försvinner. */
  updateDeath(dt, ctx) {
    this.death -= dt;
    this.flash = Math.max(0, this.flash - dt * 3.5);
    this.vel.y -= 26 * dt;
    this.pos.x += this.vel.x * dt * 0.35;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt * 0.35;
    const gh = terrainHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gh) { this.pos.y = gh; this.vel.y = 0; }
    if (Math.random() < (this.boss ? 0.9 : 0.25)) {
      ctx.particles.spawn({
        x: this.pos.x + rand(-this.radius, this.radius),
        y: this.pos.y + rand(0.2, this.height),
        z: this.pos.z + rand(-this.radius, this.radius),
        vx: rand(-0.6, 0.6), vy: rand(0.4, 1.6), vz: rand(-0.6, 0.6),
        life: rand(0.3, 0.7), size: rand(0.2, 0.5), size2: 0,
        col: this.col, alpha: 0.5, drag: 0.4,
      });
    }
  }

  /**
   * Äventyrsbossarnas fastrappa: 1 → 2 vid 2/3 hälsa, 2 → 3 vid 1/3.
   * Bytet märks — frys, stöt, utrop — så att upptrappningen inte smyger.
   */
  updateBossPhase(ctx, msg2, msg3) {
    const frac = this.hp / this.maxHp;
    const ph = frac <= 1 / 3 ? 3 : frac <= 2 / 3 ? 2 : 1;
    if (ph > this.bossPhase) {
      this.bossPhase = ph;
      this.stateT = Math.min(this.stateT, 0.4);
      ctx.freeze(0.09);
      ctx.toast(ph === 2 ? msg2 : msg3);
      ctx.sound.tone({ f: 60, f2: 160, dur: 0.8, type: 'sawtooth', vol: 0.16 });
      ctx.particles.burst(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z, 40, {
        speed: 14, life: 0.8, size: 0.8, size2: 0.1, col: this.col, alpha: 0.95, drag: 0.6, grav: -4,
      });
      ctx.player.shake = Math.min(1.6, ctx.player.shake + 0.7);
    }
    return this.bossPhase;
  }

  update(dt, ctx) {
    const p = ctx.player;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist, nz = dz / dist;
    this.stateT -= dt;
    this.hitCd -= dt;
    this.fireCd -= dt;
    this.flash = Math.max(0, this.flash - dt * 3.5);
    this.slow = Math.max(0, this.slow - dt);
    const slowF = this.slow > 0 ? 0.55 : 1;

    let wishX = 0, wishZ = 0, speed = this.speed * slowF;

    // Vakter (äventyrsläget) driver runt sin lägerplats tills spelaren kommer
    // nära, tills de blir träffade eller tills nivån hetsar dem.
    if (this.guard && (dist < this.aggroRange || this.hp < this.maxHp || this.enrage)) this.wake(ctx);
    const guarding = this.guard;
    if (guarding) {
      const a = this.phase * this.patrolSpeed;
      const tx = this.home.x + Math.cos(a) * this.patrolR - this.pos.x;
      const tz = this.home.z + Math.sin(a) * this.patrolR - this.pos.z;
      const tl = Math.hypot(tx, tz) || 1;
      wishX = tx / tl; wishZ = tz / tl;
      speed = this.speed * 0.22;
    }

    // 'vakt' matchar ingen gren: monstret gör inget av sin vanliga AI.
    switch (guarding ? 'vakt' : this.def.ai) {
      case 'melee':
        wishX = nx; wishZ = nz;
        break;

      case 'ranged': {
        const want = this.def.range;
        if (dist > want + 3) { wishX = nx; wishZ = nz; }
        else if (dist < want - 6) { wishX = -nx; wishZ = -nz; }
        else {
          // cirkla runt spelaren
          wishX = -nz * Math.sign(Math.sin(this.phase * 3.1));
          wishZ = nx * Math.sign(Math.sin(this.phase * 3.1));
          speed *= 0.8;
        }
        if (this.fireCd <= 0 && dist < want + 8) {
          this.fireCd = this.def.cool * rand(0.85, 1.2);
          this.state = 'shoot'; this.stateT = 0.3;
          ctx.spawnEnemyBullet(this, p, this.def.bullet, this.dmg * 0.8);
        }
        break;
      }

      case 'charge': {
        if (this.state === 'charging') {
          speed = 0;
          if (this.stateT <= 0) { this.state = 'recover'; this.stateT = 0.8; }
          ctx.particles.spawn({
            x: this.pos.x, y: this.pos.y + 0.6, z: this.pos.z,
            vx: rand(-1, 1), vy: rand(0.5, 2), vz: rand(-1, 1),
            life: 0.3, size: 0.5, col: [1.0, 0.6, 0.15], alpha: 0.8, drag: 0.5,
          });
        } else if (this.state === 'windup') {
          speed = 0;
          if (this.stateT <= 0) {
            this.state = 'charging'; this.stateT = 0.65;
            this.vel.x = nx * 30; this.vel.z = nz * 30;
            ctx.sound.tone({ f: 160, f2: 420, dur: 0.18, type: 'sawtooth', vol: 0.08 });
          }
        } else if (this.state === 'recover') {
          speed = this.speed * 0.3;
          wishX = nx; wishZ = nz;
          if (this.stateT <= 0) this.state = 'idle';
        } else {
          wishX = nx; wishZ = nz;
          speed = this.speed * 0.75;
          if (dist < 15 && dist > 4) { this.state = 'windup'; this.stateT = 0.55; }
        }
        break;
      }

      // Svärmdrönare: cirklar högt ovanför och störtdyker i intervaller.
      case 'drone': {
        if (this.state === 'dive') {
          speed = this.speed * 1.9;
          wishX = this.diveX; wishZ = this.diveZ;
          if (this.stateT <= 0) { this.state = 'recover'; this.stateT = rand(0.6, 1.1); }
        } else if (this.state === 'recover') {
          speed = this.speed * 0.9;
          wishX = -nx; wishZ = -nz;
          if (this.stateT <= 0) { this.state = 'circle'; this.stateT = rand(0.7, 1.5); }
        } else if (this.enrage) {
          // Har vågen dröjt går de rakt på i spelarens höjd i stället för att
          // cirkla — annars kan de bli hängande utom räckhåll.
          wishX = nx; wishZ = nz;
          speed = this.speed * 1.1;
        } else {
          // Cirkla på armlängds avstånd. Utan den radiella termen spiralar de
          // in och hamnar rakt ovanför spelaren, dit kameran inte kan sikta.
          const side = Math.sin(this.phase * 2.3) < 0 ? -1 : 1;
          const radial = clamp((dist - 13) * 0.14, -1, 1);
          wishX = -nz * side + nx * radial;
          wishZ = nx * side + nz * radial;
          speed = this.speed * 0.5;
          if (this.stateT <= 0 && dist < 30) {
            this.state = 'dive'; this.stateT = 0.8;
            this.diveX = nx; this.diveZ = nz;
            ctx.sound.droneDive();
          }
        }
        break;
      }

      // Taksnipern: slår sig ner på ett hustak, laddar och skjuter långt.
      case 'sniper': {
        this.aimPitch = Math.atan2((p.pos.y + 1.1) - (this.pos.y + 1.15), Math.max(dist, 0.1));
        const list = ctx.buildings;
        // överger taket om spelaren kommer för nära det
        if (this.perch && dist < 11 &&
            Math.hypot(this.perch.x - p.pos.x, this.perch.z - p.pos.z) < 16) {
          this.perch = null;
        }
        if (!this.perch && list && list.length) {
          let best = null, bestScore = 1e9;
          for (let k = 0; k < 22; k++) {
            const b = list[(Math.random() * list.length) | 0];
            const d = Math.hypot(b.x - p.pos.x, b.z - p.pos.z);
            if (d < 18 || d > 44) continue;
            // bra skjutavstånd till spelaren, men nära nog att flyga dit snabbt
            const own = Math.hypot(b.x - this.pos.x, b.z - this.pos.z);
            const score = Math.abs(d - 28) + own * 0.7 + Math.abs(b.h - 18) * 0.3;
            if (score < bestScore) { bestScore = score; best = b; }
          }
          this.perch = best;
          this.aimT = 0;
        }
        if (this.perch) {
          const px = this.perch.x - this.pos.x, pz = this.perch.z - this.pos.z;
          const pd = Math.hypot(px, pz);
          if (pd > 1.2) {
            wishX = px / pd; wishZ = pz / pd;
            speed = Math.min(this.speed, pd * 3.2);   // bromsa in mot taket
            this.state = 'travel';
            this.aimT = 0;
          } else {
            speed = 0;
            this.state = 'aim';
            if (this.fireCd <= 0) {
              this.aimT += dt;
              // röd siktlinje som telegraferar skottet
              const beads = this.aimT > 1.0 ? 3 : 1;
              for (let k = 0; k < beads; k++) {
                const t = Math.random();
                ctx.particles.spawn({
                  x: lerp(this.pos.x, p.pos.x, t),
                  y: lerp(this.pos.y + 1.15, p.pos.y + 1.1, t),
                  z: lerp(this.pos.z, p.pos.z, t),
                  life: 0.09, size: 0.1 + this.aimT * 0.06, size2: 0.03,
                  col: [1.0, 0.2, 0.2], alpha: 0.5 + this.aimT * 0.3, drag: 0,
                });
              }
              if (this.aimT >= 1.5) {
                this.aimT = 0;
                this.fireCd = this.def.cool * rand(0.9, 1.3);
                ctx.spawnEnemyBullet(this, p, this.def.bullet, this.dmg);
                ctx.sound.snipe();
                if (Math.random() < 0.45) this.perch = null;   // byter position ibland
              }
            } else this.aimT = 0;
          }
        } else {
          // inga tak att välja: håll avstånd som en vanlig skytt
          if (dist > 26) { wishX = nx; wishZ = nz; }
          else { wishX = -nz; wishZ = nx; speed *= 0.7; }
        }
        break;
      }

      // Hover-plattform: tung, sköld framåt, vänder långsamt — måste flankeras.
      case 'hover': {
        if (dist > 18) { wishX = nx; wishZ = nz; }
        else if (dist < 11) { wishX = -nx; wishZ = -nz; speed *= 0.75; }
        else {
          const side = Math.sin(this.phase * 0.7) < 0 ? -1 : 1;
          wishX = -nz * side; wishZ = nx * side;
          speed *= 0.6;
        }
        if (this.fireCd <= 0 && dist < 26 &&
            Math.abs(angleDelta(this.yaw, Math.atan2(nx, nz))) < 0.5) {
          this.fireCd = this.def.cool * rand(0.9, 1.15);
          this.state = 'salvo';
          for (let k = 0; k < 3; k++) {
            const spread = (k - 1) * 0.09;
            const c = Math.cos(spread), s = Math.sin(spread);
            const dy = ((p.pos.y + 1.1) - (this.pos.y + 1.4)) / Math.max(dist, 1);
            ctx.spawnEnemyBulletDir(this, nx * c + nz * s, dy, -nx * s + nz * c,
              this.def.bullet, this.dmg * 0.7);
          }
          ctx.sound.salvo();
        }
        break;
      }

      case 'boss': {
        if (this.state === 'volley') {
          speed = this.speed * 0.2;
          if (this.stateT <= 0) { this.state = 'idle'; this.stateT = rand(1.6, 2.6); }
        } else if (this.state === 'slam') {
          speed = 0;
          if (this.stateT <= 0) {
            ctx.shockwave(this.pos.x, this.pos.y, this.pos.z, 13, this.dmg);
            this.state = 'idle'; this.stateT = rand(1.8, 2.8);
          }
        } else if (this.state === 'summon') {
          speed = 0;
          if (this.stateT <= 0) {
            const minion = ctx.worldId === 'city' ? 'drone' : 'grunt';
            for (let i = 0; i < 3; i++) {
              const a = rand(TAU), d = rand(5, 9);
              ctx.spawnEnemy(minion, this.pos.x + Math.cos(a) * d, this.pos.z + Math.sin(a) * d);
            }
            this.state = 'idle'; this.stateT = rand(2.2, 3.2);
          }
        } else {
          wishX = nx; wishZ = nz;
          if (this.stateT <= 0) {
            const roll = Math.random();
            if (dist < 11 && roll < 0.45) { this.state = 'slam'; this.stateT = 0.9; }
            else if (roll < 0.7) {
              this.state = 'volley'; this.stateT = 0.9;
              const n = 14;
              for (let i = 0; i < n; i++) {
                const a = (i / n) * TAU + this.phase;
                ctx.spawnEnemyBulletDir(this, Math.sin(a), 0.02, Math.cos(a), this.def.bullet, this.dmg * 0.55);
              }
              ctx.sound.tone({ f: 120, f2: 300, dur: 0.3, type: 'square', vol: 0.10 });
            } else { this.state = 'summon'; this.stateT = 0.8; }
          }
        }
        break;
      }

      case 'vildboss': {
        // Jordvredet: stenjätte. Kastar bumlingar i båge på håll, stampar
        // marken på nära håll. Varje fas gör den snabbare och kasten fler.
        const ph = this.updateBossPhase(ctx, 'The Earthwrath splits open', 'The Earthwrath rages');
        const hurry = 1 + (ph - 1) * 0.25;
        if (this.state === 'stomp') {
          speed = 0;
          if (this.stateT <= 0) {
            ctx.shockwave(this.pos.x, this.pos.y, this.pos.z, 15, this.dmg);
            // ring av stenskärvor ut från nedslaget — fler för varje fas
            const n = 8 + ph * 3;
            for (let i = 0; i < n; i++) {
              const a = (i / n) * TAU + this.phase;
              ctx.spawnEnemyBulletDir(this, Math.sin(a), 0.05, Math.cos(a), 17, this.dmg * 0.4);
            }
            this.state = 'idle'; this.stateT = rand(2.0, 3.0) / hurry;
          }
        } else if (this.state === 'boulder') {
          speed = 0;
          if (this.stateT <= 0) {
            // en bumling per fas, med kort mellanrum i siktet
            for (let i = 0; i < ph; i++) {
              const ghost = { pos: {
                x: p.pos.x + (i ? rand(-6, 6) : 0), y: p.pos.y,
                z: p.pos.z + (i ? rand(-6, 6) : 0),
              } };
              ctx.spawnEnemyLob(this, ghost, this.def.bullet, this.dmg * 0.8, 1.0);
            }
            ctx.sound.tone({ f: 90, f2: 45, dur: 0.4, type: 'sawtooth', vol: 0.12 });
            this.state = 'idle'; this.stateT = rand(1.7, 2.5) / hurry;
          }
        } else {
          wishX = nx; wishZ = nz;
          speed = this.speed * hurry;
          if (this.stateT <= 0) {
            if (dist < 13) { this.state = 'stomp'; this.stateT = 0.9; }
            else if (dist < 55) { this.state = 'boulder'; this.stateT = 0.7; }
            else this.stateT = 0.4;   // för långt bort — fortsätt gå
          }
        }
        break;
      }

      case 'cityboss': {
        // Saneraren: svävande ringmaskin. Cirklar runt spelaren, fäller ut
        // solfjädrar av skott, och blinkar till ny vinkel i senare faser.
        const ph = this.updateBossPhase(ctx, 'The Sanitiser escalates', 'The Sanitiser purges');
        const ring = 15;
        if (this.state === 'sweep') {
          speed = this.speed * 0.15;
          if (this.stateT <= 0) {
            const n = 3 + ph * 2;
            const spreadA = 0.55;
            const base = Math.atan2(nx, nz);
            for (let i = 0; i < n; i++) {
              const a = base + (i / (n - 1) - 0.5) * spreadA;
              ctx.spawnEnemyBulletDir(this, Math.sin(a), (p.pos.y + 1.1 - this.pos.y) * 0.02, Math.cos(a),
                this.def.bullet, this.dmg * 0.6);
            }
            ctx.sound.salvo();
            this.state = 'idle'; this.stateT = rand(1.4, 2.2) / (1 + (ph - 1) * 0.3);
          }
        } else if (this.state === 'blink') {
          speed = 0;
          if (this.stateT <= 0) {
            // hoppar ~120° runt spelaren — flanken byts innan siktet hunnit med
            const cur = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z);
            const next = cur + this.orbitDir * rand(1.6, 2.4);
            ctx.particles.burst(this.pos.x, this.pos.y + 1, this.pos.z, 22,
              { speed: 8, life: 0.5, size: 0.5, col: this.col, alpha: 0.9, drag: 0.5 });
            this.pos.x = p.pos.x + Math.sin(next) * ring;
            this.pos.z = p.pos.z + Math.cos(next) * ring;
            this.vel.x = this.vel.z = 0;
            ctx.particles.burst(this.pos.x, this.pos.y + 1, this.pos.z, 22,
              { speed: 8, life: 0.5, size: 0.5, col: this.col, alpha: 0.9, drag: 0.5 });
            ctx.sound.tone({ f: 900, f2: 300, dur: 0.18, type: 'square', vol: 0.08 });
            this.state = 'idle'; this.stateT = rand(1.2, 1.8);
          }
        } else {
          // cirkla med radiell korrigering — utan den spiralerar den in
          // rakt över spelaren, precis som drönarna gjorde (se CLAUDE.md)
          wishX = -nz * this.orbitDir + nx * (dist - ring) * 0.15;
          wishZ = nx * this.orbitDir + nz * (dist - ring) * 0.15;
          if (this.fireCd <= 0) {
            this.fireCd = this.def.cool * rand(0.8, 1.2);
            ctx.spawnEnemyBullet(this, p, this.def.bullet, this.dmg * 0.5);
          }
          if (this.stateT <= 0) {
            const roll = Math.random();
            if (ph >= 2 && roll < 0.3) { this.state = 'blink'; this.stateT = 0.45; }
            else { this.state = 'sweep'; this.stateT = 0.7; }
          }
        }
        break;
      }
    }

    // separation så de inte staplas på varandra
    let sx = 0, sz = 0;
    for (const o of ctx.enemies) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      const min = this.radius + o.radius + 0.25;
      if (d2 < min * min && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        sx += (ox / d) * (1 - d / min);
        sz += (oz / d) * (1 - d / min);
      }
    }
    wishX += sx * 1.9; wishZ += sz * 1.9;

    const wl = Math.hypot(wishX, wishZ);
    if (wl > 0.001) {
      const accel = 30 * dt;
      const tx = (wishX / wl) * speed, tz = (wishZ / wl) * speed;
      this.vel.x += clamp(tx - this.vel.x, -accel, accel);
      this.vel.z += clamp(tz - this.vel.z, -accel, accel);
    } else {
      const f = Math.exp(-6 * dt);
      this.vel.x *= f; this.vel.z *= f;
    }

    if (this.fly) {
      // Neotropolis: monstren svävar. Snipern sätter sig på taket, drönarna
      // cirklar högt och dyker, resten söker spelarens höjd.
      const gh = terrainHeight(this.pos.x, this.pos.z);
      let wantY;
      if (this.def.ai === 'sniper' && this.perch) {
        wantY = this.perch.h + 1.0;
      } else if (guarding) {
        // en vakt svävar över sitt eget läger, inte över spelaren
        wantY = terrainHeight(this.home.x, this.home.z)
          + (this.def.ai === 'hover' ? 2.6 : 2.2) + Math.sin(this.phase * 1.7) * 0.5;
      } else {
        const off = this.def.ai === 'drone'
          ? (this.state === 'dive' || this.enrage ? 0.5 : 4.5)
          : this.def.ai === 'hover' ? 2.6
          : this.boss ? 1.5 : 0.5;
        wantY = p.pos.y + off + Math.sin(this.phase * 1.7) * 0.9;
      }
      wantY = Math.max(gh + 1.0, wantY);
      this.vel.y += clamp((wantY - this.pos.y) * 4 - this.vel.y * 2.2, -26, 26) * dt;
    } else {
      this.vel.y -= 30 * dt;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    clampToArena(this.pos);
    ctx.colliders.resolve(this.pos, this.radius);

    const gh = terrainHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gh) { this.pos.y = gh; this.vel.y = 0; this.grounded = true; }
    else this.grounded = false;

    // vänd mot spelaren — hover-plattformen vrider sig trögt, därav flanken.
    // En vakt tittar dit den går i stället, den vet ju inte om dig än.
    const face = guarding && this.planar > 0.25
      ? Math.atan2(this.vel.x, this.vel.z)
      : Math.atan2(nx, nz);
    this.yaw += angleDelta(this.yaw, face) * Math.min(1, dt * (this.def.turn || 8));
    this.phase += dt;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
    this.planar = Math.hypot(this.vel.x, this.vel.z);
    this.walk += dt * (this.planar * 1.5 + 0.6);

    // chargern frustar under uppladdningen
    if (this.def.ai === 'charge' && this.state === 'windup' && Math.random() < 0.45) {
      const hx = this.pos.x + Math.sin(this.yaw) * 1.5, hz = this.pos.z + Math.cos(this.yaw) * 1.5;
      ctx.particles.spawn({
        x: hx, y: this.pos.y + 0.9, z: hz,
        vx: Math.sin(this.yaw) * 3 + rand(-1, 1), vy: rand(0.5, 1.5), vz: Math.cos(this.yaw) * 3 + rand(-1, 1),
        life: rand(0.3, 0.5), size: 0.5, size2: 0.1, col: [0.8, 0.8, 0.85], alpha: 0.5, drag: 0.6,
      });
    }

    // kontaktskada
    const contact = this.radius + p.radius + 0.35;
    if (dist < contact && Math.abs(this.pos.y - p.pos.y) < this.height + 1.2 && this.hitCd <= 0) {
      const boost = this.state === 'charging' ? 1.5 : 1;
      if (ctx.player.takeDamage(this.dmg * boost)) {
        this.hitCd = 0.75;
        ctx.sound.hurt();
        ctx.particles.burst(p.pos.x, p.pos.y + 1.2, p.pos.z, 12,
          { speed: 6, life: 0.4, size: 0.5, col: [1.0, 0.25, 0.3], alpha: 0.9, drag: 0.5 });
        if (this.state === 'charging') { this.state = 'recover'; this.stateT = 1.0; this.vel.x *= -0.3; this.vel.z *= -0.3; }
      }
    }
  }

  draw(rend, time) {
    const B = rend.dyn;
    const f = this.flash;
    const c = [lerp(this.col[0], 1, f), lerp(this.col[1], 1, f), lerp(this.col[2], 1, f)];
    const dark = [c[0] * 0.42, c[1] * 0.42, c[2] * 0.42];
    const belly = [lerp(c[0], 1, 0.35), lerp(c[1], 1, 0.35), lerp(c[2], 1, 0.35)];
    const bone = [0.92, 0.88, 0.78];
    const x = this.pos.x, y = this.pos.y, z = this.pos.z, yaw = this.yaw;
    const csY = Math.cos(yaw), snY = Math.sin(yaw);

    // Under döden faller hela kroppen framåt, sjunker ner och krymper bort.
    // Kroppsskalan rider med här: både P() och put() går genom shrink, så
    // hela modellen växer utan att en enda mätsiffra i ritningen ändras.
    const dying = this.death > 0;
    const dT = dying ? 1 - this.death / this.deathMax : 0;
    const shrink = (1 - dT * dT * 0.75) * this.scale;
    const fall = dT * 1.5;
    const cf = Math.cos(fall), sf = Math.sin(fall);

    // Lokala koordinater: +z = framåt (mot spelaren), +x = höger.
    const P = (lx, ly, lz) => {
      let px = lx * shrink, py = ly * shrink, pz = lz * shrink;
      if (dying) { const ny = py * cf - pz * sf; pz = py * sf + pz * cf; py = ny; }
      return [x + csY * px + snY * pz, y + py - dT * 0.3, z - snY * px + csY * pz];
    };
    // Neotropolis: monstren är neonskyltar i natten. Delar i kroppsfärgen
    // självlyser med en långsam puls, mörka delar får en svag ton så
    // siluetten hålls ihop — och ljuset slocknar i takt med att de dör.
    const neon = this.fly
      ? (0.55 + Math.sin(time * 2.2 + this.phase * 7) * 0.12) * (1 - dT)
      : 0;
    const put = (batch, p, sx, sy, sz, col, rx = 0, ryOff = 0, rz = 0, g = 0) => {
      if (neon > 0) {
        if (col === c || col === belly) g = Math.max(g, neon);
        else if (col === dark) g = Math.max(g, 0.16 * (1 - dT));
      }
      batch.push(p[0], p[1], p[2], sx * shrink, sy * shrink, sz * shrink, col,
        rx + fall, yaw + ryOff, rz, g);
    };
    const pop = 1 + f * 0.06;                 // liten "träffstuds" i skalan
    const glow = 0.2 + f * 0.9;
    const blink = Math.sin(time * 1.7 + this.phase * 9) > 0.96 ? 0.15 : 1;

    switch (this.type) {
      case 'grunt': {
        const run = this.walk * 1.7;
        const sq = 1 + Math.sin(run * 2) * 0.05;
        const hop = Math.abs(Math.sin(run)) * 0.10;
        // ben som tassar
        for (const s of [-1, 1]) {
          const ph = run + (s > 0 ? 0 : Math.PI);
          const sw = Math.sin(ph) * 0.75;
          put(B.box, P(0.34 * s, 0.34 + Math.max(0, -Math.cos(ph)) * 0.1, Math.sin(sw) * 0.12),
            0.26, 0.55, 0.32, dark, sw, 0, 0, 0);
        }
        // kropp med ljusare mage
        put(B.sphere, P(0, 0.95 + hop, 0), 1.35 * pop, 1.3 * sq * pop, 1.25 * pop, c, 0, 0, 0, glow * 0.4);
        put(B.sphere, P(0, 0.8 + hop, 0.34), 0.85, 0.72, 0.55, belly, 0, 0, 0, 0);
        // gapande käft med tänder
        const gape = 0.1 + (Math.sin(time * 7 + this.phase * 3) * 0.5 + 0.5) * 0.16;
        put(B.box, P(0, 0.82 + hop, 0.58), 0.66, gape + 0.14, 0.28, [0.08, 0.02, 0.05], 0.15, 0, 0, 0);
        for (const s of [-1, 1]) {
          put(B.cone, P(0.2 * s, 0.78 + hop, 0.68), 0.09, 0.2, 0.07, bone, Math.PI, 0, 0, 0);
        }
        // ögon med pupiller (blinkar)
        for (const s of [-1, 1]) {
          put(B.sphere, P(0.28 * s, 1.32 + hop, 0.46), 0.3, 0.3 * blink, 0.22, [1, 0.97, 0.9], 0, 0, 0, 0.5);
          put(B.sphere, P(0.28 * s, 1.32 + hop, 0.58), 0.13, 0.13 * blink, 0.1, [0.05, 0.02, 0.02], 0, 0, 0, 0);
        }
        // horn och ryggtaggar
        for (const s of [-1, 1]) {
          put(B.cone, P(0.32 * s, 1.74 + hop, -0.02), 0.2, 0.5, 0.2, bone, -0.15, 0, -0.55 * s, 0);
        }
        put(B.cone, P(0, 1.48 + hop, -0.48), 0.18, 0.42, 0.14, dark, -1.0, 0, 0, 0);
        put(B.cone, P(0, 1.12 + hop, -0.6), 0.14, 0.32, 0.11, dark, -1.25, 0, 0, 0);
        // armar
        for (const s of [-1, 1]) {
          const sw = Math.sin(run + (s > 0 ? Math.PI : 0)) * 0.6;
          put(B.box, P(0.72 * s, 0.95 + hop, 0.05), 0.2, 0.5, 0.2, c, sw - 0.3, 0, -0.2 * s, 0);
        }
        break;
      }
      case 'spitter': {
        const hover = 0.5 + Math.sin(this.phase * 2.2) * 0.14;
        const charge = clamp(1 - this.fireCd / (this.def.cool || 1), 0, 1);
        // slöja i två lager som roterar åt olika håll
        put(B.cone, P(0, 0.75 + hover * 0.5, 0), 1.45 * pop, 1.8, 1.45 * pop, c, 0, time * 0.5, 0, glow * 0.4);
        put(B.cone, P(0, 0.55 + hover * 0.5, 0), 1.15, 1.5, 1.15, dark, 0, -time * 0.7, 0, 0.15);
        // bål, huvud och huva
        put(B.sphere, P(0, 1.7 + hover, 0), 0.8, 0.9, 0.8, dark, 0, 0, 0, glow * 0.5);
        put(B.sphere, P(0, 2.25 + hover, 0.05), 0.72, 0.66, 0.72, c, 0, 0, 0, glow * 0.5);
        put(B.cone, P(0, 2.62 + hover, -0.08), 0.6, 0.7, 0.6, dark, -0.25, 0, 0, 0);
        // cyklopöga
        put(B.sphere, P(0, 2.3 + hover, 0.38), 0.42, 0.42 * blink, 0.3, [1, 0.98, 0.92], 0, 0, 0, 0.6);
        put(B.sphere, P(0, 2.3 + hover, 0.55), 0.2, 0.2 * blink, 0.12, [0.4, 0.05, 0.5], 0, 0, 0, 0.3);
        // eldrör som glöder upp inför skottet
        put(B.cyl, P(0, 1.75 + hover, 0.55), 0.3, 0.75, 0.3, dark, Math.PI / 2, 0, 0, 0.1 + charge * 0.6);
        const orb = 0.22 + charge * 0.16;
        put(B.sphere, P(0, 1.75 + hover, 0.95), orb, orb, orb, [0.85, 0.5, 1.0], 0, 0, 0, 0.3 + charge * 1.4);
        // hängande armar som svajar
        for (const s of [-1, 1]) {
          put(B.cone, P(0.68 * s, 1.7 + hover, 0.08), 0.16, 0.8, 0.16, c,
            Math.PI + Math.sin(this.phase * 2 + s) * 0.15, 0, 0.12 * s, glow * 0.3);
        }
        break;
      }
      case 'charger': {
        const gallop = this.walk * 1.35;
        const wind = this.state === 'windup' ? Math.sin(time * 42) * 0.1 : 0;
        const rage = this.state === 'windup' || this.state === 'charging' ? 1 : 0;
        const lean = clamp(this.planar * 0.02, 0, 0.22);
        // fyra ben i galopp: frampar och bakpar i motfas
        for (const fz of [0.62, -0.72]) {
          for (const s of [-1, 1]) {
            const ph = gallop + (fz > 0 ? 0 : Math.PI) + (s > 0 ? 0 : 0.5);
            const sw = Math.sin(ph) * 0.65;
            put(B.box, P(0.52 * s, 0.42 + Math.max(0, -Math.cos(ph)) * 0.12, fz + Math.sin(sw) * 0.15),
              0.28, 0.72, 0.34, dark, sw, 0, 0, 0);
          }
        }
        // kropp som lutar framåt med farten, bogparti
        put(B.box, P(0, 1.15, -0.1), 1.35 * pop, 1.0 * pop, 1.9, c, lean + wind * 0.3, wind, 0,
          glow * 0.4 + rage * 0.3);
        put(B.box, P(0, 1.62, -0.55), 1.05, 0.55, 0.95, dark, -0.15, 0, 0, 0);
        // sänkt huvud med nos
        put(B.box, P(0, 0.98, 1.12), 0.85, 0.68, 0.8, dark, -0.22 - rage * 0.15, wind, 0, 0);
        put(B.box, P(0, 0.8, 1.5), 0.5, 0.35, 0.3, [0.1, 0.06, 0.08], -0.2, 0, 0, 0);
        // horn av ben, pekar framåt-utåt
        for (const s of [-1, 1]) {
          put(B.cone, P(0.44 * s, 1.18, 1.42), 0.17, 0.8, 0.17, bone, 1.15, 0, -0.35 * s, 0);
        }
        // glödande ögon — brinner starkare vid anfall
        for (const s of [-1, 1]) {
          put(B.sphere, P(0.26 * s, 1.12, 1.48), 0.13, 0.11, 0.1, [1, 0.25, 0.1], 0, 0, 0, 0.9 + rage * 1.3);
        }
        // piskande svans
        put(B.cone, P(0, 1.5, -1.05), 0.13, 0.6, 0.13, dark,
          -2.3 + Math.sin(time * 4 + this.phase) * 0.25, 0, 0, 0);
        break;
      }
      case 'tank': {
        const stomp = this.walk * 0.85;
        const sway = Math.sin(stomp) * 0.05;
        // tunga stampande ben
        for (const s of [-1, 1]) {
          const sw = Math.sin(stomp + (s > 0 ? 0 : Math.PI)) * 0.35;
          put(B.box, P(0.68 * s, 0.62, Math.sin(sw) * 0.25), 0.62, 1.25, 0.72, dark, sw, 0, 0, 0);
        }
        // höft, bål som svajar, bröstplåt
        put(B.box, P(0, 1.45, 0), 1.7, 0.55, 1.15, dark, 0, 0, sway * 0.4, 0);
        put(B.box, P(0, 2.3, 0), 2.3 * pop, 1.5 * pop, 1.5, c, 0, 0, sway, glow * 0.4);
        put(B.box, P(0, 2.32, 0.78), 1.6, 1.05, 0.22, dark, 0, 0, sway, 0);
        // axlar, armar och nävar
        for (const s of [-1, 1]) {
          const sw = Math.sin(stomp + (s > 0 ? Math.PI : 0)) * 0.28;
          put(B.sphere, P(1.5 * s, 2.95, 0), 1.15, 0.95, 1.05, dark, 0, 0, sway, 0);
          put(B.box, P(1.55 * s, 1.95, Math.sin(sw) * 0.3), 0.52, 1.5, 0.52, c, sw, 0, 0.06 * s, glow * 0.3);
          put(B.box, P(1.55 * s, 1.15, Math.sin(sw) * 0.55), 0.68, 0.6, 0.7, dark, sw * 0.5, 0, 0, 0);
        }
        // huvud med lysande visir
        put(B.box, P(0, 3.35, 0.25), 0.72, 0.6, 0.65, dark, 0, 0, sway, 0);
        put(B.box, P(0, 3.38, 0.58), 0.55, 0.16, 0.12, [0.5, 1.0, 0.9], 0, 0, 0, 1.3);
        // pulserande energikärna + ryggkristaller
        put(B.octa, P(0, 2.3, 0.92), 0.42, 0.55, 0.42, [0.6, 1.0, 0.85], 0, time * 2.5, 0,
          0.9 + Math.sin(time * 4) * 0.35);
        put(B.octa, P(0, 3.1, -0.7), 0.5, 0.9, 0.5, c, 0.5, 0, 0.15, 0.7);
        put(B.octa, P(0.5, 2.7, -0.8), 0.35, 0.6, 0.35, c, 0.4, 0.6, -0.2, 0.6);
        put(B.octa, P(-0.5, 2.65, -0.75), 0.32, 0.55, 0.32, c, 0.45, -0.5, 0.25, 0.6);
        break;
      }
      // --------------------------------------------- Neotropolis-maskinerna

      case 'drone': {
        const spin = time * 30;
        const diving = this.state === 'dive';
        put(B.box, P(0, 0.38, 0), 0.5, 0.26, 0.66, c, diving ? 0.35 : 0, 0, 0,
          glow + (diving ? 0.9 : 0.15));
        for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          put(B.box, P(0.3 * ax, 0.38, 0.3 * az), 0.4, 0.06, 0.09, dark, 0, Math.atan2(ax, az), 0, 0);
          put(B.octa, P(0.52 * ax, 0.46, 0.52 * az), 0.6, 0.05, 0.6, [0.75, 0.8, 0.9],
            0, spin * (ax * az > 0 ? 1 : -1), 0, 0.3);
        }
        // sensoröga
        put(B.sphere, P(0, 0.36, 0.36), 0.25, 0.25 * blink, 0.18, [1, 0.97, 0.88], 0, 0, 0, 0.6);
        put(B.sphere, P(0, 0.36, 0.45), 0.12, 0.12 * blink, 0.08, [1, 0.25, 0.12], 0, 0, 0,
          diving ? 1.6 : 0.8);
        break;
      }

      case 'sniper': {
        const chg = clamp(this.aimT / 1.5, 0, 1);
        const perched = this.state === 'aim';
        // tripodben, hopfällda under färd
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU + 0.5;
          const spread = perched ? 0.45 : 0.16;
          put(B.cone, P(Math.cos(a) * spread, 0.34, Math.sin(a) * spread),
            0.15, 0.72, 0.15, dark, Math.PI + (perched ? 0.3 : 0.05),
            Math.atan2(Math.cos(a), Math.sin(a)), 0, 0);
        }
        put(B.box, P(0, 0.88, 0), 0.66, 0.46, 0.76, c, 0, 0, 0, glow * 0.5);
        put(B.sphere, P(0, 1.2, 0.06), 0.5, 0.46, 0.5, dark, 0, 0, 0, 0);
        // lång pipa som följer spelaren i höjdled
        const bp = Math.PI / 2 - this.aimPitch;
        put(B.cyl, P(0, 1.16, 0.9), 0.12, 1.6, 0.12, [0.24, 0.27, 0.33], bp, 0, 0, 0.05);
        put(B.box, P(0, 1.16, 0.35), 0.26, 0.2, 0.5, dark, 0, 0, 0, 0);
        // kikarsikte som laddar upp inför skottet
        put(B.octa, P(0, 1.46, 0.2), 0.2, 0.28, 0.2, [1.0, 0.35 - chg * 0.25, 0.3],
          0, time * 3, 0, 0.35 + chg * 1.7);
        break;
      }

      case 'hover': {
        const sh = this.shieldFlash;
        // skrov
        put(B.box, P(0, 1.05, 0), 3.3, 0.5, 2.5, c, 0, 0, 0, glow * 0.35);
        put(B.box, P(0, 0.78, 0), 2.7, 0.3, 1.9, dark, 0, 0, 0, 0);
        // frontsköld — lyser till när den blockar
        put(B.box, P(0, 1.35, 1.4), 3.5, 1.5, 0.22,
          [lerp(0.35, 1, sh), lerp(0.72, 0.95, sh), 1.0], -0.2, 0, 0, 0.4 + sh * 1.6);
        put(B.box, P(0, 2.12, 1.32), 3.5, 0.14, 0.3, [0.6, 0.85, 1.0], -0.2, 0, 0, 0.9);
        // torn med dubbelpipor
        put(B.sphere, P(0, 1.6, -0.25), 1.35, 1.0, 1.35, dark, 0, 0, 0, glow * 0.4);
        for (const s of [-1, 1]) {
          put(B.cyl, P(0.32 * s, 1.55, 0.75), 0.15, 1.2, 0.15, [0.28, 0.3, 0.38],
            Math.PI / 2, 0, 0, this.state === 'salvo' ? 0.7 : 0.08);
        }
        put(B.octa, P(0, 2.15, -0.25), 0.4, 0.5, 0.4, [0.7, 0.8, 1.0], 0, time * 2, 0, 0.9);
        // lyftmotorer under
        for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          put(B.cyl, P(1.25 * ax, 0.6, 0.9 * az), 0.44, 0.42, 0.44, dark, 0, 0, 0, 0);
          put(B.octa, P(1.25 * ax, 0.32, 0.9 * az), 0.34, 0.26, 0.34, [0.5, 0.72, 1.0],
            0, time * 5, 0, 1.0);
        }
        break;
      }

      case 'boss': {
        const pulse = 1 + Math.sin(time * 3) * 0.04;
        const gape = this.state === 'volley' || this.state === 'slam'
          ? 0.75 : 0.2 + Math.sin(time * 2.3) * 0.08;
        // massiv kropp
        put(B.sphere, P(0, 2.5 * pulse, 0), 4.5 * pop, 4.4 * pulse * pop, 4.5 * pop, c, 0, 0, 0, glow * 0.5 + 0.2);
        // hornkrona som lutar utåt
        for (let i = 0; i < 6; i++) {
          const ai = (i / 6) * TAU + 0.26;
          const lx = Math.cos(ai) * 1.9, lz = Math.sin(ai) * 1.9;
          put(B.cone, P(lx, 4.55, lz), 0.5, 1.6, 0.5, dark, 0.55, Math.atan2(lx, lz), 0, 0.25);
        }
        // tre ögon med pupiller
        put(B.sphere, P(0, 3.1, 1.95), 0.85, 0.85 * blink, 0.5, [1, 0.95, 0.9], 0, 0, 0, 0.7);
        put(B.sphere, P(0, 3.1, 2.28), 0.4, 0.4 * blink, 0.2, [0.6, 0.02, 0.1], 0, 0, 0, 0.5);
        for (const s of [-1, 1]) {
          put(B.sphere, P(0.95 * s, 3.6, 1.7), 0.42, 0.42 * blink, 0.28, [1, 0.95, 0.9], 0, 0, 0, 0.6);
          put(B.sphere, P(0.95 * s, 3.6, 1.9), 0.18, 0.18 * blink, 0.1, [0.6, 0.02, 0.1], 0, 0, 0, 0.4);
        }
        // käft med tandrader — gapar vid attack
        put(B.box, P(0, 1.75, 1.9), 1.7, 0.5 + gape, 0.5, [0.06, 0.01, 0.04], 0.2, 0, 0, 0);
        for (const s of [-1.5, -0.5, 0.5, 1.5]) {
          put(B.cone, P(0.32 * s, 2.12 + gape * 0.4, 2.02), 0.13, 0.3, 0.1, bone, Math.PI, 0, 0, 0);
          put(B.cone, P(0.32 * s + 0.16, 1.45 - gape * 0.4, 1.98), 0.11, 0.26, 0.09, bone, 0, 0, 0, 0);
        }
        // armar med klor
        for (const s of [-1, 1]) {
          const sw = Math.sin(time * 1.1 + s) * 0.12;
          put(B.box, P(2.9 * s, 2.6, 0.3), 1.0, 2.8, 1.0, dark, sw, 0, 0.12 * s, glow * 0.4);
          for (let k = -1; k <= 1; k++) {
            put(B.cone, P(2.9 * s + k * 0.3, 1.0, 0.55 + k * 0.12), 0.16, 0.55, 0.16, bone,
              Math.PI - 0.25, 0, k * 0.2, 0);
          }
        }
        // svajande tentakler under kroppen
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU + time * 0.4;
          const lx = Math.cos(a) * 2.3, lz = Math.sin(a) * 2.3;
          put(B.cone, P(lx, 0.55, lz), 0.3, 1.3, 0.3, dark,
            Math.PI + Math.sin(time * 2 + i * 2) * 0.25, Math.atan2(lx, lz), 0, 0.2);
        }
        // kretsande skärvor — de faller in mot kroppen när bossen dör
        for (let i = 0; i < 5; i++) {
          const a = time * 1.2 + (i / 5) * TAU;
          const r = 4.2 * (1 - dT);
          B.octa.push(x + Math.cos(a) * r, y + (2.6 + Math.sin(a * 2 + i) * 0.8) * shrink, z + Math.sin(a) * r,
            0.8 * shrink, 1.1 * shrink, 0.8 * shrink, [1, 0.5, 0.7], 0, a * 3, 0, 1.1);
        }
        if (this.state === 'slam') {
          B.sphere.push(x, y + 0.2, z, 6 + Math.sin(time * 30) * 1.5, 0.4, 6, [1, 0.4, 0.2], 0, 0, 0, 1.2);
        }
        break;
      }

      case 'vildboss': {
        // Jordvredet: en jätte av staplade stenblock med glödande sprickor.
        // Glöden går från bärnsten mot rött allteftersom faserna trappas upp.
        const ph = this.bossPhase;
        const stone = c, mossy = dark;
        const ember = ph === 3 ? [1.0, 0.25, 0.12] : ph === 2 ? [1.0, 0.45, 0.10] : [1.0, 0.65, 0.15];
        const emberGlow = 0.7 + ph * 0.25 + Math.sin(time * (2 + ph)) * 0.2;
        const rumble = this.state === 'stomp' ? Math.sin(time * 34) * 0.08 : 0;
        // ben av två grova block
        for (const s of [-1, 1]) {
          const step = Math.sin(this.walk * 1.2 + (s > 0 ? 0 : Math.PI)) * 0.3;
          put(B.box, P(1.05 * s, 0.9, step * 0.5), 0.95, 1.8, 1.05, mossy, step * 0.3, 0, 0, 0);
          put(B.box, P(1.05 * s, 0.25, step * 0.7), 1.15, 0.5, 1.3, stone, 0, 0, 0, 0);
        }
        // höft, bål och bröst — allt något förskjutet, som staplad sten
        put(B.box, P(0, 2.1 + rumble, 0), 2.5, 1.0, 1.7, stone, 0, 0.06, 0, 0);
        put(B.box, P(0.1, 3.15 + rumble, 0.1), 2.9, 1.3, 2.0, mossy, 0, -0.08, 0.03, 0);
        put(B.box, P(-0.05, 4.3 + rumble, 0), 2.4, 1.1, 1.6, stone, 0, 0.1, -0.02, 0);
        // glödande sprickor mellan blocken
        put(B.box, P(0, 2.68 + rumble, 0), 2.2, 0.14, 1.5, ember, 0, 0.02, 0, emberGlow);
        put(B.box, P(0, 3.85 + rumble, 0), 2.0, 0.12, 1.4, ember, 0, -0.04, 0, emberGlow);
        // hjärtat i bröstet — själva svagheten, ph gör den argare
        put(B.octa, P(0, 3.3 + rumble, 1.05), 0.5, 0.7, 0.4, ember, 0, time * (1 + ph), 0, emberGlow + 0.4);
        // huvud: lågt block med två glödande ögon under panna av sten
        put(B.box, P(0, 5.15 + rumble, 0.2), 1.2, 0.75, 1.1, stone, 0, 0, 0, 0);
        put(B.box, P(0, 5.5 + rumble, 0.35), 1.35, 0.3, 0.9, mossy, 0.15, 0, 0, 0);
        for (const s of [-1, 1]) {
          put(B.box, P(0.32 * s, 5.1 + rumble, 0.72), 0.2, 0.14 * blink, 0.1, ember, 0, 0, 0, emberGlow + 0.3);
        }
        // armar: hängande blockkedjor som lyfts i stampen
        for (const s of [-1, 1]) {
          const raise = this.state === 'stomp' ? 1.1 - this.stateT : Math.sin(time * 0.9 + s) * 0.1;
          put(B.box, P(2.05 * s, 3.9 + raise * 0.8, 0.2), 0.85, 1.5, 0.95, mossy, raise * 0.8, 0, 0.15 * s, 0);
          put(B.box, P(2.15 * s, 2.4 + raise * 1.4, 0.35), 1.05, 1.4, 1.15, stone, raise * 1.2, 0, 0.1 * s, 0);
        }
        // fas 3: lösa stenar kretsar kring jätten
        if (ph >= 3) {
          for (let i = 0; i < 4; i++) {
            const a = time * 1.4 + (i / 4) * TAU;
            B.box.push(x + Math.cos(a) * 4.1, y + 2.8 + Math.sin(a * 2 + i) * 0.9, z + Math.sin(a) * 4.1,
              0.5, 0.5, 0.5, mossy, a, a * 1.7, 0, 0.1);
          }
        }
        if (this.state === 'stomp') {
          B.sphere.push(x, y + 0.2, z, 7 + Math.sin(time * 30) * 1.5, 0.4, 7, ember, 0, 0, 0, 1.2);
        }
        break;
      }

      case 'cityboss': {
        // Saneraren: ett vitt maskinöga i en roterande ring — sterilt, inte
        // vilt. Ringen snurrar fortare och trimmen blör rödare per fas.
        const ph = this.bossPhase;
        const shell = c;
        const trim = ph === 3 ? [1.0, 0.2, 0.3] : ph === 2 ? [1.0, 0.3, 0.6] : [0.85, 0.2, 0.45];
        const spin = time * (0.9 + ph * 0.6);
        const charge = this.state === 'sweep' ? 1.4 : 0.5;
        // kärnan: öga med lins som följer spelaren via yaw (put roterar med yaw)
        put(B.sphere, P(0, 1.3, 0), 1.5 * pop, 1.5 * pop, 1.5 * pop, shell, 0, 0, 0, 0.25 + f);
        put(B.sphere, P(0, 1.3, 1.15), 0.62, 0.62 * blink, 0.4, trim, 0, 0, 0, charge + 0.4);
        put(B.sphere, P(0, 1.3, 1.38), 0.24, 0.24 * blink, 0.14, [0.05, 0.02, 0.05], 0, 0, 0, 0.2);
        // roterande ring av plattor
        for (let i = 0; i < 8; i++) {
          const a = spin + (i / 8) * TAU;
          B.box.push(x + Math.cos(a) * 2.5, y + 1.3 + Math.sin(time * 1.8 + i) * 0.1, z + Math.sin(a) * 2.5,
            0.22, 0.75, 0.5, i % 2 ? shell : trim, 0, a, 0, i % 2 ? 0.15 : 0.7);
        }
        // vingpar bakåt
        for (const s of [-1, 1]) {
          put(B.box, P(1.35 * s, 1.75, -0.7), 1.1, 0.14, 0.75, shell, 0.1, 0, 0.35 * s, 0.2);
          put(B.box, P(1.9 * s, 1.95, -0.85), 0.6, 0.09, 0.5, trim, 0.15, 0, 0.5 * s, 0.8);
        }
        // svävfältet under
        B.cyl.push(x, y + 0.15, z, 1.6, 0.08, 1.6, trim, 0, 0, 0, 0.8 + Math.sin(time * 6) * 0.25);
        break;
      }
    }

    const air = Math.max(0, this.pos.y - terrainHeight(x, z));
    rend.shadow(x, terrainHeight(x, z), z, this.radius * 2.1 * shrink,
      0.4 * Math.max(0, 1 - air * 0.1) * (1 - dT));
  }
}

// ------------------------------------------------------------------- vågor

export class WaveManager {
  constructor() { this.reset(); }

  reset() {
    this.wave = 0;
    this.state = 'idle';
    this.timer = 2.0;
    this.queue = [];
    this.spawnTimer = 0;
    this.spawnedThisWave = 0;
    this.clearT = 0;
    this.enraged = false;
  }

  compose(wave, worldId) {
    const list = [];
    if (wave % 5 === 0) list.push('boss');
    const budget = 5 + wave * 2.2;
    let spent = 0;

    const options = [];
    if (worldId === 'city') {
      // Neotropolis har sin egen robotpark
      options.push(['drone', 0.7]);
      if (wave >= 2) options.push(['sniper', 2.5]);
      if (wave >= 3) options.push(['spitter', 1.6]);
      if (wave >= 4) options.push(['hover', 4.2]);
    } else {
      options.push(['grunt', 1]);
      if (wave >= 2) options.push(['spitter', 1.6]);
      if (wave >= 3) options.push(['charger', 2.2]);
      if (wave >= 5) options.push(['tank', 3.4]);
    }

    while (spent < budget) {
      const [type, cost] = options[randInt(0, options.length - 1)];
      if (type === 'drone') {
        // drönare kommer alltid i svärm
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

  startWave(ctx) {
    this.wave++;
    this.queue = this.compose(this.wave, ctx.worldId);
    this.spawnTimer = 0;
    this.state = 'spawning';
    ctx.onWaveStart(this.wave, this.queue.includes('boss'));
  }

  update(dt, ctx) {
    if (this.state === 'idle') {
      this.timer -= dt;
      if (this.timer <= 0) this.startWave(ctx);
      return;
    }
    if (this.state === 'spawning') {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.queue.length) {
        const type = this.queue.shift();
        this.spawnAtRing(type, ctx);
        this.spawnTimer = type === 'boss' ? 1.2 : rand(0.20, 0.55);
      }
      if (!this.queue.length) { this.state = 'clearing'; this.clearT = 0; this.enraged = false; }
      return;
    }
    if (this.state === 'clearing') {
      if (!ctx.enemies.some((e) => e.alive)) {
        this.state = 'idle';
        this.timer = 4.5;
        ctx.onWaveClear(this.wave);
        return;
      }
      // Skyddsnät: en ensam eftersläntrare får aldrig låsa spelet för gott.
      // Först hetsas de kvarvarande att söka upp spelaren, sedan rullar
      // vågorna vidare ändå.
      this.clearT += dt;
      if (this.clearT > 12 && !this.enraged) {
        this.enraged = true;
        for (const e of ctx.enemies) if (e.alive) e.enrage = true;
        ctx.toast('The stragglers are hunting you');
      }
      if (this.clearT > 26) {
        this.state = 'idle';
        this.timer = 2.5;
        ctx.onWaveClear(this.wave);
      }
    }
  }

  spawnAtRing(type, ctx) {
    const p = ctx.player.pos;
    for (let tries = 0; tries < 24; tries++) {
      const a = rand(TAU);
      const d = rand(38, 62);
      let x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const r = Math.hypot(x, z);
      if (r > ARENA_RADIUS - 6) { const s = (ARENA_RADIUS - 8) / r; x *= s; z *= s; }
      if (ctx.worldId !== 'city' && terrainHeight(x, z) < WATER_LEVEL + 0.4 && tries < 18) continue;
      ctx.spawnEnemy(type, x, z);
      return;
    }
    ctx.spawnEnemy(type, p.x + 30, p.z + 30);
  }
}
