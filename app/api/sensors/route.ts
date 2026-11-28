import { NextResponse } from "next/server";

const BOX = "45.32,24.98,45.23,25.12";

export async function GET() {
  const res = await fetch(
    `https://data.sensor.community/airrohr/v1/filter/box=${BOX}`,
    { cache: "no-store" }
  );
  const raw = await res.json();

  const map = new Map<number, any>();
  for (const r of raw) {
    const vals = Object.fromEntries(
      r.sensordatavalues.map((v: any) => [v.value_type, parseFloat(v.value)])
    );
    if (vals.P1 === undefined && vals.P2 === undefined) continue;
    map.set(r.sensor.id, {
      id: r.sensor.id,
      lat: parseFloat(r.location.latitude),
      lon: parseFloat(r.location.longitude),
      pm10: vals.P1 ?? null,
      pm25: vals.P2 ?? null,
      timestamp: r.timestamp,
    });
  }
  return NextResponse.json([...map.values()]);
}