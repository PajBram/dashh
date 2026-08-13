// Uppgraderingskorten som erbjuds vid varje nivå.

export const UPGRADES = [
  { id: 'dmg', name: 'ÖVERLADDNING', icon: '⚡', max: 8,
    desc: '+25% skada per skott',
    apply: (st) => { st.damage *= 1.25; } },

  { id: 'rate', name: 'SNABBELD', icon: '🔥', max: 6,
    desc: '+20% eldhastighet',
    apply: (st) => { st.fireRate *= 1.2; } },

  { id: 'multi', name: 'SPLITTERSKOTT', icon: '🎯', max: 4,
    desc: '+1 laser/eldboll · bredare svärdssving',
    apply: (st) => { st.multishot += 1; st.spread += 0.012; } },

  { id: 'hp', name: 'PANSARPLÅT', icon: '🛡️', max: 6,
    desc: '+30 max HP och läker 30',
    apply: (st, p) => { st.maxHp += 30; p.heal(30); } },

  { id: 'speed', name: 'SERVOBEN', icon: '🥾', max: 5,
    desc: '+12% rörelsehastighet',
    apply: (st) => { st.speed *= 1.12; } },

  { id: 'dashCharge', name: 'FASSKIFTE', icon: '💨', max: 3,
    desc: '+1 dash-laddning',
    apply: (st, p) => { st.dashMax += 1; p.dashCharges += 1; } },

  { id: 'dashCd', name: 'KONDENSATOR', icon: '🔋', max: 4,
    desc: '−25% dash-återladdning',
    apply: (st) => { st.dashRecharge *= 0.75; } },

  { id: 'regen', name: 'NANITER', icon: '💚', max: 5,
    desc: '+1.2 HP i sekunden',
    apply: (st) => { st.regen += 1.2; } },

  { id: 'magnet', name: 'MAGNETFÄLT', icon: '🧲', max: 4,
    desc: '+70% plockradie för orbs',
    apply: (st) => { st.pickupRadius *= 1.7; } },

  { id: 'crit', name: 'PRICKSKYTT', icon: '🎲', max: 5,
    desc: '+12% kritchans, +0.25 kritskada',
    apply: (st) => { st.crit += 0.12; st.critMult += 0.25; } },

  { id: 'pierce', name: 'GENOMSLAG', icon: '🏹', max: 4,
    desc: '+1 genomträngning, +15% skotthastighet',
    apply: (st) => { st.pierce += 1; st.projSpeed *= 1.15; } },

  { id: 'boom', name: 'SPRÄNGLADDNING', icon: '💥', max: 3,
    desc: 'Skotten exploderar vid träff',
    apply: (st) => { st.explosive = st.explosive ? st.explosive + 1.4 : 3.8; } },

  { id: 'vamp', name: 'VAMPYRKRETS', icon: '🩸', max: 4,
    desc: '+6% av skadan läker dig',
    apply: (st) => { st.lifesteal += 0.06; } },

  { id: 'drone', name: 'STÖDDRÖNARE', icon: '🛸', max: 3,
    desc: 'En drönare cirklar och skjuter åt dig',
    apply: (st) => { st.drones += 1; } },

  { id: 'xp', name: 'SYNAPSLÄNK', icon: '🧠', max: 4,
    desc: '+25% erfarenhet från orbs',
    apply: (st) => { st.xpMult *= 1.25; } },

  { id: 'jump', name: 'SVÄVSULOR', icon: '🕊️', max: 2,
    desc: '+1 hopp i luften',
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
