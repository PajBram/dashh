// All DOM-baserad UI: HUD-siffror, banderoller, radar, menyer.
import { clamp } from './math.js';
import { ARENA_RADIUS } from './noise.js';
import { WARES, REPAIR, priceOf, repairPrice } from './shop.js';

const $ = (id) => document.getElementById(id);

export const VERSION = 'BETA 0.9';

const DOT_COL = {
  grunt: '#ff5b5b', spitter: '#c07bff', charger: '#ffab3d',
  tank: '#4ce0a8', boss: '#ff3d7f',
  drone: '#ffd93d', sniper: '#4dffc3', hover: '#8f9bff',
  vildboss: '#ff3d7f', cityboss: '#ff3d7f',
};

export class HUD {
  constructor() {
    this.hud = $('hud');
    this.overlay = $('overlay');
    this.hpFill = $('hpFill');
    this.hpText = $('hpText');
    this.armTag = $('armTag');
    this.xpFill = $('xpFill');
    this.dashRow = $('dashRow');
    this.banner = $('banner');
    this.vignette = $('vignette');
    this.bossBar = $('bossBar');
    this.bossFill = $('bossFill');
    this.bossName = $('bossName');
    this.toasts = $('toasts');
    this.fireRow = $('fireRow');
    this.fireFill = $('fireFill');
    this.comboRow = $('comboRow');
    this.comboPips = [...this.comboRow.children];
    this.cross = $('crosshair');
    this.initFloaters();
    this.stick = $('stick');
    this.knob = $('knob');
    this.tFire = $('tFire');
    this.objective = $('objective');
    this.objLabel = $('objLabel');
    this.objValue = $('objValue');
    this.map = $('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.bannerT = 0;
    this.dashPips = [];
    this.lastFps = 0;
  }

  showHUD(on) { this.hud.classList.toggle('hidden', !on); }

  /** Toppraden heter olika saker i de två spelsätten. */
  setMode(mode) {
    const adv = mode === 'adventure';
    $('waveLbl').textContent = adv ? 'LEVEL' : 'WAVE';
    $('levelLbl').textContent = adv ? 'RANK' : 'LEVEL';
    $('goldStat').classList.toggle('hidden', !adv);   // guld finns bara i äventyret
  }

  // ------------------------------------------------------- skadesiffror

  initFloaters() {
    this.fltRoot = $('floaters');
    this.flts = [];
    for (let i = 0; i < 22; i++) {
      const el = document.createElement('div');
      el.className = 'flt';
      this.fltRoot.appendChild(el);
      this.flts.push({ el, life: 0, max: 1, x: 0, y: 0, z: 0, drift: 0, key: null, total: 0 });
    }
    this.fltNext = 0;
  }

  clearFloaters() {
    if (!this.flts) return;
    for (const f of this.flts) { f.life = 0; f.key = null; f.el.style.opacity = '0'; }
  }

  /**
   * Snabba träffar på samma fiende räknas ihop till en siffra som tickar upp,
   * i stället för en hög med överlappande tal.
   */
  floater(x, y, z, amount, crit, key) {
    let f = key ? this.flts.find((q) => q.key === key && q.life > 0) : null;
    if (f) {
      f.total += amount;
      f.life = Math.max(f.life, f.max * 0.75);
      if (crit) f.crit = true;
    } else {
      f = this.flts[this.fltNext];
      this.fltNext = (this.fltNext + 1) % this.flts.length;
      f.key = key || null;
      f.total = amount;
      f.crit = !!crit;
      f.life = f.max = 0.85;
      f.drift = (Math.random() - 0.5) * 70;
      f.rise = 40 + Math.random() * 26;
    }
    f.x = x; f.y = y; f.z = z;
    f.el.textContent = String(Math.round(f.total));
    f.el.className = `flt ${f.crit ? 'crit' : 'norm'}`;
  }

  /** Projicerar siffrorna från världen till skärmen. */
  updateFloaters(dt, g) {
    const vp = g.renderer.vp;
    const W = innerWidth, H = innerHeight;
    for (const f of this.flts) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.el.style.opacity = '0'; f.key = null; continue; }
      const t = 1 - f.life / f.max;
      const cw = vp[3] * f.x + vp[7] * f.y + vp[11] * f.z + vp[15];
      if (cw <= 0.01) { f.el.style.opacity = '0'; continue; }
      const sx = ((vp[0] * f.x + vp[4] * f.y + vp[8] * f.z + vp[12]) / cw * 0.5 + 0.5) * W;
      const sy = (1 - ((vp[1] * f.x + vp[5] * f.y + vp[9] * f.z + vp[13]) / cw * 0.5 + 0.5)) * H;
      const rise = t * (f.rise || 46);
      const pop = t < 0.18 ? 1 + (0.18 - t) * 2.2 : 1;
      f.el.style.transform =
        `translate(${(sx + f.drift * t - 14).toFixed(1)}px, ${(sy - rise).toFixed(1)}px) scale(${pop.toFixed(2)})`;
      f.el.style.opacity = String(Math.min(1, (1 - t) * 2.2));
    }
  }

  hideOverlay() { this.overlay.classList.add('hidden'); }
  showOverlay(html) {
    this.overlay.innerHTML = html;
    this.overlay.classList.remove('hidden');
  }

  setDashPips(n) {
    if (this.dashPips.length === n) return;
    this.dashRow.innerHTML = '';
    this.dashPips = [];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'pip';
      this.dashRow.appendChild(d);
      this.dashPips.push(d);
    }
  }

  toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    this.toasts.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 420);
    }, 2600);
  }

  showBanner(text, sub = '', time = 2.2) {
    this.banner.innerHTML = text + (sub ? `<span class="sub">${sub}</span>` : '');
    this.bannerT = time;
  }

  setBoss(e, name) {
    this.boss = e;
    if (name) this.bossName.textContent = name;
    this.bossBar.classList.toggle('hidden', !e);
  }

  /** Uppdragsraden: vad nivån kräver och hur långt det gått. */
  setObjective(mission) {
    const on = !!mission;
    this.objective.classList.toggle('hidden', !on);
    this.hud.classList.toggle('obj', on);
    if (!on) return;
    if (this.objLabel.textContent !== mission.label) this.objLabel.textContent = mission.label;
    const v = mission.status;
    if (this.objValue.textContent !== v) this.objValue.textContent = v;
    this.objective.classList.toggle('done', mission.done);
  }

  /** Uppdaterar allt som ändras varje bildruta. */
  update(g, dt) {
    const p = g.player;

    // Korshåret sitter där muspekaren är (utan muslås), annars i mitten.
    const inp = g.input;
    const free = inp && !inp.locked && !inp.touch;

    if (inp && inp.touch) {
      // spaken ritas där tummen landade
      this.stick.classList.toggle('on', inp.stickActive);
      if (inp.stickActive) {
        this.stick.style.left = `${inp.stickBase.x}px`;
        this.stick.style.top = `${inp.stickBase.y}px`;
        this.knob.style.transform = `translate(${inp.stickVec.x * 38}px, ${inp.stickVec.y * 38}px)`;
      }
      const wild = g.worldId === 'wild';
      this.tFire.classList.toggle('hidden', !wild);
      if (wild) this.tFire.classList.toggle('cool', p.fireballCd > 0);
    }
    const cx = free ? (inp.cursorNX * 0.5 + 0.5) * 100 : 50;
    const cy = free ? (inp.cursorNY * 0.5 + 0.5) * 100 : 50;
    this.cross.style.left = `${cx}%`;
    this.cross.style.top = `${cy}%`;
    // bara ett sikte på skärmen: göm systempekaren under spelets gång
    const want = g.state === 'playing' && free ? 'none' : 'crosshair';
    if (this._cursor !== want) { this._cursor = want; g.canvas.style.cursor = want; }
    const arm = p.armor | 0;
    this.armTag.classList.toggle('hidden', arm <= 0);
    if (arm > 0) {
      const cut = Math.round((1 - 1 / (1 + arm * 0.06)) * 100);
      this.armTag.textContent = `🪖 ${arm} · −${cut}%`;
    }

    const hpFrac = clamp(p.hp / p.stats.maxHp, 0, 1);
    this.hpFill.style.transform = `scaleX(${hpFrac})`;
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${Math.round(p.stats.maxHp)}`;
    this.xpFill.style.transform = `scaleX(${clamp(g.xp / g.xpNeeded, 0, 1)})`;

    this.setDashPips(p.stats.dashMax);
    for (let i = 0; i < this.dashPips.length; i++) {
      const on = i < p.dashCharges;
      this.dashPips[i].classList.toggle('on', on);
      if (!on && i === p.dashCharges) {
        const f = p.dashTimer / p.stats.dashRecharge;
        this.dashPips[i].style.background =
          `linear-gradient(90deg, rgba(77,243,255,.75) ${f * 100}%, rgba(255,255,255,.13) ${f * 100}%)`;
      } else {
        this.dashPips[i].style.background = '';
      }
    }

    // eldboll + svärdskombo (bara Vildheim)
    if (g.worldId === 'wild') {
      this.fireRow.classList.remove('hidden');
      const frac = 1 - clamp(p.fireballCd / p.fireballCdMax, 0, 1);
      this.fireFill.style.transform = `scaleX(${frac})`;
      this.fireRow.classList.toggle('ready', frac >= 1);

      this.comboRow.classList.remove('hidden');
      const hits = p.comboTimer > 0 ? p.combo + 1 : 0;
      for (let i = 0; i < 3; i++) {
        const lit = i < hits;
        this.comboPips[i].classList.toggle('lit', lit && !(hits === 2 && i === 2));
        // tredje pricken pulsar guld när nästa hugg blir en finisher
        this.comboPips[i].classList.toggle('next', i === 2 && hits === 2);
      }
    } else {
      this.fireRow.classList.add('hidden');
      this.comboRow.classList.add('hidden');
    }

    this.setObjective(g.mode === 'adventure' ? g.adventure.mission : null);

    $('waveNum').textContent = g.mode === 'adventure'
      ? (g.adventure.level || '—')
      : (g.waves.wave || '—');
    $('levelNum').textContent = g.level;
    if (g.mode === 'adventure') $('goldNum').textContent = g.gold;
    $('killNum').textContent = g.kills;
    const t = Math.floor(g.elapsed);
    $('timeNum').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (g.frameCount % 15 === 0) $('fpsNum').textContent = Math.round(g.fps);

    this.vignette.style.opacity = String(clamp(p.hitFlash * 0.8 + (1 - hpFrac) * 0.35, 0, 1));

    if (this.bannerT > 0) {
      this.bannerT -= dt;
      const a = clamp(this.bannerT > 1.6 ? (2.2 - this.bannerT) / 0.6 : this.bannerT / 1.0, 0, 1);
      this.banner.style.opacity = String(a);
      this.banner.style.transform = `translate(-50%,-50%) scale(${1 + (1 - a) * 0.06})`;
    } else if (this.banner.style.opacity !== '0') {
      this.banner.style.opacity = '0';
    }

    if (this.boss && this.boss.alive) {
      this.bossFill.style.transform = `scaleX(${clamp(this.boss.hp / this.boss.maxHp, 0, 1)})`;
    } else if (this.boss) {
      this.setBoss(null);
    }

    this.updateFloaters(dt, g);
    this.drawMinimap(g);
  }

  drawMinimap(g) {
    const c = this.mapCtx, S = this.map.width, R = S / 2;
    const range = 82;
    const p = g.player;
    const yaw = p.camYaw;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);

    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.clip();
    c.fillStyle = 'rgba(4,10,20,.55)';
    c.fillRect(0, 0, S, S);

    // arenagräns
    const scale = R / range;
    const pr = Math.hypot(p.pos.x, p.pos.z);
    c.strokeStyle = 'rgba(77,243,255,.25)';
    c.lineWidth = 3;
    c.beginPath();
    const relx = -p.pos.x, relz = -p.pos.z;
    const mx = (-cos * relx + sin * relz) * scale + R;
    const my = -(sin * relx + cos * relz) * scale + R;
    c.arc(mx, my, ARENA_RADIUS * scale, 0, Math.PI * 2);
    c.stroke();

    const plot = (wx, wz) => {
      const rx = wx - p.pos.x, rz = wz - p.pos.z;
      return [(-cos * rx + sin * rz) * scale + R, -(sin * rx + cos * rz) * scale + R];
    };

    c.globalAlpha = 0.85;
    for (const q of g.combat.pickups) {
      const [x, y] = plot(q.x, q.z);
      c.fillStyle = q.kind === 'xp' ? '#4dffa6' : '#ff5b7f';
      c.fillRect(x - 2, y - 2, 4, 4);
    }
    const adv = g.mode === 'adventure';
    for (const e of g.enemies) {
      if (!e.alive) continue;
      let [x, y] = plot(e.pos.x, e.pos.z);
      let r = e.boss ? 9 : e.type === 'tank' ? 6 : 4.5;
      const off = Math.hypot(x - R, y - R);
      if (off > R - 6) {
        // I äventyret måste man kunna hitta monstren: det som ligger utanför
        // radarns räckvidd fästs som en liten prick vid kanten i rätt riktning.
        if (!adv) continue;
        const s = (R - 7) / off;
        x = R + (x - R) * s; y = R + (y - R) * s;
        r = e.boss ? 5 : 2.6;
      }
      c.fillStyle = DOT_COL[e.type] || '#fff';
      // vakter som ännu inte upptäckt dig ligger blekare på radarn
      c.globalAlpha = e.guard ? 0.4 : 0.85;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // Uppdragsmålen: romber som alltid syns, även utanför radarns räckvidd.
    // Utan dem blir "hitta tre kraftkärnor" bara irrande.
    const marks = adv && g.adventure.mission ? g.adventure.mission.markers() : [];
    for (const m of marks) {
      let [x, y] = plot(m.x, m.z);
      const off = Math.hypot(x - R, y - R);
      let s = 5;
      if (off > R - 8) {
        const k = (R - 9) / off;
        x = R + (x - R) * k; y = R + (y - R) * k;
        s = 3.5;
      }
      c.save();
      c.translate(x, y);
      c.rotate(Math.PI / 4);
      c.fillStyle = m.col;
      c.shadowColor = m.col;
      c.shadowBlur = 6;
      c.fillRect(-s, -s, s * 2, s * 2);
      c.restore();
    }

    // spelaren + blickriktning
    c.fillStyle = '#eaf6ff';
    c.beginPath();
    c.moveTo(R, R - 9); c.lineTo(R - 6, R + 7); c.lineTo(R + 6, R + 7);
    c.closePath(); c.fill();
    c.restore();

    c.strokeStyle = 'rgba(77,243,255,.35)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.stroke();
  }

  // ------------------------------------------------------------- menyskärmar

  /** Första skärmen: vilket spelsätt? */
  showModes(onPick) {
    this._cursor = null;
    this.showOverlay(`
      <div class="screen">
        <div class="title">DASHH</div>
        <div class="subtitle">VOIDFALL<span class="betaTag">${VERSION}</span></div>
        <div class="betaNote">early build — expect bugs and rough edges, and do tell me about them</div>
        <div class="modes">
          <div class="mode surv" data-m="survival">
            <div class="wIcon">🌊</div>
            <div class="wName">SURVIVAL</div>
            <div class="wDesc">One arena, wave after wave, a boss every fifth.
              It ends only one way — the question is how far you got.</div>
            <div class="wTag">ONE LONG BREATH</div>
          </div>
          <div class="mode adv" data-m="adventure">
            <div class="wIcon">🗺️</div>
            <div class="wName">ADVENTURE</div>
            <div class="wDesc">Level after level on maps of their own. The monsters are
              out there waiting — go and find them. A boss every third level.</div>
            <div class="wTag">NEW · GROWING</div>
          </div>
        </div>
        <div class="hint">choose how to play</div>
      </div>`);
    this.overlay.querySelectorAll('.mode').forEach((el) => {
      el.addEventListener('click', () => onPick(el.dataset.m));
    });
  }

  showStart(onPick, touch, mode = 'survival', onBack = null, checkpoint = null, onResume = null) {
    this._cursor = null;
    const keys = touch ? `
          <div class="key"><b>LEFT HALF</b> Stick — move</div>
          <div class="key"><b>RIGHT HALF</b> Drag — aim</div>
          <div class="key"><b>ATK</b> Attack</div>
          <div class="key"><b>DASH</b> Dash · invulnerable</div>
          <div class="key"><b>▲</b> Jump · hold to fly</div>
          <div class="key"><b>🔥</b> Fireball (Vildheim)</div>` : `
          <div class="key"><b>WASD</b> Move</div>
          <div class="key"><b>MOUSE</b> Aim · to the edge sweeps the view</div>
          <div class="key"><b>LEFT CLICK</b> Attack</div>
          <div class="key"><b>C</b> Fireball (Vildheim)</div>
          <div class="key"><b>SHIFT</b> Dash</div>
          <div class="key"><b>SPACE</b> Jump / fly</div>
          <div class="key"><b>ESC</b> Pause</div>`;
    const adv = mode === 'adventure';
    this.showOverlay(`
      <div class="screen">
        <div class="title">DASHH</div>
        <div class="subtitle">${adv ? 'ADVENTURE' : 'SURVIVAL'}<span class="betaTag">${VERSION}</span></div>
        <div class="betaNote">early build — expect bugs and rough edges, and do tell me about them</div>
        ${checkpoint ? `
        <div class="resume">
          <button class="cta" id="btnResume">CONTINUE — LEVEL ${checkpoint.level + 1}</button>
          <div class="hint">${checkpoint.world === 'city' ? 'Neotropolis' : 'Vildheim'} ·
            checkpoint at level ${checkpoint.level} · ${checkpoint.gold} gold ·
            armour ${checkpoint.armor || 0}</div>
        </div>` : ''}
        <div class="worlds">
          <div class="world wild" data-w="wild">
            <div class="wIcon">🌲</div>
            <div class="wName">VILDHEIM</div>
            <div class="wDesc">Green wilderness of forests, lakes and mountains.
              A warrior in leather with a sword — and fireballs on <b>C</b>.</div>
            <div class="wTag">SWORD · C = FIREBALL</div>
          </div>
          <div class="world city" data-w="city">
            <div class="wIcon">🌆</div>
            <div class="wName">NEOTROPOLIS</div>
            <div class="wDesc">A neon city in endless night. Fly between the towers as a
              cyborg and burn the machines down with lasers from your palms.</div>
            <div class="wTag">HOLD SPACE = FLY</div>
          </div>
        </div>
        <div class="keys">${keys}</div>
        <div class="hint">${checkpoint
          ? 'picking a world starts a new adventure — your checkpoint keeps until you reach another'
          : `choose your world — ${adv ? 'you stay in it for the whole adventure' : 'outlast the waves'}`}</div>
        ${onBack ? '<div class="hint back" id="btnBack">← back to game modes</div>' : ''}
      </div>`);
    this.overlay.querySelectorAll('.world').forEach((el) => {
      el.addEventListener('click', () => onPick(el.dataset.w));
    });
    if (onBack) $('btnBack').addEventListener('click', onBack);
    if (checkpoint && onResume) $('btnResume').addEventListener('click', onResume);
  }

  /** Uppdraget gick förlorat — samma nivå görs om. */
  showFailed(g, mission, onRetry) {
    this.showOverlay(`
      <div class="screen">
        <div class="goTitle" style="font-size:clamp(34px,7vw,64px)">MISSION FAILED</div>
        <div class="hint" style="margin:10px 0 0">${mission ? mission.title : ''}</div>
        <div class="results">
          <div class="result"><div class="rl">LEVEL</div><div class="rv">${g.adventure.level}</div></div>
          <div class="result"><div class="rl">KILLS</div><div class="rv">${g.kills}</div></div>
        </div>
        <button class="cta" id="btnRetry">TRY AGAIN</button>
        <div class="hint">the level restarts — you keep everything you earned</div>
      </div>`);
    $('btnRetry').addEventListener('click', onRetry);
  }

  /**
   * Shoppen mellan två nivåer. Varorna man inte har råd med syns ändå —
   * man ska kunna se vad man sparar till.
   */
  showShop(g, onBuy, onContinue) {
    const next = g.adventure.level + 1;
    const boss = g.adventure.isBossLevel(next);
    const p = g.player;

    const rep = repairPrice(p);
    const cards = WARES.map((w) => {
      const owned = g.shopLevels.get(w.id) || 0;
      const sold = owned >= w.max;
      const cost = priceOf(w, owned);
      const afford = !sold && cost <= g.gold;
      return `
        <div class="ware ${sold ? 'sold' : afford ? '' : 'poor'}" data-id="${w.id}">
          <div class="icon">${w.icon}</div>
          <div class="name">${w.name}</div>
          <div class="desc">${w.desc}</div>
          ${owned ? `<div class="own">×${owned}</div>` : ''}
          <div class="price">${sold ? 'SOLD OUT' : `${cost} <i>⬤</i>`}</div>
        </div>`;
    }).join('') + `
        <div class="ware ${rep && rep <= g.gold ? '' : 'poor'}" data-id="${REPAIR.id}">
          <div class="icon">${REPAIR.icon}</div>
          <div class="name">${REPAIR.name}</div>
          <div class="desc">${REPAIR.desc}</div>
          <div class="price">${rep ? `${rep} <i>⬤</i>` : 'FULL'}</div>
        </div>`;

    this.showOverlay(`
      <div class="screen shop">
        <div class="lvlTitle">LEVEL ${g.adventure.level} CLEARED${g.levelReward ? ` · +${g.levelReward} GOLD` : ''}</div>
        <div class="lvlSub">SHOP</div>
        <div class="purse">GOLD <b>${g.gold}</b></div>
        <div class="wares">${cards}</div>
        <button class="cta" id="btnNext">${boss ? `ONWARD — LEVEL ${next}: BOSS` : `ONWARD — LEVEL ${next}`}</button>
        <div class="hint">click to buy · each one you own raises the price</div>
      </div>`);
    this.overlay.querySelectorAll('.ware').forEach((el) => {
      el.addEventListener('click', () => onBuy(el.dataset.id));
    });
    $('btnNext').addEventListener('click', onContinue);
  }

  showLevelUp(level, choices, onPick) {
    const cards = choices.map((u, i) => `
      <div class="card" data-i="${i}">
        <div class="num">${i + 1}</div>
        <div class="icon">${u.icon}</div>
        <div class="name">${u.name}</div>
        <div class="desc">${u.desc}</div>
      </div>`).join('');
    this.showOverlay(`
      <div class="screen">
        <div class="lvlTitle">LEVEL ${level}</div>
        <div class="lvlSub">CHOOSE AN UPGRADE</div>
        <div class="cards">${cards}</div>
        <div class="hint">click, or press 1 · 2 · 3</div>
      </div>`);
    this.overlay.querySelectorAll('.card').forEach((el) => {
      el.addEventListener('click', () => onPick(+el.dataset.i));
    });
  }

  showPause(onResume) {
    this.showOverlay(`
      <div class="screen">
        <div class="title" style="font-size:clamp(40px,8vw,84px)">PAUSED</div>
        <button class="cta" id="btnResume">RESUME</button>
        <div class="hint">esc or click to go back in</div>
      </div>`);
    $('btnResume').addEventListener('click', onResume);
  }

  showGameOver(g, onRestart, onMenu, checkpoint = null) {
    const t = Math.floor(g.elapsed);
    const adv = g.mode === 'adventure';
    const best = adv
      ? `best so far: level ${g.best.stage} · ${g.best.kills} kills`
      : `best so far: wave ${g.best.wave} · ${g.best.kills} kills`;
    this.showOverlay(`
      <div class="screen">
        <div class="goTitle">YOU FELL</div>
        <div class="hint" style="margin:4px 0 0">${g.worldId === 'city' ? 'NEOTROPOLIS' : 'VILDHEIM'}
          · ${adv ? 'ADVENTURE' : 'SURVIVAL'}</div>
        <div class="results">
          <div class="result"><div class="rl">${adv ? 'LEVEL' : 'WAVE'}</div>
            <div class="rv">${adv ? g.adventure.level : g.waves.wave}</div></div>
          <div class="result"><div class="rl">${adv ? 'RANK' : 'LEVEL'}</div><div class="rv">${g.level}</div></div>
          <div class="result"><div class="rl">KILLS</div><div class="rv">${g.kills}</div></div>
          ${adv ? `<div class="result"><div class="rl">GOLD</div><div class="rv">${g.goldEarned}</div></div>` : ''}
          <div class="result"><div class="rl">TIME</div><div class="rv">${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</div></div>
          <div class="result"><div class="rl">DAMAGE</div><div class="rv">${Math.round(g.damageDealt)}</div></div>
        </div>
        <button class="cta" id="btnRestart">${checkpoint
          ? `CONTINUE — LEVEL ${checkpoint.level + 1}` : 'PLAY AGAIN'}</button>
        <button class="cta alt" id="btnMenu">MAIN MENU</button>
        <div class="hint">${checkpoint
          ? `you return to the checkpoint at level ${checkpoint.level}, with everything you had there`
          : best}</div>
      </div>`);
    $('btnRestart').addEventListener('click', onRestart);
    $('btnMenu').addEventListener('click', onMenu);
  }
}
