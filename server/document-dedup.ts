import type { Trip } from "../src/model";
import { checkoutStayForReminder } from "../src/hotel-checkout";

export type SavedDocument = { id:string; name:string; eventId:string|null; size:number; mime:string };
export async function documentHash(bytes: Uint8Array): Promise<string> {
  const digest=await crypto.subtle.digest("SHA-256",new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

export async function indexedDuplicate(db:D1Database,tripId:string,hash:string) {
  return db.prepare("SELECT d.id,d.name,d.event_id AS eventId,d.size,d.mime FROM documents d JOIN document_fingerprints f ON f.document_id=d.id WHERE d.trip_id=? AND f.trip_id=? AND f.sha256=? LIMIT 1").bind(tripId,tripId,hash).first<SavedDocument>();
}

// Existing originals are read only. Fingerprints are backfilled incrementally;
// stop before saving if the remaining work exceeds a bounded request budget.
export async function checkDocumentDuplicate(db:D1Database,bucket:R2Bucket,tripId:string,hash:string,size:number) {
  const indexed=await indexedDuplicate(db,tripId,hash);
  if(indexed) return {duplicate:indexed,pending:false};
  const legacy=await db.prepare("SELECT d.id,d.name,d.event_id AS eventId,d.size,d.mime FROM documents d LEFT JOIN document_fingerprints f ON f.document_id=d.id WHERE d.trip_id=? AND d.size=? AND f.document_id IS NULL ORDER BY d.id LIMIT 33").bind(tripId,size).all<SavedDocument>();
  let inspected=0,bytesRead=0;
  for(const document of legacy.results) {
    if(inspected>=32 || (inspected>0 && bytesRead+document.size>64*1024*1024)) return {duplicate:null,pending:true};
    const object=await bucket.get(`documents/${document.id}`);
    if(!object) return {duplicate:null,pending:true,unavailable:true};
    const bytes=new Uint8Array(await new Response(object.body as ReadableStream).arrayBuffer());
    bytesRead+=bytes.length;inspected++;
    const storedHash=await documentHash(bytes);
    await db.prepare("INSERT OR IGNORE INTO document_fingerprints (document_id,trip_id,sha256) SELECT id,trip_id,? FROM documents WHERE id=? AND trip_id=?").bind(storedHash,document.id,tripId).run();
    if(storedHash===hash) return {duplicate:document,pending:false};
  }
  return {duplicate:await indexedDuplicate(db,tripId,hash),pending:false};
}

// A stay's checkout reminder is the same booking. Unrelated stops on the same
// day, including flights and hotels, never become conflicts merely by date.
export function bookingStopIds(trip:Trip,eventId:string|null):string[] {
  if(!eventId) return [];
  const selected=trip.events.find(stop=>stop.id===eventId);
  if(!selected) return [eventId];
  const stay=checkoutStayForReminder(selected,trip.events);
  const canonical=stay?.id || selected.id;
  return trip.events.filter(stop=>stop.id===canonical || checkoutStayForReminder(stop,trip.events)?.id===canonical).map(stop=>stop.id);
}

export async function bookingDocuments(db:D1Database,tripId:string,eventIds:string[]) {
  if(!eventIds.length) return [];
  const result=await db.prepare(`SELECT id,name,event_id AS eventId,size,mime FROM documents WHERE trip_id=? AND event_id IN (${eventIds.map(()=>"?").join(",")})`).bind(tripId,...eventIds).all<SavedDocument>();
  return result.results;
}

export function conflictGuard(tripId:string,eventIds:string[],reviewed:string[]) {
  if(!eventIds.length) return {sql:"",args:[] as string[]};
  return {sql:` AND NOT EXISTS (SELECT 1 FROM documents WHERE trip_id=? AND event_id IN (${eventIds.map(()=>"?").join(",")})${reviewed.length ? ` AND id NOT IN (${reviewed.map(()=>"?").join(",")})` : ""})`,args:[tripId,...eventIds,...reviewed]};
}
