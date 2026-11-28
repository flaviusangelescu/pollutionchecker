"use client";
import { MapContainer, TileLayer, CircleMarker, Popup, Rectangle, useMap, useMapEvents } from "react-leaflet";
import type { CircleMarker as LeafletCircleMarker } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { idw, pm25Color } from "@/lib/idw";

type Sensor = { id: number; lat: number; lon: number; pm10: number | null; pm25: number | null; timestamp: string };
type Bounds = [[number, number], [number, number]];
type FlyTarget = { lat: number; lon: number; id: number; n: number };

const CENTER: [number, number] = [45.268, 25.047];
const STEP = 0.002;
const RADIUS_M = 1500;
const MAX_RANGE_M = 1500;

const USE_TEST_DATA = true;

const TEST_SENSORS: Sensor[] = [
  { id: 1, lat: 45.268, lon: 25.047, pm10: 12, pm25: 8, timestamp: "test" },
  { id: 2, lat: 45.285, lon: 25.030, pm10: 35, pm25: 22, timestamp: "test" },
  { id: 3, lat: 45.255, lon: 25.065, pm10: 70, pm25: 45, timestamp: "test" },
  { id: 4, lat: 45.275, lon: 25.075, pm10: 110, pm25: 68, timestamp: "test" },
  { id: 5, lat: 45.248, lon: 25.025, pm10: 20, pm25: 14, timestamp: "test" },
];

const LEGEND = [
  { label: "Excelent", range: "0–10", color: "#2ecc71" },
  { label: "Bun", range: "11–25", color: "#f1c40f" },
  { label: "Moderat", range: "26–50", color: "#e67e22" },
  { label: "Slab", range: "51–75", color: "#e74c3c" },
  { label: "Foarte slab", range: "75+", color: "#8e44ad" },
];

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function minDistToSensors(lat: number, lon: number, pts: { lat: number; lon: number }[]) {
  let min = Infinity;
  for (const p of pts) min = Math.min(min, distMeters(lat, lon, p.lat, p.lon));
  return min;
}

function quality(v: number) {
  if (v <= 10) return "Excelent";
  if (v <= 25) return "Bun";
  if (v <= 50) return "Moderat";
  if (v <= 75) return "Slab";
  return "Foarte slab";
}


type Probe = {
  lat: number;
  lon: number;
  value: number;
  avgDist: number;
  nearCount: number;
  rows: { id: number; pm25: number; dist: number; weight: number }[];
};

function ClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function BoundsController({ bounds }: { bounds: Bounds | null }) {
  const map = useMap();
  const key = JSON.stringify(bounds);

  useEffect(() => {
    if (!bounds) return;
    map.setMaxBounds(bounds);
    map.fitBounds(bounds);
    map.setMinZoom(map.getBoundsZoom(bounds));
  }, [key, map]);

  return null;
}

function FlyToController({
  target,
  markerRefs,
}: {
  target: FlyTarget | null;
  markerRefs: React.MutableRefObject<Record<number, LeafletCircleMarker | null>>;
}) {
  const map = useMap();

  useEffect(() => {
    if (!target) return;
    const open = () => markerRefs.current[target.id]?.openPopup();
    map.flyTo([target.lat, target.lon], Math.max(map.getZoom(), 15), { duration: 0.8 });
    map.once("moveend", open);
    const t = setTimeout(open, 1000); // dacă harta era deja acolo
    return () => {
      map.off("moveend", open);
      clearTimeout(t);
    };
  }, [target, map, markerRefs]);

  return null;
}

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 12,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "#94a3b8",
  margin: "0 0 8px",
};

export default function Map() {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [open, setOpen] = useState(true);
  const [fly, setFly] = useState<FlyTarget | null>(null);
  const markerRefs = useRef<Record<number, LeafletCircleMarker | null>>({});

  useEffect(() => {
    if (USE_TEST_DATA) {
      setSensors(TEST_SENSORS);
      return;
    }
    const load = () => fetch("/api/sensors").then(r => r.json()).then(setSensors);
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, []);

  const pts = useMemo(
    () => sensors.filter(s => s.pm25 != null).map(s => ({ id: s.id, lat: s.lat, lon: s.lon, value: s.pm25! })),
    [sensors]
  );

  const stats = useMemo(() => {
    const vals = sensors.filter(s => s.pm25 != null);
    if (vals.length === 0) return null;
    const avg = vals.reduce((a, s) => a + s.pm25!, 0) / vals.length;
    const best = vals.reduce((a, s) => (s.pm25! < a.pm25! ? s : a));
    const worst = vals.reduce((a, s) => (s.pm25! > a.pm25! ? s : a));
    return { avg, best, worst, count: vals.length };
  }, [sensors]);

  const sortedSensors = useMemo(
    () => [...sensors].sort((a, b) => (b.pm25 ?? -1) - (a.pm25 ?? -1)),
    [sensors]
  );

  const bounds = useMemo<Bounds | null>(() => {
    if (pts.length === 0) return null;
    const latPad = MAX_RANGE_M / 111320;
    const lonPad = MAX_RANGE_M / (111320 * Math.cos((pts[0].lat * Math.PI) / 180));
    const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
    return [
      [Math.min(...lats) - latPad, Math.min(...lons) - lonPad],
      [Math.max(...lats) + latPad, Math.max(...lons) + lonPad],
    ];
  }, [pts]);

  const cells = useMemo(() => {
    if (!bounds || pts.length < 2) return [];
    const [[south, west], [north, east]] = bounds;
    const out: { b: [[number, number], [number, number]]; color: string }[] = [];
    for (let lat = south; lat < north; lat += STEP)
      for (let lon = west; lon < east; lon += STEP) {
        const cLat = lat + STEP / 2, cLon = lon + STEP / 2;
        if (minDistToSensors(cLat, cLon, pts) > MAX_RANGE_M) continue;
        out.push({
          b: [[lat, lon], [lat + STEP, lon + STEP]],
          color: pm25Color(idw(cLat, cLon, pts)),
        });
      }
    return out;
  }, [pts, bounds]);

  const handleMapClick = (lat: number, lon: number) => {
    if (pts.length < 2) return;
    if (minDistToSensors(lat, lon, pts) > MAX_RANGE_M) return;

    const value = idw(lat, lon, pts);
    const raw = pts.map(p => {
      const d = Math.hypot(lat - p.lat, lon - p.lon) || 1e-9;
      return { id: p.id, pm25: p.value, w: 1 / (d * d), dist: distMeters(lat, lon, p.lat, p.lon) };
    });
    const totalW = raw.reduce((a, r) => a + r.w, 0);
    const rows = raw
      .map(r => ({ id: r.id, pm25: r.pm25, dist: r.dist, weight: (r.w / totalW) * 100 }))
      .sort((a, b) => a.dist - b.dist);

    setProbe({
      lat, lon, value,
      avgDist: rows.reduce((a, r) => a + r.dist, 0) / rows.length,
      nearCount: rows.filter(r => r.dist <= RADIUS_M).length,
      rows,
    });
  };

  const avgColor = stats ? pm25Color(stats.avg) : "#64748b";

  return (
    <div style={{ position: "relative", height: "100vh", width: "100%" }}>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: "absolute", top: 12, left: 12, zIndex: 1000,
            background: "rgba(15,23,42,0.92)", color: "#e2e8f0",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
            padding: "10px 14px", cursor: "pointer", fontSize: 14,
          }}
        >
          ☰ Date senzori
        </button>
      )}

      {open && (
        <aside
          style={{
            position: "absolute", top: 12, left: 12, bottom: 12, zIndex: 1000,
            width: "min(340px, calc(100vw - 24px))",
            display: "flex", flexDirection: "column", overflow: "hidden",
            background: "rgba(15,23,42,0.92)", backdropFilter: "blur(10px)",
            color: "#e2e8f0", borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
    
          <div style={{ padding: "14px 16px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Pollution Checker</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                Câmpulung · PM2.5 {USE_TEST_DATA && <span style={{ color: "#f59e0b" }}>· date de test</span>}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Închide panoul"
              style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}
            >
              ✕
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
            {!stats ? (
              <div style={{ ...card, textAlign: "center", color: "#94a3b8" }}>Se încarcă senzorii...</div>
            ) : (
              <>
            
                <div style={{ ...card, borderLeft: `4px solid ${avgColor}` }}>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>Media zonei</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 40, fontWeight: 800, color: avgColor }}>{stats.avg.toFixed(1)}</span>
                    <span style={{ fontSize: 13, color: "#94a3b8" }}>µg/m³</span>
                  </div>
                  <div style={{ fontWeight: 600, color: avgColor }}>{quality(stats.avg)}</div>
                  <p style={{ fontSize: 13, margin: "8px 0 0", color: "#cbd5e1", lineHeight: 1.4 }}></p>
                </div>

               
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div style={card}>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>Senzori</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.count}</div>
                  </div>
                  <div style={card}>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>Cel mai curat</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: pm25Color(stats.best.pm25!) }}>{stats.best.pm25}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>#{stats.best.id}</div>
                  </div>
                  <div style={card}>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>Cel mai poluat</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: pm25Color(stats.worst.pm25!) }}>{stats.worst.pm25}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>#{stats.worst.id}</div>
                  </div>
                </div>

               
                <div>
                  <h3 style={sectionTitle}>Senzori (cei mai poluați primii)</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {sortedSensors.map(s => {
                      const c = pm25Color(s.pm25 ?? 0);
                      const pct = Math.min(100, ((s.pm25 ?? 0) / 100) * 100);
                      return (
                        <button
                          key={s.id}
                          onClick={() => setFly({ lat: s.lat, lon: s.lon, id: s.id, n: Date.now() })}
                          style={{ ...card, textAlign: "left", cursor: "pointer", color: "inherit", width: "100%" }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: 600 }}>
                              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: c, marginRight: 8 }} />
                              Senzor #{s.id}
                            </span>
                            <span style={{ fontWeight: 700, color: c }}>
                              {s.pm25 ?? "-"} <small style={{ fontWeight: 400, color: "#94a3b8" }}>PM2.5</small>
                            </span>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.1)", margin: "8px 0 6px" }}>
                            <div style={{ height: 6, borderRadius: 3, width: `${pct}%`, background: c }} />
                          </div>
                          <div style={{ fontSize: 11, color: "#94a3b8", display: "flex", justifyContent: "space-between" }}>
                            <span>PM10: {s.pm10 ?? "-"} µg/m³</span>
                            <span>{s.lat.toFixed(4)}, {s.lon.toFixed(4)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

        
            <div>
              <h3 style={sectionTitle}>Legendă PM2.5 (µg/m³)</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {LEGEND.map(l => (
                  <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: l.color }} />
                    <span style={{ width: 90 }}>{l.label}</span>
                    <span style={{ color: "#94a3b8" }}>{l.range}</span>
                  </div>
                ))}
              </div>
            </div>

            <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, lineHeight: 1.4 }}>
            </p>
          </div>
        </aside>
      )}

     
      <MapContainer center={CENTER} zoom={13} minZoom={10} zoomControl={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onClick={handleMapClick} />
        <BoundsController bounds={bounds} />
        <FlyToController target={fly} markerRefs={markerRefs} />

        {cells.map((c, i) => (
          <Rectangle
            key={i}
            bounds={c.b}
            interactive={false}
            pathOptions={{ stroke: false, fillColor: c.color, fillOpacity: 0.35 }}
          />
        ))}

        {sensors.map(s => (
          <CircleMarker
            key={s.id}
            ref={(el) => { markerRefs.current[s.id] = el; }}
            center={[s.lat, s.lon]}
            radius={9}
            bubblingMouseEvents={false}
            pathOptions={{ color: "#000", weight: 1, fillColor: pm25Color(s.pm25 ?? 0), fillOpacity: 1 }}
          >
            <Popup>
              <div style={{ lineHeight: 1.5 }}>
                <b>Senzor #{s.id}</b><br />
                PM2.5: <b>{s.pm25 ?? "-"}</b> µg/m³
                {s.pm25 != null && <> ({quality(s.pm25)})</>}<br />
                PM10: <b>{s.pm10 ?? "-"}</b> µg/m³<br />
                Locație: {s.lat.toFixed(5)}, {s.lon.toFixed(5)}<br />
                <small>Ultima citire: {s.timestamp}</small>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {probe && (
          <Popup
            key={`${probe.lat}-${probe.lon}`}
            position={[probe.lat, probe.lon]}
            eventHandlers={{ remove: () => setProbe(null) }}
            maxWidth={300}
          >
            <div style={{ lineHeight: 1.5 }}>
              <b>Zonă între senzori</b><br />
              PM2.5 estimat: <b>{probe.value.toFixed(1)}</b> µg/m³ ({quality(probe.value)})<br />
              Senzori în {RADIUS_M / 1000} km: <b>{probe.nearCount}</b> din {probe.rows.length}<br />
              Distanta medie fata de senzori: <b>{(probe.avgDist / 1000).toFixed(2)} km</b>
              <hr style={{ margin: "6px 0" }} />
              {probe.rows.map(r => (
                <div key={r.id}>
                  #{r.id}: {r.pm25} µg/m³ · {(r.dist / 1000).toFixed(2)} km · influență {r.weight.toFixed(0)}%
                </div>
              ))}
            </div>
          </Popup>
        )}
      </MapContainer>
    </div>
  );
}