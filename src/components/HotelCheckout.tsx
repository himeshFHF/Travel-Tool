import type { Document, Stop } from "../model";
import { dateLabel, timeLabel } from "../model";
import { getHotelCheckout } from "../hotel-checkout";
import { documentsForStop, hotelStayForStop } from "../document-links";
import "./hotel-checkout.css";

export default function HotelCheckout({ stop, documents = [], stops = [], tripId = "california" }: {
  stop: Stop;
  documents?: Document[];
  stops?: Stop[];
  tripId?: string;
}) {
  const checkout = getHotelCheckout(stop, documents, stops);
  if (!checkout) return null;
  const time = checkout.time ? timeLabel(checkout.time).replace(":00", "") : undefined;
  const stayDocuments = documentsForStop(stop,documents,stops);
  const stay = hotelStayForStop(stop,stops);
  const staySource = stay?.staySource && stay.staySource.start===stay.date && stay.staySource.end===stay.checkoutDate ? stay.staySource : undefined;
  const staySourceDocument = staySource ? stayDocuments.find(document=>document.id===staySource.documentId) : undefined;
  const documentUrl = (id: string) => `/api/documents/${encodeURIComponent(id)}?${new URLSearchParams({tripId})}`;
  return (
    <section className="hotel-checkout" aria-label="Hotel checkout">
      <div className="hotel-checkout-heading">
        <span>CHECKOUT{checkout.date ? ` · ${dateLabel(checkout.date)}` : ""}</span>
        <strong>{time ? (checkout.source === "standard" ? `Standard checkout ${time}` : `By ${time}`) : "Checkout time not yet available"}</strong>
      </div>
      {checkout.source === "booking" ? (
        <p className="hotel-checkout-source">
          From booking{checkout.document ? <> · <a href={documentUrl(checkout.document.id)} target="_blank" rel="noreferrer">{checkout.document.name}</a></> : checkout.documentName ? ` · ${checkout.documentName}` : ""}
        </p>
      ) : checkout.source === "manual" ? <p className="hotel-checkout-source">Entered by you</p> : checkout.policy ? (
        <p className="hotel-checkout-source"><a href={checkout.policy.url} target="_blank" rel="noreferrer">Official hotel policy</a> · checked {dateLabel(checkout.policy.checkedOn, { month: "short", day: "numeric", year: "numeric" })}. Your booking may have different terms.</p>
      ) : <p className="hotel-checkout-source">Attach your hotel booking to read its checkout time.{stop.url && /^https:\/\//.test(stop.url) ? <> <a href={stop.url} target="_blank" rel="noreferrer">Check hotel information</a>.</> : ""}</p>}
      {checkout.conflict && <p className="hotel-checkout-conflict">The itinerary reports {timeLabel(checkout.reportedTime!).replace(":00", "")}. {checkout.source === "standard" ? "This differs from the hotel’s standard policy; check the booking before relying on the later time." : "The booking or saved checkout time is shown above; the original itinerary note is retained."}</p>}
      {checkout.source === "unknown" && checkout.reportedTime && <p className="hotel-checkout-conflict">Itinerary reports {timeLabel(checkout.reportedTime).replace(":00", "")} · awaiting booking or hotel confirmation.</p>}
      {checkout.evidence && <details className="hotel-checkout-evidence"><summary>Checkout wording</summary><p>{checkout.evidence}</p></details>}
      {staySource && <p className="hotel-checkout-source">Stay dates from booking · {staySourceDocument ? <a href={documentUrl(staySourceDocument.id)} target="_blank" rel="noreferrer">{staySourceDocument.name}</a> : staySource.documentName}</p>}
      {stayDocuments.length > 0 && <div className="hotel-stay-documents">
        <strong>Documents for this stay</strong>
        {stay?.checkoutDate && <p>Available throughout {dateLabel(stay.date)}–{dateLabel(stay.checkoutDate)}, including checkout day.</p>}
        <ul>{stayDocuments.map(document=><li key={document.id}><a href={documentUrl(document.id)} target="_blank" rel="noreferrer">{document.name}</a></li>)}</ul>
      </div>}
      {time && <p className="hotel-checkout-note">Hotel local time. This is the checkout deadline; your departure can be earlier.</p>}
    </section>
  );
}
