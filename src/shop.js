// Shoppen mellan äventyrets nivåer.
//
// Uppgraderingskorten vid nivå-upp är slumpens gåva; det här är det du
// själv väljer. Därför är varorna raka och tråkiga med flit — man ska kunna
// bestämma sig på fem sekunder och komma vidare.

export const WARES = [
  { id: 'dmg', icon: '⚔️', name: 'VAPENSMED', desc: '+15% skada',
    base: 55, grow: 1.45, max: 12,
    apply: (st) => { st.damage *= 1.15; } },

  { id: 'hp', icon: '🛡️', name: 'PANSARPLÅT', desc: '+25 max HP · läker 25',
    base: 45, grow: 1.35, max: 12,
    apply: (st, p) => { st.maxHp += 25; p.heal(25); } },

  { id: 'speed', icon: '🥾', name: 'SPRINGARSKOR', desc: '+8% rörelsehastighet',
    base: 50, grow: 1.5, max: 6,
    apply: (st) => { st.speed *= 1.08; } },

  { id: 'dashCd', icon: '🔋', name: 'KONDENSATOR', desc: '−15% dash-återladdning',
    base: 55, grow: 1.5, max: 5,
    apply: (st) => { st.dashRecharge *= 0.85; } },

  { id: 'crit', icon: '🎲', name: 'LYCKOSTEN', desc: '+8% kritchans',
    base: 60, grow: 1.45, max: 8,
    apply: (st) => { st.crit += 0.08; } },

  { id: 'regen', icon: '💚', name: 'NANITER', desc: '+1 HP i sekunden',
    base: 70, grow: 1.5, max: 5,
    apply: (st) => { st.regen += 1.0; } },

  { id: 'magnet', icon: '🧲', name: 'MAGNETRING', desc: '+50% plockradie',
    base: 40, grow: 1.6, max: 4,
    apply: (st) => { st.pickupRadius *= 1.5; } },

  { id: 'xp', icon: '🧠', name: 'SYNAPSLÄNK', desc: '+20% erfarenhet',
    base: 45, grow: 1.4, max: 6,
    apply: (st) => { st.xpMult *= 1.2; } },
];

/** Fältverkstaden är ingen uppgradering utan en tjänst: den fyller hälsan. */
export const REPAIR = { id: 'repair', icon: '🩹', name: 'FÄLTVERKSTAD', desc: 'fyller hälsan helt' };

/** Priset stiger för varje köpt exemplar, så inget kan spammas billigt. */
export function priceOf(ware, owned) {
  return Math.round(ware.base * Math.pow(ware.grow, owned));
}

/** Vad fältverkstaden kostar just nu — gratis vore fel, och full hälsa köps inte. */
export function repairPrice(player) {
  const missing = player.stats.maxHp - player.hp;
  if (missing < 1) return 0;
  return Math.max(10, Math.round(missing * 0.7));
}
