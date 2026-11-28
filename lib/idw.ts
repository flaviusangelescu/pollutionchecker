export type Pt = { lat: number; lon: number; value: number };

export function idw(lat: number, lon: number, pts: Pt[], power = 2) {
  let num = 0, den = 0;
  for (const p of pts) {
    const d = Math.hypot(lat - p.lat, lon - p.lon) || 1e-9;
    const w = 1 / Math.pow(d, power);
    num += w * p.value;
    den += w;
  }
  return num / den;
}

// scară simplificată PM2.5 (µg/m³)
export function pm25Color(v: number) {
  if (v <= 10) return "#2ecc71";
  if (v <= 25) return "#f1c40f";
  if (v <= 50) return "#e67e22";
  if (v <= 75) return "#e74c3c";
  return "#8e44ad";
}