const FC_MAX = 196;
const FC_REPOS = 50;
const RFC = FC_MAX - FC_REPOS;

export const ZONES = {
  Z1: [FC_REPOS + RFC * 0.50, FC_REPOS + RFC * 0.60],
  Z2: [FC_REPOS + RFC * 0.60, FC_REPOS + RFC * 0.70],
  Z3: [FC_REPOS + RFC * 0.70, FC_REPOS + RFC * 0.85],
  Z4: [FC_REPOS + RFC * 0.85, FC_REPOS + RFC * 0.95],
  Z5: [FC_REPOS + RFC * 0.95, FC_MAX + 1],
};

export function classifyHR(bpm) {
  for (const [zone, [low, high]] of Object.entries(ZONES)) {
    if (bpm >= low && bpm < high) return zone;
  }
  return bpm < ZONES.Z1[0] ? 'Z1' : 'Z5';
}

export function formatPace(secondsPerKm) {
  if (!secondsPerKm) return '–';
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
}

export function formatDuration(seconds) {
  if (!seconds) return '–';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}min${String(s).padStart(2, '0')}`;
}

export function formatDistance(meters) {
  if (!meters) return '–';
  return `${(meters / 1000).toFixed(1)} km`;
}

// Sous-échantillonne un tableau de points pour l'affichage
export function downsample(points, maxPoints = 300) {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0);
}

export function polarisationStatus(zonePercent) {
  const z2 = zonePercent?.Z2 ?? 0;
  const z3 = zonePercent?.Z3 ?? 0;
  if (z2 >= 70 && z3 < 15) return { ok: true, label: 'Polarisation OK ✓' };
  if (z3 >= 15) return { ok: false, label: '⚠ Trop de Z3 — réduire les footings' };
  return { ok: false, label: `⚠ Z2 à ${z2.toFixed(0)}% (cible ≥ 70%)` };
}
