// Uppgraderingskorten som erbjuds vid varje nivå.

export const UPGRADES = [
  { id: 'dmg', name: 'OVERCHARGE', icon: '⚡', max: 8,
    desc: '+25% damage per hit',
    apply: (st) => { st.damage *= 1.25; } },

  { id: 'rate', name: 'RAPID FIRE', icon: '🔥', max: 6,
    desc: '+20% attack speed',
    apply: (st) => { st.fireRate *= 1.2; } },

  { id: 'multi', name: 'SPLIT SHOT', icon: '🎯', max: 4,
    desc: '+1 laser/fireball · wider sword arc',
    apply: (st) => { st.multishot += 1; st.spread += 0.012; } },

  { id: 'hp', name: 'PLATING', icon: '🛡️', max: 6,
    desc: '+30 max HP, heals 30',
    apply: (st, p) => { st.maxHp += 30; p.heal(30); } },

  { id: 'speed', name: 'SERVO LEGS', icon: '🥾', max: 5,
    desc: '+12% movement speed',
    apply: (st) => { st.speed *= 1.12; } },

  { id: 'dashCharge', name: 'PHASE SHIFT', icon: '💨', max: 3,
    desc: '+1 dash charge',
    apply: (st, p) => { st.dashMax += 1; p.dashCharges += 1; } },

  { id: 'dashCd', name: 'CAPACITOR', icon: '🔋', max: 4,
    desc: '−25% dash cooldown',
    apply: (st) => { st.dashRecharge *= 0.75; } },

  { id: 'regen', name: 'NANITES', icon: '💚', max: 5,
    desc: '+1.2 HP per second',
    apply: (st) => { st.regen += 1.2; } },

  { id: 'magnet', name: 'MAGNET FIELD', icon: '🧲', max: 4,
    desc: '+70% pickup radius',
    apply: (st) => { st.pickupRadius *= 1.7; } },

  { id: 'crit', name: 'MARKSMAN', icon: '🎲', max: 5,
    desc: '+12% crit chance, +0.25 crit damage',
    apply: (st) => { st.crit += 0.12; st.critMult += 0.25; } },

  { id: 'pierce', name: 'PIERCING', icon: '🏹', max: 4,
    desc: '+1 pierce, +15% projectile speed',
    apply: (st) => { st.pierce += 1; st.projSpeed *= 1.15; } },

  { id: 'boom', name: 'DEMOLITION', icon: '💥', max: 3,
    desc: 'Your hits explode',
    apply: (st) => { st.explosive = st.explosive ? st.explosive + 1.4 : 3.8; } },

  { id: 'vamp', name: 'VAMPIRIC', icon: '🩸', max: 4,
    desc: '+6% of damage heals you',
    apply: (st) => { st.lifesteal += 0.06; } },

  { id: 'drone', name: 'SUPPORT DRONE', icon: '🛸', max: 3,
    desc: 'A drone circles you and shoots',
    apply: (st) => { st.drones += 1; } },

  { id: 'xp', name: 'SYNAPSE LINK', icon: '🧠', max: 4,
    desc: '+25% experience from orbs',
    apply: (st) => { st.xpMult *= 1.25; } },

  { id: 'jump', name: 'HOVER SOLES', icon: '🕊️', max: 2,
    desc: '+1 mid-air jump',
    apply: (st) => { st.jumps += 1; } },
];

/** Slumpar n unika kort som spelaren inte redan maxat. */
export function rollChoices(levels, n = 3) {
  const pool = UPGRADES.filter((u) => (levels.get(u.id) || 0) < u.max);
  const out = [];
  while (out.length < n && pool.length) {
    const i = (Math.random() * pool.length) | 0;
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}
