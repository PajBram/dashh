// Shoppen mellan äventyrets nivåer.
//
// Uppgraderingskorten vid nivå-upp är slumpens gåva; det här är det du
// själv väljer. Därför är varorna raka och tråkiga med flit — man ska kunna
// bestämma sig på fem sekunder och komma vidare.

export const WARES = [
  { id: 'dmg', icon: '⚔️', name: 'WEAPONSMITH', desc: '+15% damage',
    base: 55, grow: 1.45, max: 12,
    apply: (st) => { st.damage *= 1.15; } },

  { id: 'hp', icon: '🛡️', name: 'PLATING', desc: '+25 max HP · heals 25',
    base: 45, grow: 1.35, max: 12,
    apply: (st, p) => { st.maxHp += 25; p.heal(25); } },

  { id: 'speed', icon: '🥾', name: 'RUNNER BOOTS', desc: '+8% movement speed',
    base: 50, grow: 1.5, max: 6,
    apply: (st) => { st.speed *= 1.08; } },

  { id: 'dashCd', icon: '🔋', name: 'CAPACITOR', desc: '−15% dash cooldown',
    base: 55, grow: 1.5, max: 5,
    apply: (st) => { st.dashRecharge *= 0.85; } },

  { id: 'crit', icon: '🎲', name: 'LUCKSTONE', desc: '+8% crit chance',
    base: 60, grow: 1.45, max: 8,
    apply: (st) => { st.crit += 0.08; } },

  { id: 'regen', icon: '💚', name: 'NANITES', desc: '+1 HP per second',
    base: 70, grow: 1.5, max: 5,
    apply: (st) => { st.regen += 1.0; } },

  { id: 'magnet', icon: '🧲', name: 'MAGNET RING', desc: '+50% pickup radius',
    base: 40, grow: 1.6, max: 4,
    apply: (st) => { st.pickupRadius *= 1.5; } },

  { id: 'xp', icon: '🧠', name: 'SYNAPSE LINK', desc: '+20% experience',
    base: 45, grow: 1.4, max: 6,
    apply: (st) => { st.xpMult *= 1.2; } },

  // Rustning hittar man i första hand ute på kartan; det här är för den som
  // hellre betalar än letar. Dyrt med flit, och utan tak precis som fynden.
  { id: 'armor', icon: '🪖', name: 'ARMOUR PIECE', desc: '+1 armour level',
    base: 90, grow: 1.4, max: 99,
    apply: (st, p) => { p.armor += 1; } },
];

/** Fältverkstaden är ingen uppgradering utan en tjänst: den fyller hälsan. */
export const REPAIR = { id: 'repair', icon: '🩹', name: 'FIELD REPAIR', desc: 'restores all health' };

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
