import { Check, ChevronDown, Route, ArrowUpRight } from "lucide-react";
import type { Trip } from "../model";
import { reviewRoute } from "../route-review";
import "./route-review.css";

export default function RouteReview({
  trip,
  date,
  onApply,
  saving = false,
}: {
  trip: Trip;
  date: string;
  onApply: (date: string) => void;
  saving?: boolean;
}) {
  const review = reviewRoute(trip, date);
  if (!review) return null;
  return (
    <section className="route-review" aria-label={`${review.park} route review`}>
      <div className="route-review-heading">
        <span className="route-review-icon"><Route size={18} /></span>
        <div>
          <h3>A smoother route</h3>
          <p>{review.park} · {review.status === "in-order" ? "Order reviewed" : review.status === "suggested" ? "Suggested order" : "Review needed"}</p>
        </div>
        {review.status === "in-order" && <Check size={17} className="route-review-check" aria-label="In the reviewed order" />}
      </div>
      <p className="route-review-summary">{review.summary}</p>
      {review.status === "suggested" && (
        <ol className="route-review-sequence" aria-label="Suggested stop order">
          {review.stops.map((stop) => <li key={stop.id}>{stop.location.split("·")[0].trim()}{stop.status === "optional" && <span> · optional</span>}</li>)}
        </ol>
      )}
      {review.reason && <p className="route-review-reason">{review.reason}</p>}
      {review.correctsCapRockPin && <p className="route-review-pin-note">This also puts the Cap Rock map pin at its trailhead.</p>}
      {review.canApply && (
        <button className="primary compact route-review-apply" onClick={() => onApply(date)} disabled={saving}>
          <Route size={14} /> {saving ? "Saving order…" : "Use this stop order"}
        </button>
      )}
      <details className="route-review-details">
        <summary>Why this route <ChevronDown size={14} /></summary>
        <p className="route-review-context">{review.context}</p>
        <p>{review.explanation}</p>
        <p>{review.timing}</p>
        <div className="route-review-sources">
          {review.sources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}<ArrowUpRight size={12} /></a>
          ))}
        </div>
        <p className="route-review-footnote">Road layout reviewed October 11, 2026. Check current conditions before travel; driving times and December access are not confirmed.</p>
      </details>
    </section>
  );
}
