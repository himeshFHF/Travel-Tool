import { useId } from "react";
import { Clock3, ExternalLink, Ticket, Upload } from "lucide-react";
import type { Document, Stop } from "../model";
import { checkInCountdown, checkInDateLabel, flightCheckIn } from "../flight-checkin";
import "./FlightCheckIn.css";

export type FlightCheckInProps = {
  stop: Stop;
  now: Date;
  onUpload: () => void;
  documents?: Document[];
};

export default function FlightCheckIn({ stop, now, onUpload }: FlightCheckInProps) {
  const headingId = useId();
  if (stop.type !== "flight") return null;
  const info = flightCheckIn(stop, now);
  const headline = info.status === "future" && info.opensAt
    ? `Check-in opens in ${checkInCountdown(info.opensAt, now)}`
    : info.status === "open"
      ? "Check-in window has opened"
      : info.status === "near-departure"
        ? "Departure is approaching"
        : info.status === "past"
          ? "Scheduled departure has passed"
          : "Check-in details to add";

  return (
    <section className={`flight-checkin flight-checkin-${info.status}`} aria-labelledby={headingId}>
      <div className="flight-checkin-heading">
        <span className="flight-checkin-icon"><Ticket size={20} aria-hidden="true" /></span>
        <div>
          <span className="flight-checkin-kicker">FLIGHT CHECK-IN</span>
          <h4 id={headingId}>{headline}</h4>
        </div>
      </div>
      {info.airline && (
        <p className="flight-checkin-airline">
          {info.airline.name}{info.flightNumber ? ` · ${info.flightNumber}` : ""}
        </p>
      )}
      {info.opensAt && info.zone && info.status === "future" && (
        <p className="flight-checkin-opening">
          <Clock3 size={15} aria-hidden="true" />
          <time dateTime={info.opensAt.toISOString()}>{checkInDateLabel(info.opensAt, info.zone)}</time>
        </p>
      )}
      <p className="flight-checkin-description">
        {info.status === "future"
          ? "Online check-in normally opens 24 hours before departure. Come back then to check in with the airline."
          : info.status === "open"
            ? "Open the airline’s check-in page to complete check-in and get your boarding pass. The airline confirms your eligibility."
            : info.status === "near-departure"
              ? "Check with the airline for remaining check-in options and your latest gate details."
              : info.status === "past"
                ? "This is based on the saved schedule. Check the airline for delays or changes; you can still save your boarding pass here."
                : "Add a supported airline, departure time and departure time zone to see when check-in opens. American and Alaska are supported."}
      </p>
      <div className="flight-checkin-actions">
        {info.airline && (
          <a className="secondary" href={info.airline.checkInUrl} target="_blank" rel="noreferrer">
            {info.status === "open" ? "Open airline check-in" : "Visit airline check-in"}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
        <button type="button" className="secondary" onClick={onUpload}>
          <Upload size={14} aria-hidden="true" />Save boarding pass
        </button>
      </div>
      <p className="flight-checkin-footnote">
        Check-in happens with the airline. Save its issued pass here as a PDF or image; it will stay attached to this flight.
        {info.airline && <> Use the operating airline if it differs. <a href={info.airline.guidanceUrl} target="_blank" rel="noreferrer">Airline guidance<ExternalLink size={11} aria-hidden="true" /></a></>}
      </p>
    </section>
  );
}
