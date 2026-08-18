// Projektiler, explosioner och drops.
import { clamp, lerp, rand, TAU, angleDelta } from './math.js';
import { terrainHeight, WATER_LEVEL } from './noise.js';
import { CRIT_CAP } from './player.js';

/** Närmaste träffpunkt mellan en sträcka och en sfär — hindrar snabba skott från att missa. */
function segmentHitsSphere(px, py, pz, dx, dy, dz, len, cx, cy, cz, r) {
  const mx = cx - px, my = cy - py, mz = cz - pz;
  let t = mx * dx + my * dy + mz * dz;
  t = clamp(t, 0, len);
  const hx = px + dx * t - cx, hy = py + dy * t - cy, hz = pz + dz * t - cz;
  return hx * hx + hy * hy + hz * hz <= r * r;
}

export class Combat {
  constructor() {
    this.shots = [];
    this.bullets = [];
    this.pickups = [];
    this.patches = [];
  }

  reset() {
    this.shots.length = 0; this.bullets.length = 0;
    this.pickups.length = 0; this.patches.length = 0;
  }

  // ------------------------------------------------------------ svärdssving

  swordSwing(ctx) {
    const p = ctx.player, st = p.stats;
    // tre hugg i följd: det tredje är en finisher med överhandshugg
    p.combo = p.comboTimer > 0 ? (p.combo + 1) % 3 : 0;
    p.comboTimer = 1.5;
    const fin = p.combo === 2;

    p.swingSide = -(p.swingSide || 1);
    p.swingFinisher = fin;
    p.swingDur = fin ? 0.34 : 0.26;
    p.swingTime = p.swingDur;
    p.fireTimer = 1 / (st.fireRate * (fin ? 0.42 : 0.55));
    ctx.sound[fin ? 'finisher' : 'swing']();

    const range = (3.8 + st.multishot * 0.35) * (fin ? 1.25 : 1);
    const arc = (1.15 + st.multishot * 0.12) * (fin ? 1.3 : 1);   // halv svepvinkel
    p.aimDir(ctx.enemies);
    let hitAny = false;

    for (const e of ctx.enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + e.radius) continue;
      if (Math.abs(angleDelta(p.yaw, Math.atan2(dx, dz))) > arc) continue;
      if (Math.abs((e.pos.y + e.height * 0.5) - (p.pos.y + 1.3)) > e.height * 0.5 + 2.6) continue;

      const crit = Math.random() < Math.min(st.crit, CRIT_CAP) || fin;
      const dmg = st.damage * (fin ? 2.8 : 1.7) * (crit ? st.critMult : 1);
      const killed = e.damage(dmg + st.burn, ctx, crit);
      ctx.sound[crit ? 'swordCrit' : 'swordHit']();
      if (st.lifesteal > 0) p.heal(dmg * st.lifesteal);
      // rejäl knockback — svagare mot tunga fiender
      const kb = (fin ? 27 : 16) / (1 + e.radius);
      if (dist > 0.01) { e.vel.x += (dx / dist) * kb; e.vel.z += (dz / dist) * kb; }
      if (fin) { e.vel.y += 7; ctx.freeze(0.09); }
      e.slow = Math.max(e.slow, fin ? 0.7 : 0.3);
      if (st.explosive > 0) this.explode(ctx, e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, st.explosive, dmg * 0.4);
      if (killed) ctx.onEnemyKilled(e);
      hitAny = true;
    }

    /*
     * Svepet ritas som en sammanhängande båge i två lager: en tät, ljus kärna
     * längs eggens väg och ett glesare, mörkare sken utanför den. Tidigare låg
     * partiklarna på ett enda avstånd och drev utåt — det blev ett moln, inte
     * ett hugg. Nu följer de klingans radie, och varje punkt längs bågen föds
     * en aning senare än den förra så spåret sveper i huggets riktning.
     */
    const n = fin ? 30 : 18;
    const dir = p.swingSide > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const a = p.yaw + (f - 0.5) * arc * 2 * dir;
      for (let layer = 0; layer < 2; layer++) {
        const d = range * (layer ? 0.92 : 0.66);
        const sinA = Math.sin(a), cosA = Math.cos(a);
        ctx.particles.spawn({
          x: p.pos.x + sinA * d + rand(-0.12, 0.12),
          y: p.pos.y + 1.3 + (fin ? (f - 0.5) * 1.5 : (Math.random() - 0.5) * 0.35),
          z: p.pos.z + cosA * d + rand(-0.12, 0.12),
          // liten drift utåt, så bågen tunnas ut i stället för att bara slockna
          vx: sinA * (fin ? 5 : 2.2), vy: fin ? rand(0.5, 2.5) : 0.4, vz: cosA * (fin ? 5 : 2.2),
          life: (fin ? 0.34 : 0.2) * (layer ? 0.7 : 1) - f * 0.04,
          size: (fin ? 1.0 : 0.6) * (layer ? 0.7 : 1), size2: 0.04,
          col: fin ? [1.0, 0.78, 0.30]
            : layer ? [0.75, 0.85, 1.0]
              : hitAny ? [1.0, 0.9, 0.65] : [0.95, 0.98, 1.0],
          alpha: (fin ? 0.95 : 0.8) * (layer ? 0.45 : 1), drag: 0.6,
        });
      }
    }
    p.shake = Math.min(0.5, p.shake + (fin ? 0.3 : hitAny ? 0.08 : 0.03));
  }

  // -------------------------------------------------------------- eldhärdar

  /** Brinnande mark efter en eldboll — skadar fiender som står kvar i lågorna. */
  spawnFirePatch(ctx, x, z, radius, dmg) {
    if (this.patches.length > 7) this.patches.shift();
    this.patches.push({
      x, y: terrainHeight(x, z), z,
      r: radius, life: 4.5, max: 4.5, tick: 0, dmg,
    });
  }

  updatePatches(dt, ctx) {
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const q = this.patches[i];
      q.life -= dt;
      if (q.life <= 0) { this.patches.splice(i, 1); continue; }
      const fade = Math.min(1, q.life / 1.2);

      // lågor och glöd
      for (let k = 0; k < 3; k++) {
        const a = rand(TAU), d = Math.sqrt(Math.random()) * q.r;
        const px = q.x + Math.cos(a) * d, pz = q.z + Math.sin(a) * d;
        ctx.particles.spawn({
          x: px, y: terrainHeight(px, pz) + 0.1, z: pz,
          vx: rand(-0.5, 0.5), vy: rand(2.2, 4.5), vz: rand(-0.5, 0.5),
          life: rand(0.35, 0.7), size: rand(0.5, 1.0) * fade, size2: 0.05,
          col: [1.0, rand(0.35, 0.65), 0.12], alpha: 0.75 * fade, drag: 0.5,
        });
      }

      // skada var 0,35 s
      q.tick -= dt;
      if (q.tick <= 0) {
        q.tick = 0.35;
        for (const e of ctx.enemies) {
          if (!e.alive) continue;
          if (Math.hypot(e.pos.x - q.x, e.pos.z - q.z) > q.r + e.radius) continue;
          if (e.pos.y - q.y > 3.5) continue;
          if (e.damage(q.dmg, ctx, false)) ctx.onEnemyKilled(e);
        }
      }
    }
  }

  // ---------------------------------------------------------------- eldboll

  castFireball(ctx) {
    const p = ctx.player, st = p.stats;
    const dir = p.aimDir(ctx.enemies);
    const m = p.muzzle();
    const n = st.multishot;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * 0.22;
      const c = Math.cos(off), s = Math.sin(off);
      this.shots.push({
        x: m.x, y: m.y + 0.3, z: m.z,
        vx: (dir.x * c + dir.z * s) * st.projSpeed * 0.6,
        vy: dir.y * st.projSpeed * 0.6 + 2,
        vz: (-dir.x * s + dir.z * c) * st.projSpeed * 0.6,
        life: 2.6,
        dmg: st.damage * 3.2,
        crit: false,
        pierce: 0,
        radius: 0.95,
        explosive: 4.5 + st.explosive,
        hits: new Set(),
        fireball: true,
        col: [1.0, 0.55, 0.15],
      });
    }
    p.fireballCd = p.fireballCdMax;
    ctx.sound.fireball();
    p.shake = Math.min(0.6, p.shake + 0.25);
    ctx.particles.burst(m.x, m.y + 0.3, m.z, 10, {
      speed: 5, life: 0.3, size: 0.6, col: [1.0, 0.6, 0.2], alpha: 0.9, drag: 0.6,
    });
  }

  // ------------------------------------------------------------- spelarskott

  playerShoot(ctx) {
    const p = ctx.player, st = p.stats;
    const city = ctx.worldId === 'city';
    const dir = p.aimDir(ctx.enemies);
    const m = p.muzzle();
    const n = st.multishot;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * st.spread * (n + 1);
      const yawOff = off + rand(-st.spread * 0.5, st.spread * 0.5);
      const c = Math.cos(yawOff), s = Math.sin(yawOff);
      const dx = dir.x * c + dir.z * s;
      const dz = -dir.x * s + dir.z * c;
      const crit = Math.random() < Math.min(st.crit, CRIT_CAP);
      // Extra skott gör mindre — annars fördubblar ett enda kort din skada.
      const falloff = i === 0 ? 1 : 0.75;
      this.shots.push({
        x: m.x, y: m.y, z: m.z,
        vx: dx * st.projSpeed, vy: dir.y * st.projSpeed, vz: dz * st.projSpeed,
        life: 1.7,
        dmg: st.damage * falloff * (crit ? st.critMult : 1),
        crit,
        pierce: st.pierce,
        radius: st.projSize + 0.25,
        explosive: st.explosive,
        hits: new Set(),
        beam: city,
        col: crit ? [1.0, 0.85, 0.35] : city ? [1.0, 0.30, 0.42] : [0.45, 0.95, 1.0],
      });
    }
    ctx.sound[city ? 'laser' : 'shoot']();
    ctx.particles.burst(m.x, m.y, m.z, 4, {
      speed: 4, life: 0.16, size: 0.32,
      col: city ? [1.0, 0.5, 0.6] : [0.6, 0.95, 1.0], alpha: 0.9, drag: 0.7,
    });
    p.shotSide = -p.shotSide;
    p.fireTimer = 1 / st.fireRate;
    p.shake = Math.min(0.35, p.shake + 0.045);
  }

  droneShoot(ctx, x, y, z, target) {
    let dx = target.pos.x - x, dy = target.pos.y + target.height * 0.5 - y, dz = target.pos.z - z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    // drönaren skjuter en gnista, fén en trollformel — olika färg och ljud
    const fairy = ctx.worldId !== 'city';
    this.shots.push({
      x, y, z, vx: dx * 52, vy: dy * 52, vz: dz * 52,
      life: 1.5, dmg: ctx.player.stats.damage * 0.5, crit: false,
      pierce: 0, radius: 0.5, explosive: 0, hits: new Set(),
      col: fairy ? [0.7, 1.0, 0.8] : [1.0, 0.75, 0.25],
    });
    if (fairy) ctx.sound.tone({ f: 1250, f2: 1900, dur: 0.09, type: 'sine', vol: 0.045 });
    else ctx.sound.tone({ f: 900, f2: 420, dur: 0.06, type: 'triangle', vol: 0.05 });
  }

  /**
   * Slår tillbaka ett fiendeskott. Det blir spelarens projektil: dubbel skada,
   * riktad mot närmaste fiende. Missar man alla står den kvar och flyger dit
   * man tittade — en parering utan mål ska ändå kännas som en parering.
   */
  reflectBullet(ctx, b, index) {
    const p = ctx.player;
    let target = null, best = 60;
    for (const e of ctx.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - b.x, e.pos.z - b.z);
      if (d < best) { best = d; target = e; }
    }
    let dx, dy, dz;
    if (target) {
      dx = target.pos.x - b.x;
      dy = (target.pos.y + target.height * 0.5) - b.y;
      dz = target.pos.z - b.z;
    } else {
      const aim = p.aimDir(ctx.enemies);
      dx = aim.x; dy = aim.y; dz = aim.z;
    }
    const l = Math.hypot(dx, dy, dz) || 1;
    const speed = 70;
    this.shots.push({
      x: b.x, y: b.y, z: b.z,
      vx: (dx / l) * speed, vy: (dy / l) * speed, vz: (dz / l) * speed,
      life: 2.0, dmg: b.dmg * 2, crit: true,
      pierce: 1, radius: 0.7, explosive: 0, hits: new Set(),
      col: [1.0, 0.92, 0.55],
    });
    this.bullets.splice(index, 1);

    p.parryFlash = 1;
    ctx.freeze(0.07);
    ctx.sound.parry();
    ctx.particles.burst(b.x, b.y, b.z, 18, {
      speed: 11, life: 0.4, size: 0.6, size2: 0.05,
      col: [1.0, 0.95, 0.6], alpha: 1, drag: 0.7,
    });
  }

  // ------------------------------------------------------------ fiendeskott

  enemyBullet(e, target, speed, dmg) {
    let dx = target.pos.x - e.pos.x;
    let dy = (target.pos.y + 1.1) - (e.pos.y + e.height * 0.6);
    let dz = target.pos.z - e.pos.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.enemyBulletDir(e, dx / l, dy / l, dz / l, speed, dmg);
  }

  enemyBulletDir(e, dx, dy, dz, speed, dmg) {
    this.bullets.push({
      x: e.pos.x + dx * (e.radius + 0.4),
      y: e.pos.y + e.height * 0.6 + dy * 0.4,
      z: e.pos.z + dz * (e.radius + 0.4),
      vx: dx * speed, vy: dy * speed, vz: dz * speed,
      life: 4.5, dmg, radius: 0.45,
      col: e.boss ? [1.0, 0.35, 0.55] : [0.85, 0.45, 1.0],
    });
  }

  /**
   * Kastad projektil i båge — Jordvredets stenbumlingar. Kastvinkeln räknas
   * ut ur skottens gravitation (3.2 i update), så stenen landar där spelaren
   * stod när den kastades. Flytta dig, eller ta smällen.
   */
  enemyLob(e, target, hSpeed, dmg, size = 1.0) {
    const dx = target.pos.x - e.pos.x, dz = target.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const t = d / hSpeed;
    const dy = target.pos.y - (e.pos.y + e.height * 0.8);
    this.bullets.push({
      x: e.pos.x + (dx / d) * (e.radius + 0.6),
      y: e.pos.y + e.height * 0.8,
      z: e.pos.z + (dz / d) * (e.radius + 0.6),
      vx: (dx / d) * hSpeed,
      vy: dy / t + 0.5 * 3.2 * t,
      vz: (dz / d) * hSpeed,
      life: t + 2, dmg, radius: size, boom: true,
      col: [0.62, 0.58, 0.48],
    });
  }

  // -------------------------------------------------------------- explosion

  explode(ctx, x, y, z, radius, dmg, source) {
    ctx.sound.explode();
    ctx.freeze(0.07);
    ctx.particles.burst(x, y, z, 26, {
      speed: radius * 2.6, life: 0.5, size: 1.1, size2: 0.1,
      col: [1.0, 0.6, 0.2], alpha: 0.95, drag: 0.9, grav: -4,
    });
    ctx.particles.burst(x, y, z, 12, {
      speed: radius * 1.4, life: 0.7, size: 1.6, size2: 0.2,
      col: [0.4, 0.25, 0.2], alpha: 0.5, drag: 1.2, grav: 2,
    });
    for (const e of ctx.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.y + e.height * 0.5 - y, e.pos.z - z);
      if (d < radius + e.radius) {
        const falloff = 1 - clamp((d - e.radius) / radius, 0, 1);
        if (e.damage(dmg * (0.45 + falloff * 0.55), ctx, false)) ctx.onEnemyKilled(e);
      }
    }
    ctx.player.shake = Math.min(1.4, ctx.player.shake + 0.35);
  }

  /** Bossens markvåg — träffar bara spelaren. */
  shockwave(ctx, x, y, z, radius, dmg) {
    ctx.sound.explode();
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * TAU;
      ctx.particles.spawn({
        x, y: y + 0.4, z,
        vx: Math.cos(a) * radius * 1.5, vy: rand(1, 4), vz: Math.sin(a) * radius * 1.5,
        life: 0.65, size: 1.2, size2: 0.2, col: [1.0, 0.35, 0.45], alpha: 0.9, drag: 1.1, grav: -6,
      });
    }
    const d = Math.hypot(ctx.player.pos.x - x, ctx.player.pos.z - z);
    if (d < radius && Math.abs(ctx.player.pos.y - y) < 6) {
      if (ctx.player.takeDamage(dmg)) ctx.sound.hurt();
    }
    ctx.player.shake = Math.min(1.6, ctx.player.shake + 0.6);
  }

  // ------------------------------------------------------------------ drops

  dropLoot(ctx, e) {
    const orbs = e.boss ? 8 : e.xp > 10 ? 3 : 1;
    const each = Math.max(1, Math.round((e.xp / orbs) * ctx.player.stats.xpMult));
    for (let i = 0; i < orbs; i++) {
      const a = rand(TAU);
      this.pickups.push({
        kind: 'xp', value: each,
        x: e.pos.x + Math.cos(a) * rand(0, 1.2),
        y: e.pos.y + e.height * 0.5,
        z: e.pos.z + Math.sin(a) * rand(0, 1.2),
        vx: Math.cos(a) * rand(2, 6), vy: rand(4, 8), vz: Math.sin(a) * rand(2, 6),
        life: 26, phase: rand(TAU), col: [0.4, 1.0, 0.75],
      });
    }
    // Guld faller bara i äventyret — det är där det finns något att handla för.
    if (ctx.mode === 'adventure') {
      const a = rand(TAU);
      this.pickups.push({
        kind: 'gold', value: Math.max(1, Math.round(e.xp * 1.6 * (1 + ctx.adventure.level * 0.06))),
        x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z,
        vx: Math.cos(a) * rand(2, 5), vy: rand(4, 7), vz: Math.sin(a) * rand(2, 5),
        life: 30, phase: rand(TAU), col: [1.0, 0.82, 0.25],
      });
    }
    // Rustningsdelar: säkra från bossar och eliter, annars ett fynd bland många.
    if (ctx.mode === 'adventure' && (e.boss || e.elite || Math.random() < 0.06)) {
      this.pickups.push({
        kind: 'armor', value: e.boss ? 2 : 1,
        x: e.pos.x, y: e.pos.y + e.height * 0.6, z: e.pos.z,
        vx: rand(-2, 2), vy: rand(5, 8), vz: rand(-2, 2),
        life: 40, phase: rand(TAU), col: [0.72, 0.80, 0.95],
      });
    }
    if (e.boss || Math.random() < 0.07) {
      this.pickups.push({
        kind: 'hp', value: e.boss ? 60 : 25,
        x: e.pos.x, y: e.pos.y + 1, z: e.pos.z,
        vx: rand(-2, 2), vy: 6, vz: rand(-2, 2),
        life: 30, phase: rand(TAU), col: [1.0, 0.35, 0.45],
      });
    }
  }

  // ----------------------------------------------------------------- update

  update(dt, ctx) {
    const p = ctx.player;
    this.updatePatches(dt, ctx);

    // spelarens skott
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      const len = Math.hypot(s.vx, s.vy, s.vz) * dt;
      const dx = s.vx / (len / dt || 1), dy = s.vy / (len / dt || 1), dz = s.vz / (len / dt || 1);
      let removed = false;

      for (const e of ctx.enemies) {
        if (!e.alive || s.hits.has(e)) continue;
        if (segmentHitsSphere(s.x, s.y, s.z, dx, dy, dz, len,
          e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, e.radius + s.radius)) {
          s.hits.add(e);
          const killed = e.damage(s.dmg + (ctx.player.stats.burn || 0), ctx, s.crit);
          // eldbollen talar genom sin explosion, lasern knäpper elektriskt,
          // allt annat får den vanliga träffen
          if (!s.fireball) {
            ctx.sound[s.beam ? (s.crit ? 'laserCrit' : 'laserHit')
                             : (s.crit ? 'crit' : 'hit')]();
          }
          if (p.stats.lifesteal > 0) p.heal(s.dmg * p.stats.lifesteal);
          if (killed) ctx.onEnemyKilled(e);
          if (s.explosive > 0) {
            this.explode(ctx, s.x, s.y, s.z, s.explosive, s.dmg * 0.6);
            if (s.fireball) this.spawnFirePatch(ctx, s.x, s.z, s.explosive * 0.85, s.dmg * 0.09);
            removed = true;
            break;
          }
          if (s.pierce-- <= 0) { removed = true; break; }
        }
      }
      if (removed) { this.shots.splice(i, 1); continue; }

      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.life <= 0 || s.y < terrainHeight(s.x, s.z) - 0.2) {
        if (s.explosive > 0 && s.life > 0) {
          this.explode(ctx, s.x, s.y, s.z, s.explosive, s.dmg * 0.6);
          if (s.fireball) this.spawnFirePatch(ctx, s.x, s.z, s.explosive * 0.85, s.dmg * 0.09);
        } else ctx.particles.burst(s.x, s.y, s.z, 4,
          { speed: 3, life: 0.2, size: 0.3, col: s.col, alpha: 0.8, drag: 0.8 });
        this.shots.splice(i, 1);
        continue;
      }
      ctx.particles.spawn({
        x: s.x, y: s.y, z: s.z, life: 0.14, size: s.radius * 1.1, size2: 0,
        col: s.col, alpha: 0.65, drag: 0.2,
      });
    }

    // fiendens skott
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.vy -= 3.2 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      /*
       * Parering: under det öppna fönstret slås inkommande skott tillbaka mot
       * den närmaste fienden i stället för att träffa. Räckvidden är generös
       * (3,4 m) och gäller runtom, inte bara framåt — pareringen ska belöna
       * tajming, inte kräva att man dessutom står vänd åt rätt håll.
       */
      if (p.parryTime > 0 && !b.parried) {
        const pd = Math.hypot(b.x - p.pos.x, b.y - (p.pos.y + 1.1), b.z - p.pos.z);
        if (pd < 3.4) { this.reflectBullet(ctx, b, i); continue; }
      }
      const hitPlayer = Math.hypot(b.x - p.pos.x, b.y - (p.pos.y + 1.1), b.z - p.pos.z) < b.radius + p.radius + 0.35;
      if (hitPlayer) {
        if (p.takeDamage(b.dmg)) {
          ctx.sound.hurt();
          ctx.particles.burst(b.x, b.y, b.z, 10,
            { speed: 5, life: 0.35, size: 0.45, col: b.col, alpha: 0.9, drag: 0.6 });
        }
        this.bullets.splice(i, 1);
        continue;
      }
      if (b.life <= 0 || b.y < terrainHeight(b.x, b.z) - 0.3) {
        // stenbumlingen slår ner med en markstöt — även en miss är farlig nära
        if (b.boom) this.shockwave(ctx, b.x, b.y, b.z, 4.5, b.dmg * 0.7);
        ctx.particles.burst(b.x, b.y, b.z, b.boom ? 14 : 5,
          { speed: b.boom ? 7 : 3, life: 0.25, size: b.boom ? 0.6 : 0.35, col: b.col, alpha: 0.7, drag: 0.8 });
        this.bullets.splice(i, 1);
        continue;
      }
      ctx.particles.spawn({
        x: b.x, y: b.y, z: b.z, life: 0.16, size: 0.4, size2: 0,
        col: b.col, alpha: 0.5, drag: 0.2,
      });
    }

    // upplockningar
    const magnet = p.stats.pickupRadius;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const q = this.pickups[i];
      q.life -= dt;
      q.phase += dt * 3;
      const dx = p.pos.x - q.x, dy = (p.pos.y + 1) - q.y, dz = p.pos.z - q.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < magnet) {
        const pull = lerp(26, 64, 1 - d / magnet) * dt;
        q.vx += (dx / d) * pull; q.vy += (dy / d) * pull; q.vz += (dz / d) * pull;
      } else {
        q.vy -= 24 * dt;
      }
      const fr = Math.exp(-1.6 * dt);
      q.vx *= fr; q.vz *= fr;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const gh = Math.max(terrainHeight(q.x, q.z), WATER_LEVEL) + 0.5;
      if (q.y < gh) { q.y = gh; q.vy = Math.abs(q.vy) * 0.35; }

      if (d < 1.5) {
        if (q.kind === 'xp') { ctx.addXP(q.value); ctx.sound.pickup(); }
        else if (q.kind === 'gold') { ctx.addGold(q.value); ctx.sound.coin(); }
        else if (q.kind === 'armor') { ctx.addArmor(q.value); }
        else { p.heal(q.value); ctx.sound.heal(); ctx.toast(`+${q.value} HP`); }
        ctx.particles.burst(q.x, q.y, q.z, 6,
          { speed: 3, life: 0.3, size: 0.35, col: q.col, alpha: 0.9, drag: 0.7 });
        this.pickups.splice(i, 1);
        continue;
      }
      if (q.life <= 0) this.pickups.splice(i, 1);
    }
  }

  draw(rend, time) {
    const B = rend.dyn;
    for (const s of this.shots) {
      if (s.fireball) {
        // eldboll: pulserande klot med eldsvans
        const pulse = 1 + Math.sin(time * 26) * 0.12;
        B.sphere.push(s.x, s.y, s.z, s.radius * 2.2 * pulse, s.radius * 2.2 * pulse,
          s.radius * 2.2 * pulse, s.col, 0, time * 8, 0, 1.4);
        B.octa.push(s.x, s.y, s.z, s.radius * 1.4, s.radius * 2.0, s.radius * 1.4,
          [1.0, 0.85, 0.4], 0, -time * 10, 0, 1.2);
        rend.particles.spawn({
          x: s.x + rand(-0.3, 0.3), y: s.y + rand(-0.3, 0.3), z: s.z + rand(-0.3, 0.3),
          vx: -s.vx * 0.06, vy: -s.vy * 0.06 + 1.5, vz: -s.vz * 0.06,
          life: rand(0.3, 0.55), size: rand(0.6, 1.0), size2: 0.1,
          col: [1.0, rand(0.35, 0.6), 0.12], alpha: 0.9, drag: 0.4,
        });
        continue;
      }
      if (s.beam) {
        // laserstråle: oktaedern sträcks ut längs färdriktningen
        const sp = Math.hypot(s.vx, s.vy, s.vz) || 1;
        const yawD = Math.atan2(s.vx, s.vz);
        const pitchD = Math.asin(s.vy / sp) + Math.PI / 2;
        B.octa.push(s.x, s.y, s.z, s.radius * 0.55, 1.5, s.radius * 0.55, s.col,
          pitchD, yawD, 0, 1.5);
      } else {
        B.octa.push(s.x, s.y, s.z, s.radius * 1.5, s.radius * 2.4, s.radius * 1.5, s.col,
          0, time * 12, time * 6, 1.3);
      }
    }
    for (const b of this.bullets) {
      // hitboxen styr storleken, så en stenbumling ser ut som en
      const bs = (b.radius || 0.45) * 1.65;
      B.sphere.push(b.x, b.y, b.z, bs, bs, bs, b.col, 0, 0, 0, b.boom ? 0.35 : 1.2);
    }
    for (const q of this.pickups) {
      const s = q.kind === 'xp' ? 0.55 : q.kind === 'gold' ? 0.5 : 0.9;
      const lift = Math.sin(q.phase) * 0.12;
      // rustningsdelen är en plåt, inte ett klot — den ska synas för vad den är
      if (q.kind === 'armor') {
        B.box.push(q.x, q.y + lift, q.z, 0.42, 0.5, 0.14, q.col, 0.2, q.phase * 0.6, 0, 0.9);
      } else {
        B.octa.push(q.x, q.y + lift, q.z, s, s * 1.5, s, q.col, 0, q.phase, 0, 1.1);
      }
      rend.particles.spawn({
        x: q.x, y: q.y + lift, z: q.z, life: 0.2, size: s * 1.6, size2: 0,
        col: q.col, alpha: 0.35, drag: 0.1,
      });
    }
  }
}
