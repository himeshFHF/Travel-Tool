import { useEffect, useMemo, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import type { Trip } from "../model";
import { dayDirections } from "../directions";
import "./DayDirections.css";

const useMobileLinks = () => typeof window !== "undefined" && (
  window.matchMedia("(max-width: 700px)").matches ||
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
);

export default function DayDirections({ trip, date, variant = "details" }: {
  trip: Trip;
  date: string;
  variant?: "icon" | "details";
}) {
  const plan = useMemo(() => dayDirections(trip, date), [trip, date]);
  const [mobile, setMobile] = useState(useMobileLinks);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const change = () => setMobile(useMobileLinks());
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const parts = mobile ? plan.mobileParts : plan.desktopParts;
  const url = parts[0]?.url || plan.placeLinks[0]?.url;
  const label = plan.mixedTransport ? "Open mainland drive in Google Maps" : plan.complete ? "Open day in Google Maps" : "Open mapped stops in Google Maps";
  const title = parts.length > 1 ? `${label}, part 1 of ${parts.length}` : label;
  if (variant === "icon") return url ? (
    <a className="round-icon day-directions-icon" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={title} title={title}>
      <MapPin size={16} aria-hidden="true" />
    </a>
  ) : (
    <span className="round-icon" title="Add a location to open Google Maps"><MapPin size={16} aria-hidden="true" /></span>
  );
  return (
    <div className="day-directions">
      {url && <p>{plan.mixedTransport ? "Drive to the harbor, then take the booked boat. The island opens separately." : `Google Maps opens your saved stop order${plan.includesHotel ? ", including your hotel" : ""}.`}</p>}
      {parts.length > 1 && (
        <>
          {!plan.mixedTransport && <p className="day-directions-explain">{mobile ? "Open these parts in order to keep every stop on your phone." : "Open these parts in order to keep every stop."}</p>}
          <ol className="day-directions-parts">
            {parts.map((part, i) => <li key={`${i}-${part.points[0].eventId}`}>
              <a href={part.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                <span><strong>{plan.mixedTransport ? (i === 0 ? "Drive to harbor" : "Drive back") : `Part ${i + 1}`}</strong><small>{part.points[0].label} → {part.points.at(-1)!.label}</small></span>
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            </li>)}
          </ol>
        </>
      )}
      {plan.placeLinks.map(({ point, url: placeUrl }) => <a className="day-directions-place" key={point.eventId} href={placeUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">View {point.label} <ExternalLink size={13} aria-hidden="true" /></a>)}
      {!!plan.unresolved.length && <p className="day-directions-pending">Add a specific location for {plan.unresolved.map((p) => p.label).join("; ")} to include {plan.unresolved.length === 1 ? "it" : "them"} in directions.</p>}
      {plan.points.some((point) => !point.prepared) && <p className="day-directions-pending">Check the matching place in Google Maps for newly added locations.</p>}
      {!url && !plan.unresolved.length && <p>Add stops to prepare this day’s directions.</p>}
    </div>
  );
}
