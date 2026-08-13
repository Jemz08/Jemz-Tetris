// Score-based rank tiers — purely a function of score, so any leaderboard
// entry (yours or anyone else's) can be given a tier just by looking at its
// score. No extra data to store or keep in sync.

export const TIERS = [
  { id: 'rookie', name: 'ROOKIE', min: 0, color: '#8a8a9e' },
  { id: 'bronze', name: 'BRONZE', min: 3000, color: '#cd7f32' },
  { id: 'silver', name: 'SILVER', min: 10000, color: '#c8ccd6' },
  { id: 'gold', name: 'GOLD', min: 25000, color: '#ffd447' },
  { id: 'platinum', name: 'PLATINUM', min: 50000, color: '#00f0ff' },
  { id: 'diamond', name: 'DIAMOND', min: 100000, color: '#d142f5' }
];

export function getTier(score) {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (score >= t.min) tier = t;
    else break;
  }
  return tier;
}

export function nextTier(score) {
  const current = getTier(score);
  const idx = TIERS.findIndex((t) => t.id === current.id);
  return TIERS[idx + 1] || null;
}
