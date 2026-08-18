// Uppgraderingskorten som erbjuds vid varje nivå-upp.
//
// TVÅ SAKER ATT VETA INNAN DU ÄNDRAR HÄR:
//
// 1. Korten är ADDITIVA, inte multiplikativa. Ett skadekort lägger till
//    `damageBonus`, och den effektiva skadan räknas som bas × (1 + bonus).
//    Tidigare gjorde varje kort `damage *= 1.25`, och åtta staplade kort blev
//    då ×6 — gånger eldhastighet gånger splitterskott blev spelaren 200 gånger
//    starkare medan fienderna växte 13. Additivt blir samma åtta kort ×2,6,
//    och kurvorna kan följas åt. Skriv aldrig `st.damage *= n` igen.
//
// 2. Korten är delade i en gemensam grund och en gren per värld. Grunden
//    (hälsa, fart, skada) passar båda; grenen speglar hur man slåss —
//    fé och eldmagi i Vildheim, drönare och laser i Neotropolis. Ett kort
//    med `world` erbjuds bara i den världen.

/** Räknar om effektiva värden ur bas + bonus. Anropa efter varje ändring. */
export function recalc(st) {
  st.damage = st.damageBase * (1 + st.damageBonus);
  st.fireRate = st.fireRateBase * (1 + st.fireRateBonus);
  st.speed = st.speedBase * (1 + st.speedBonus);
}

const CORE = [
  { id: 'dmg', name: 'OVERCHARGE', icon: '⚡', max: 8,
    desc: '+20% damage',
    apply: (st) => { st.damageBonus += 0.20; } },

  { id: 'rate', name: 'RAPID FIRE', icon: '🔥', max: 6,
    desc: '+15% attack speed',
    apply: (st) => { st.fireRateBonus += 0.15; } },

  { id: 'hp', name: 'PLATING', icon: '🛡️', max: 6,
    desc: '+20 max HP, heals 20',
    apply: (st, p) => { st.maxHp += 20; p.heal(20); } },

  { id: 'speed', name: 'SERVO LEGS', icon: '🥾', max: 5,
    desc: '+10% movement speed',
    apply: (st) => { st.speedBonus += 0.10; } },

  { id: 'dashCharge', name: 'PHASE SHIFT', icon: '💨', max: 3,
    desc: '+1 dash charge',
    apply: (st, p) => { st.dashMax += 1; p.dashCharges += 1; } },

  { id: 'dashCd', name: 'CAPACITOR', icon: '🔋', max: 4,
    desc: '−20% dash cooldown',
    apply: (st) => { st.dashRecharge *= 0.8; } },

  // Regenen ligger nere i fyra sekunder efter varje träff (se player.js),
  // så det här är läkning MELLAN strider. Höj den inte utan att tänka på det.
  { id: 'regen', name: 'MENDING', icon: '💚', max: 5,
    desc: '+0.7 HP per second, out of combat',
    apply: (st) => { st.regen += 0.7; } },

  { id: 'magnet', name: 'MAGNET FIELD', icon: '🧲', max: 4,
    desc: '+70% pickup radius',
    apply: (st) => { st.pickupRadius *= 1.7; } },

  // Kritchansen kläms till 60 % i player.js — utan tak blir varje träff en
  // krit, och kritmultiplikatorn blir en ren skadeökning på allt du gör.
  { id: 'crit', name: 'KEEN EYE', icon: '🎲', max: 5,
    desc: '+10% crit chance, +0.2 crit damage',
    apply: (st) => { st.crit += 0.10; st.critMult += 0.2; } },

  { id: 'vamp', name: 'LIFE LEECH', icon: '🩸', max: 4,
    desc: '+5% of damage heals you',
    apply: (st) => { st.lifesteal += 0.05; } },

  { id: 'xp', name: 'QUICK STUDY', icon: '🧠', max: 4,
    desc: '+25% experience from orbs',
    apply: (st) => { st.xpMult *= 1.25; } },

  { id: 'jump', name: 'LIGHT STEP', icon: '🕊️', max: 2,
    desc: '+1 mid-air jump',
    apply: (st) => { st.jumps += 1; } },
];

const WILD = [
  { id: 'fairy', name: 'WISP', icon: '🧚', max: 3, world: 'wild',
    desc: 'A fairy circles you and looses magic at your enemies',
    apply: (st) => { st.drones += 1; } },

  { id: 'multi', name: 'SWEEPING BLADE', icon: '🗡️', max: 3, world: 'wild',
    desc: 'Wider, longer sword arc · +1 fireball',
    apply: (st) => { st.multishot += 1; st.spread += 0.012; } },

  { id: 'fireball', name: 'EMBER HEART', icon: '🔥', max: 4, world: 'wild',
    desc: '−2s fireball cooldown, bigger blast',
    apply: (st) => { st.fireballCool = Math.max(2.5, st.fireballCool - 2); st.explosive += 0.9; } },

  { id: 'thorns', name: 'BRIAR HIDE', icon: '🌿', max: 4, world: 'wild',
    desc: 'Attackers take 8 damage back',
    apply: (st) => { st.thorns += 8; } },

  { id: 'bleed', name: 'RENDING CUT', icon: '🗡', max: 3, world: 'wild',
    desc: 'Your hits leave a wound worth 6 more damage',
    apply: (st) => { st.burn += 6; } },

  { id: 'stone', name: 'STONE SKIN', icon: '🪨', max: 4, world: 'wild',
    desc: '+2 armour',
    apply: (st, p) => { p.armor += 2; } },
];

const CITY = [
  { id: 'drone', name: 'SUPPORT DRONE', icon: '🛸', max: 3, world: 'city',
    desc: 'A drone circles you and fires on its own',
    apply: (st) => { st.drones += 1; } },

  // Extra skott gör 75 % skada (se combat.playerShoot) — annars fördubblar
  // det första kortet skadan rakt av, och det var den värsta hävstången.
  { id: 'multi', name: 'SPLIT SHOT', icon: '🎯', max: 3, world: 'city',
    desc: '+1 laser · extra shots hit for 75%',
    apply: (st) => { st.multishot += 1; st.spread += 0.012; } },

  { id: 'pierce', name: 'PIERCING BEAM', icon: '🏹', max: 4, world: 'city',
    desc: '+1 pierce, +15% projectile speed',
    apply: (st) => { st.pierce += 1; st.projSpeed *= 1.15; } },

  { id: 'boom', name: 'DEMOLITION', icon: '💥', max: 3, world: 'city',
    desc: 'Your shots explode on impact',
    apply: (st) => { st.explosive = st.explosive ? st.explosive + 1.2 : 3.4; } },

  { id: 'shock', name: 'STATIC FIELD', icon: '⚡', max: 4, world: 'city',
    desc: 'Attackers take 8 damage back',
    apply: (st) => { st.thorns += 8; } },

  { id: 'plate', name: 'HULL PLATING', icon: '🪖', max: 4, world: 'city',
    desc: '+2 armour',
    apply: (st, p) => { p.armor += 2; } },
];

export const UPGRADES = [...CORE, ...WILD, ...CITY];

/** Slumpar n unika kort som passar världen och som spelaren inte maxat. */
export function rollChoices(levels, n = 3, worldId = 'wild') {
  const pool = UPGRADES.filter((u) =>
    (!u.world || u.world === worldId) && (levels.get(u.id) || 0) < u.max);
  const out = [];
  while (out.length < n && pool.length) {
    const i = (Math.random() * pool.length) | 0;
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}
