import type { Document, Trip } from "../src/model";
import { parseEmail } from "../src/email";
import { extractHotelCheckout, extractHotelStayDates } from "../src/hotel-checkout";

const MAX_EMAIL_BYTES = 1024 * 1024;
export const HOTEL_REVIEW_METADATA = "hotelEvidenceReviewed";
export type RecoveredHotelEvidence = {
  trip: Trip;
  sources: {documentId:string;eventId:string}[];
};

/** Old uploads predate the stay/checkout review UI. New uploads carry this marker
 * so an intentionally unchecked proposal can never be reapplied by a later read.
 */
async function readLegacyEmail(bucket: R2Bucket, documentId: string): Promise<Uint8Array | undefined> {
  const object = await bucket.get(`documents/${documentId}`);
  if(!object || object.customMetadata?.[HOTEL_REVIEW_METADATA]==="1" || object.size>MAX_EMAIL_BYTES) return undefined;
  const reader=object.body.getReader(), chunks:Uint8Array[]=[];
  let size=0;
  while(true) {
    const {done,value}=await reader.read();
    if(done) break;
    size+=value.byteLength;
    if(size>MAX_EMAIL_BYTES) {await reader.cancel();return undefined;}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
}

/** Recover explicit evidence only; dates, clocks, status and route never move.
 * A second attachment makes the evidence ambiguous, so no winner is guessed.
 * Return the source IDs for the caller's atomic version/document checks.
 */
export async function recoverLegacyHotelEvidence(trip: Trip, documents: Document[], bucket: R2Bucket): Promise<RecoveredHotelEvidence | undefined> {
  const sources:RecoveredHotelEvidence["sources"]=[];
  const replacements=new Map<string,Trip["events"][number]>();
  let reads=0;
  for(const stay of trip.events) {
    if(stay.type!=="stay" || !stay.checkoutDate || stay.checkout || stay.staySource) continue;
    const attached=documents.filter(document=>document.eventId===stay.id);
    if(attached.length!==1) continue;
    const document=attached[0];
    if(document.size>MAX_EMAIL_BYTES || (!/\.eml$/i.test(document.name) && document.mime!=="message/rfc822")) continue;
    if(reads>=3) break;
    reads++;
    try {
      const bytes=await readLegacyEmail(bucket,document.id);
      if(!bytes) continue;
      const email=await parseEmail(bytes);
      const dates=extractHotelStayDates(email.text,stay);
      const checkout=extractHotelCheckout(email.text,stay);
      if(!dates || !checkout || dates.start!==stay.date || dates.end!==stay.checkoutDate) continue;
      const provenance={source:"booking" as const,documentId:document.id,documentName:document.name};
      replacements.set(stay.id,{...stay,checkout:{...checkout,...provenance},staySource:{...dates,...provenance}});
      sources.push({documentId:document.id,eventId:stay.id});
    } catch {
      // Preview/parsing failures leave the existing itinerary exactly as it was.
    }
  }
  return sources.length ? {trip:{...trip,events:trip.events.map(stay=>replacements.get(stay.id)||stay)},sources} : undefined;
}
