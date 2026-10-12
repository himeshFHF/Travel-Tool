import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Stop } from "../model";
// Locally drawn geographic guide. Approximate coastline and city anchors, not roads.
const coast: L.LatLngTuple[] = [
  [38, -124],
  [36.8, -121.8],
  [36, -121.5],
  [35, -120.65],
  [34.45, -120.45],
  [34.4, -119.7],
  [34.15, -119.2],
  [34.04, -118.8],
  [34.03, -118.51],
  [33.98, -118.46],
  [33.78, -118.42],
  [33.7, -118.29],
  [33.76, -118.18],
  [33.65, -117.96],
  [33.45, -117.72],
  [33.2, -117.4],
  [32.85, -117.26],
  [32.65, -117.13],
  [31, -116.6],
  [31, -125],
];
const towns: [string, number, number][] = [
  ["Los Angeles", 34.052, -118.244],
  ["Burbank", 34.181, -118.309],
  ["Santa Monica", 34.024, -118.497],
  ["Oxnard", 34.197, -119.177],
  ["San Diego", 32.716, -117.161],
  ["Twentynine Palms", 34.136, -116.055],
  ["Joshua Tree", 34.134, -116.313],
  ["Furnace Creek", 36.458, -116.869],
];
export default function RouteMap({
  stops,
  selected,
  onSelect,
}: {
  stops: Stop[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const selectedMarkers = useRef(new Map<string, L.Marker>());
  const select = useRef(onSelect);
  select.current = onSelect;
  const located = stops.filter(
    (s): s is Stop & { lat: number; lng: number } =>
      typeof s.lat === "number" && typeof s.lng === "number",
  );
  const geometry = JSON.stringify(
    located.map((s) => ({
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      location: s.location,
      number: stops.findIndex((stop) => stop.id === s.id) + 1,
    })),
  );
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: false,
    });
    map.current = m;
    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.polygon(coast, {
      color: "#c5d6d1",
      weight: 1,
      fillColor: "#dce8e5",
      fillOpacity: 1,
      interactive: false,
    }).addTo(m);
    // Subtle topographic bands suggest the mountains, with no navigation claims.
    L.polyline(
      [
        [34.16, -119.1],
        [34.13, -118.76],
        [34.18, -118.49],
        [34.28, -118.18],
        [34.3, -117.8],
        [34.21, -117.3],
      ],
      { color: "#d4dfc9", weight: 22, opacity: 0.45, interactive: false },
    ).addTo(m);
    L.polyline(
      [
        [33.87, -116.95],
        [34.04, -116.63],
        [34.11, -116.32],
        [34.03, -116.08],
        [33.94, -115.8],
      ],
      { color: "#d5dec8", weight: 30, opacity: 0.55, interactive: false },
    ).addTo(m);
    towns.forEach(([name, lat, lng]) =>
      L.marker([lat, lng], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "map-town",
          html: `<span>${name}</span>`,
          iconSize: [110, 15],
          iconAnchor: [55, -10],
        }),
      }).addTo(m),
    );
    m.setView([34.1, -118.3], 9);
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const group = L.featureGroup().addTo(m);
    selectedMarkers.current.clear();
    const points = located.map((s) => [s.lat, s.lng] as L.LatLngTuple);
    if (points.length) {
      L.polyline(points, {
        color: "#294f43",
        weight: 3,
        dashArray: "5 8",
        opacity: 0.65,
      }).addTo(group);
      const shared = new Map<string, typeof located>();
      located.forEach((stop) => {
        const key = `${stop.lat},${stop.lng}`;
        shared.set(key, [...(shared.get(key) || []), stop]);
      });
      shared.forEach((entries) => {
        const s = entries[0];
        const numbers = entries.map(
          (entry) => stops.findIndex((stop) => stop.id === entry.id) + 1,
        );
        const label = `${entries.length > 1 ? "Stops" : "Stop"} ${numbers.join(", ")}: ${entries.map((entry) => entry.location).join("; ")}`;
        const width = entries.length > 1 ? 44 : 32;
        const marker = L.marker([s.lat, s.lng], {
          title: label,
          icon: L.divIcon({
            className: entries.length > 1 ? "stop-pin shared-pin" : "stop-pin",
            html: `<span>${numbers.join("·")}</span>`,
            iconSize: [width, 32],
            iconAnchor: [width / 2, 16],
          }),
        }).addTo(group);
        marker.getElement()?.setAttribute("aria-label", label);
        const tooltip = document.createElement("span");
        tooltip.textContent = entries
          .map((entry) => entry.location)
          .join(" · ");
        marker.bindTooltip(tooltip, { direction: "top", offset: [0, -18] });
        let position = 0;
        marker.on("click", () => {
          select.current(entries[position % entries.length].id);
          position++;
        });
        entries.forEach((entry) =>
          selectedMarkers.current.set(entry.id, marker),
        );
      });
      m.fitBounds(L.latLngBounds(points), {
        padding: [45, 45],
        animate: false,
        maxZoom: 11,
      });
    }
    return () => {
      group.remove();
    };
  }, [geometry]);
  useEffect(() => {
    selectedMarkers.current.forEach((marker) => {
      marker
        .getElement()
        ?.querySelector("span")
        ?.classList.remove("pin-active");
      marker.setZIndexOffset(0);
    });
    const active = selected ? selectedMarkers.current.get(selected) : undefined;
    active?.getElement()?.querySelector("span")?.classList.add("pin-active");
    active?.setZIndexOffset(1000);
  }, [selected, geometry]);
  return (
    <>
      <div
        ref={el}
        className="route-map"
        aria-label="Schematic geographic map of the day's stops"
      />
      <div className="map-legend">
        <span className="dash" /> Schematic map · stop sequence, not directions
      </div>
      {located.length < stops.length && (
        <p className="map-note">
          Add coordinates to show {stops.length - located.length} more{" "}
          {stops.length - located.length === 1 ? "stop" : "stops"}.
        </p>
      )}
    </>
  );
}
