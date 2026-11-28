"use client";

import dynamic from "next/dynamic";

const MapView = dynamic(() => import("@/components/Map"), { ssr: false });

export default function MapLoader() {
  return <MapView />;
}