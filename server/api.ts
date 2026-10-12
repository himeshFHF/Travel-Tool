import { z } from "zod";
import { seed } from "../src/seed";
import { stopSchema } from "./validation";
import type { Trip } from "../src/model";
import { upgradeTrip } from "./trip-upgrades";
import { buildEmailPreview } from "./document-preview";
import { readEmailAttachment } from "../src/email";
import { checkoutStayForReminder } from "../src/hotel-checkout";
import { HOTEL_REVIEW_METADATA, recoverLegacyHotelEvidence } from "./hotel-evidence-backfill";
import { bookingDocuments, bookingStopIds, checkDocumentDuplicate, conflictGuard, documentHash, indexedDuplicate, type SavedDocument } from "./document-dedup";

type Identity = { userId: string; displayName: string; email: string };
type Bindings = { DB?: D1Database; BUCKET?: R2Bucket };
type TripRow = { id: string; payload: string; version: number };
type DocRow = { id: string; name: string; mime: string; size: number; eventId: string | null };
const TRIP = "california";
const MAX_FILE = 20 * 1024 * 1024;
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" } });
}
function limitedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") || 0) > limit) throw new HttpError(413, "This upload is too large. Files must be 20 MB or smaller.");
  let size = 0;
  return request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) throw new HttpError(413, "Request is too large.");
      controller.enqueue(chunk);
    }
  }));
}
export async function handleApi(request: Request, bindings: Bindings, identity: Identity | null): Promise<Response> {
  try {
    if (!identity) throw new HttpError(401, "Please sign in to your private workspace.");
    const url = new URL(request.url), method = request.method;
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const origin = request.headers.get("origin");
      if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Request origin does not match this app.");
    }
    const db = bindings.DB;
    if (!db || !bindings.BUCKET) throw new HttpError(503, "Your travel workspace is still getting ready. Please try again shortly.");
    const route = url.pathname.replace(/^\/api/, "");
    const tripId = url.searchParams.get("tripId") ?? TRIP;
    // The Sites audience controls admission. The app retains its two-traveler limit.
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO trips (id,payload,version) VALUES (?,?,1)").bind(TRIP, JSON.stringify(seed)),
      db.prepare("INSERT OR IGNORE INTO members (user_id,name,trip_id) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM members WHERE trip_id=?) < 2").bind(identity.userId, identity.displayName, TRIP, TRIP),
    ]);
    const member = await db.prepare("SELECT user_id FROM members WHERE user_id=? AND trip_id=?").bind(identity.userId, TRIP).first();
    if (!member) throw new HttpError(403, "This workspace already has two travelers.");
    if (route === "/auth" && method === "GET") return json({user:{name:identity.displayName,email:identity.email},needsSetup:false});
    if (route === "/trips" && method === "GET") {
      const rows = await db.prepare("SELECT id,payload,(SELECT COUNT(*) FROM documents WHERE trip_id=trips.id) AS documentCount FROM trips ORDER BY rowid").all<TripRow & {documentCount:number}>();
      return json({trips:rows.results.map(row=>{
        const trip: Trip = JSON.parse(row.payload);
        return {id:row.id,title:trip.title,start:trip.start,end:trip.end,stopCount:trip.events.length,documentCount:row.documentCount};
      })});
    }
    if (route === "/trips" && method === "POST") {
      let body: unknown;
      try { body = await new Response(limitedBody(request,16*1024)).json(); } catch(e) { if(e instanceof HttpError) throw e; throw new HttpError(400,"Use valid trip details."); }
      const input = z.object({id:z.uuid().transform(id=>id.toLowerCase()),title:z.string().trim().min(1).max(200),start:z.iso.date(),end:z.iso.date()}).parse(body);
      if(input.start>input.end || Date.parse(input.end)-Date.parse(input.start)>366*864e5) throw new HttpError(400,"Choose a trip end date on or after its start, within one year.");
      const payload: Trip = {title:input.title,start:input.start,end:input.end,events:[],routeRevision:1};
      // The browser retains this ID across retries; an interrupted request can never
      // create another trip. Compare the requested details if the ID already exists.
      const inserted = await db.prepare("INSERT OR IGNORE INTO trips (id,payload,version) VALUES (?,?,1)").bind(input.id,JSON.stringify(payload)).run();
      const existing = await db.prepare("SELECT * FROM trips WHERE id=?").bind(input.id).first<TripRow>();
      if(!existing) throw new HttpError(500,"Your trip could not be saved. Please try again.");
      const saved: Trip = JSON.parse(existing.payload);
      if(saved.title!==input.title || saved.start!==input.start || saved.end!==input.end) throw new HttpError(409,"That trip was already created with different details. Open My trips to find it.");
      return json({id:input.id},inserted.meta.changes ? 201 : 200);
    }
    if (route === "/trip" && method === "GET") {
      let trip = await db.prepare("SELECT * FROM trips WHERE id=?").bind(tripId).first<TripRow>();
      if (!trip) throw new HttpError(404,"Trip not found.");
      const saved: Trip = JSON.parse(trip.payload);
      const upgraded = tripId===TRIP ? upgradeTrip(saved) : saved;
      if(upgraded !== saved) {
        await db.prepare("UPDATE trips SET payload=?,version=version+1 WHERE id=? AND version=?").bind(JSON.stringify(upgraded),tripId,trip.version).run();
        trip = await db.prepare("SELECT * FROM trips WHERE id=?").bind(tripId).first<TripRow>();
        if(!trip) throw new HttpError(404,"Trip not found.");
      }
      const [listedDocuments, members] = await Promise.all([
        db.prepare("SELECT id,name,event_id AS eventId,size,mime FROM documents WHERE trip_id=?").bind(tripId).all<DocRow>(),
        db.prepare("SELECT name FROM members WHERE trip_id=?").bind(TRIP).all(),
      ]);
      let documents=listedDocuments;
      const recovered=await recoverLegacyHotelEvidence(JSON.parse(trip.payload),documents.results,bindings.BUCKET);
      if(recovered) {
        // Version protects manual edits; each source guard also protects against a
        // concurrent attachment upload/deletion, which need not change trip version.
        const guards=recovered.sources.map(()=>"EXISTS (SELECT 1 FROM documents WHERE id=? AND trip_id=? AND event_id=?) AND (SELECT COUNT(*) FROM documents WHERE trip_id=? AND event_id=?)=1");
        const sourceArgs=recovered.sources.flatMap(source=>[source.documentId,tripId,source.eventId,tripId,source.eventId]);
        await db.prepare(`UPDATE trips SET payload=?,version=version+1 WHERE id=? AND version=? AND ${guards.map(guard=>`(${guard})`).join(" AND ")}`).bind(JSON.stringify(recovered.trip),tripId,trip.version,...sourceArgs).run();
        trip=await db.prepare("SELECT * FROM trips WHERE id=?").bind(tripId).first<TripRow>();
        if(!trip) throw new HttpError(404,"Trip not found.");
        documents=await db.prepare("SELECT id,name,event_id AS eventId,size,mime FROM documents WHERE trip_id=?").bind(tripId).all<DocRow>();
      }
      return json({id:tripId,trip:JSON.parse(trip.payload),version:trip.version,documents:documents.results,members:members.results});
    }
    if (route === "/trip" && method === "PUT") {
      let body: unknown;
      try { body = await new Response(limitedBody(request,1024*1024)).json(); } catch(e) { if(e instanceof HttpError) throw e; throw new HttpError(400,"Use valid trip details."); }
      const input = z.object({version:z.number().int().positive(),trip:z.object({routeRevision:z.literal(1).optional(),title:z.string().trim().min(1).max(200),start:z.iso.date(),end:z.iso.date(),events:z.array(stopSchema).max(300)})}).parse(body);
      const trip = input.trip;
      if (trip.start > trip.end || Date.parse(trip.end)-Date.parse(trip.start)>366*864e5 || trip.events.some(e=>e.date<trip.start || e.date>trip.end || (e.checkoutDate && e.checkoutDate<=e.date) || (e.lat===undefined)!==(e.lng===undefined)) || new Set(trip.events.map(e=>e.id)).size!==trip.events.length) throw new HttpError(400,"Stops must have unique IDs and dates within the trip.");
      const result = await db.prepare("UPDATE trips SET payload=?,version=version+1 WHERE id=? AND version=?").bind(JSON.stringify(trip),tripId,input.version).run();
      if (!result.meta.changes) {
        if(!await db.prepare("SELECT id FROM trips WHERE id=?").bind(tripId).first()) throw new HttpError(404,"Trip not found.");
        throw new HttpError(409,"This trip was updated in another session. Refresh the page before saving.");
      }
      return json({version:input.version+1});
    }
    if (route === "/documents" && method === "POST") {
      const selectedTrip = await db.prepare("SELECT * FROM trips WHERE id=?").bind(tripId).first<TripRow>();
      if(!selectedTrip) throw new HttpError(404,"Trip not found.");
      let form: FormData;
      try { form = await new Response(limitedBody(request,MAX_FILE+1024*1024),{headers:{"Content-Type":request.headers.get("content-type")||""}}).formData(); } catch(e) { if(e instanceof HttpError) throw e; throw new HttpError(400,"Choose a valid file to upload."); }
      const file = form.get("file");
      if (!file || typeof file === "string") throw new HttpError(400,"Choose a file first.");
      if (file.size>MAX_FILE) throw new HttpError(413,"Files must be 20 MB or smaller.");
      const b = new Uint8Array(await file.arrayBuffer());
      const ext = file.name.split(".").pop()?.toLowerCase();
      const ascii = (a:number,n:number) => new TextDecoder().decode(b.subarray(a,a+n));
      let mime="";
      if(ext==="pdf" && ascii(0,5)==="%PDF-") mime="application/pdf";
      if(["jpg","jpeg"].includes(ext||"") && b[0]===255 && b[1]===216 && b[2]===255) mime="image/jpeg";
      if(ext==="png" && [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)) mime="image/png";
      if(ext==="webp" && ascii(0,4)==="RIFF" && ascii(8,4)==="WEBP") mime="image/webp";
      if(["txt","eml"].includes(ext||"") && !b.includes(0)) mime=ext==="eml" ? "message/rfc822" : "text/plain";
      if(!mime) throw new HttpError(400,"Use a PDF, TXT, EML, PNG, JPEG or WebP file with matching contents.");
      const event = form.get("eventId"), eventId = typeof event==="string" && event ? event : null;
      const checkoutInput = form.get("checkoutTime");
      const stayProvided = ["stayStart","stayEnd","stayEvidence"].some(key=>form.has(key));
      const uploadInput = form.get("uploadId");
      const id = uploadInput===null ? crypto.randomUUID() : z.uuid().parse(uploadInput).toLowerCase();
      const name=file.name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g,"").slice(0,200)||"Document";
      if(uploadInput!==null) {
        const existing = await db.prepare("SELECT id,trip_id AS tripId,event_id AS eventId,name,mime,size FROM documents WHERE id=?").bind(id).first<DocRow & {tripId:string}>();
        if(existing) {
          if(existing.tripId!==tripId || existing.name!==name || existing.size!==file.size || existing.eventId!==eventId || existing.mime!==mime) throw new HttpError(409,"That upload was already saved with different details. Choose the file again to save a new copy.");
          const original = await bindings.BUCKET.get(`documents/${id}`);
          if(!original) throw new HttpError(500,"The saved file could not be opened. Please try again.");
          const originalBytes = new Uint8Array(await new Response(original.body as ReadableStream).arrayBuffer());
          if(originalBytes.length!==b.length || originalBytes.some((byte,index)=>byte!==b[index])) throw new HttpError(409,"That upload ID belongs to a different file. Choose the file again to save a new copy.");
          const current = checkoutInput || stayProvided ? await db.prepare("SELECT * FROM trips WHERE id=?").bind(tripId).first<TripRow>() : undefined;
          return json({id,name,eventId,size:file.size,mime,...(current ? {tripVersion:current.version} : {})});
        }
      }
      // Validate the requested target/details even when the bytes already exist.
      // A valid duplicate may bypass a stale edit version because no edit occurs.
      let bookingUpdate: {trip: Trip; version: number; checkout?: {evidence:string;time:string}; stay?: {start:string;end:string;evidence:string}} | undefined;
      if(eventId || checkoutInput || stayProvided) {
        const trip:Trip=JSON.parse(selectedTrip.payload);
        const stop=trip.events.find(stop=>stop.id===eventId);
        if(!stop) throw new HttpError(400,"That stop no longer exists.");
        if(checkoutInput || stayProvided) {
          if(stop.type!=="stay") throw new HttpError(400,"Attach hotel booking details to a hotel stay.");
          const version=z.coerce.number().int().positive().parse(form.get("version"));
          const stay=stayProvided ? z.object({start:z.iso.date(),end:z.iso.date(),evidence:z.string().trim().min(1).max(300)}).parse({start:form.get("stayStart"),end:form.get("stayEnd"),evidence:form.get("stayEvidence")}) : undefined;
          if(stay && (stay.start<trip.start || stay.end>trip.end || stay.end<=stay.start)) throw new HttpError(400,"Hotel arrival and checkout must fall within this trip, with checkout after arrival.");
          if(checkoutInput && !stop.checkoutDate && !stay) throw new HttpError(400,"Attach checkout details to an overnight hotel stay, or include its arrival and checkout dates.");
          const checkout=checkoutInput ? z.object({time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),evidence:z.string().trim().min(1).max(300)}).parse({time:checkoutInput,evidence:form.get("checkoutEvidence")}) : undefined;
          bookingUpdate={trip,version,checkout,stay};
        }
      }
      const hash=await documentHash(b);
      const duplicateResponse=async(document:SavedDocument)=>{
        const current=await db.prepare("SELECT * FROM trips WHERE id=?").bind(tripId).first<TripRow>();
        return json({...document,duplicate:true,tripVersion:current?.version ?? selectedTrip.version});
      };
      const duplicateCheck=await checkDocumentDuplicate(db,bindings.BUCKET,tripId,hash,file.size);
      if(duplicateCheck.duplicate) return await duplicateResponse(duplicateCheck.duplicate);
      if(duplicateCheck.unavailable) throw new HttpError(503,"An existing original is temporarily unavailable for duplicate checking. Please retry before adding this file.");
      if(duplicateCheck.pending) throw new HttpError(503,"We’re checking older originals for duplicates. Progress has been saved; retry this upload to finish checking.");
      const bookingIds=bookingStopIds(JSON.parse(selectedTrip.payload),eventId);
      let reviewedInput:unknown=[];
      if(form.has("reviewedDocumentIds")) {
        try { reviewedInput=JSON.parse(String(form.get("reviewedDocumentIds"))); }
        catch { throw new HttpError(400,"Review the existing documents before keeping both."); }
      }
      const reviewed=z.array(z.string().min(1).max(200)).max(1000).parse(reviewedInput);
      const existingBooking=await bookingDocuments(db,tripId,bookingIds);
      const conflictResponse=(documents:SavedDocument[])=>json({code:"document_conflict",error:"Another document is already attached to this booking. Review before adding.",conflicts:documents},409);
      if(existingBooking.some(document=>!reviewed.includes(document.id))) return conflictResponse(existingBooking);
      const guard=conflictGuard(tripId,bookingIds,reviewed);
      // Keeping another original never replaces the booking evidence already saved.
      const keepBoth=existingBooking.length>0;
      if(keepBoth) bookingUpdate=undefined;
      if(bookingUpdate && bookingUpdate.version!==selectedTrip.version) throw new HttpError(409,"Your trip changed while you were reviewing this booking. Close the upload and refresh before saving.");
      const stored = await bindings.BUCKET.put(`documents/${id}`,b,{httpMetadata:{contentType:mime},customMetadata:{[HOTEL_REVIEW_METADATA]:"1"},onlyIf:new Headers({"If-None-Match":"*"})});
      if(!stored) throw new HttpError(409,"This file is already being saved. Wait a moment and retry.");
      try {
        const insertSql="INSERT INTO documents (id,trip_id,event_id,name,mime,size) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM document_fingerprints WHERE trip_id=? AND sha256=?)"+guard.sql;
        const insertArgs=[id,tripId,eventId,name,mime,file.size,tripId,hash,...guard.args];
        const fingerprint=db.prepare("INSERT INTO document_fingerprints (document_id,trip_id,sha256) SELECT id,trip_id,? FROM documents WHERE id=? AND trip_id=?").bind(hash,id,tripId);
        let inserted=false;
        if(bookingUpdate) {
          const {trip,version,checkout,stay} = bookingUpdate;
          const originalStay=trip.events.find(stop=>stop.id===eventId)!;
          const reminders=stay && originalStay.checkoutDate && stay.end!==originalStay.checkoutDate
            ? trip.events.filter(stop=>/\bcheck[\s\u2010-\u2015-]*out\b/i.test(`${stop.title} ${stop.notes}`)
              && checkoutStayForReminder(stop,trip.events)?.id===eventId) : [];
          trip.events = trip.events.map(stop => stop.id===eventId ? {...stop,
            ...(stay ? {date:stay.start,checkoutDate:stay.end,staySource:{...stay,source:"booking" as const,documentId:id,documentName:name}} : {}),
            ...(checkout ? {checkout:{...checkout,source:"booking" as const,documentId:id,documentName:name}} : {}),
          } : stop);
          // Only a unique, explicit checkout reminder follows a changed stay end.
          // Preserve its clock and leave transports or ambiguous hotel visits alone.
          if(stay && reminders.length===1) {
            const moved={...reminders[0],date:stay.end};
            const proposed=trip.events.map(stop=>stop.id===moved.id ? moved : stop);
            if(checkoutStayForReminder(moved,proposed)?.id===eventId) trip.events=proposed;
          }
          // Both metadata and itinerary details commit together; a concurrent trip edit
          // prevents the insert so a retry cannot leave a duplicate booking behind.
          const results = await db.batch([
            db.prepare(insertSql+" AND EXISTS (SELECT 1 FROM trips WHERE id=? AND version=?)").bind(...insertArgs,tripId,version),
            fingerprint,
            db.prepare("UPDATE trips SET payload=?,version=version+1 WHERE id=? AND version=? AND EXISTS (SELECT 1 FROM documents WHERE id=?)").bind(JSON.stringify(trip),tripId,version,id),
          ]);
          inserted=!!results[0].meta.changes;
        } else {
          const results=await db.batch([db.prepare(insertSql).bind(...insertArgs),fingerprint]);
          inserted=!!results[0].meta.changes;
        }
        if(!inserted) {
          await bindings.BUCKET.delete(`documents/${id}`);
          const winner=await indexedDuplicate(db,tripId,hash);
          if(winner) return await duplicateResponse(winner);
          const currentBooking=await bookingDocuments(db,tripId,bookingIds);
          if(currentBooking.some(document=>!reviewed.includes(document.id))) return conflictResponse(currentBooking);
          throw new HttpError(409,"Your trip changed while this booking was saving. Refresh and try again.");
        }
      }
      catch(e) { await bindings.BUCKET.delete(`documents/${id}`); throw e; }
      return json({id,name,eventId,size:file.size,mime,...(keepBoth ? {keptBoth:true} : {}),...(bookingUpdate ? {tripVersion:bookingUpdate.version+1} : {})},201);
    }
    const docId = /^\/documents\/([\w-]+)$/.exec(route)?.[1];
    if(docId && ["GET","DELETE"].includes(method)) {
      const doc=await db.prepare("SELECT id,name,mime,size FROM documents WHERE id=? AND trip_id=?").bind(docId,tripId).first<DocRow>();
      if(!doc) throw new HttpError(404,"Document not found.");
      if(method==="DELETE") {
        await bindings.BUCKET.delete(`documents/${doc.id}`);
        await db.batch([
          db.prepare("DELETE FROM document_fingerprints WHERE document_id=? AND trip_id=?").bind(doc.id,tripId),
          db.prepare("DELETE FROM documents WHERE id=? AND trip_id=?").bind(doc.id,tripId),
        ]);
        return json({ok:true});
      }
      const object = await bindings.BUCKET.get(`documents/${doc.id}`);
      if(!object) throw new HttpError(404,"Document not found.");
      const email = /\.eml$/i.test(doc.name) || doc.mime==="message/rfc822";
      if(email && url.searchParams.has("attachment")) {
        const attachmentInput=url.searchParams.get("attachment")!;
        if(!/^\d{1,4}$/.test(attachmentInput)) throw new HttpError(404,"Attachment not found.");
        const attachment=await readEmailAttachment(await new Response(object.body as ReadableStream).arrayBuffer(),Number(attachmentInput));
        if(!attachment) throw new HttpError(404,"Attachment not found.");
        const name=attachment.name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g,"").slice(0,200)||"Attachment";
        return new Response(new Uint8Array(attachment.bytes).buffer,{headers:{"Content-Type":attachment.mime,"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(name)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox","Referrer-Policy":"no-referrer"}});
      }
      if(email && url.searchParams.get("download")!=="1") {
        const downloadUrl=`/api/documents/${encodeURIComponent(doc.id)}?${new URLSearchParams({tripId,download:"1"})}`;
        return buildEmailPreview({name:doc.name,raw:await new Response(object.body as ReadableStream).arrayBuffer(),downloadUrl,loadRemoteImages:url.searchParams.get("images")==="1"});
      }
      return new Response(object.body as ReadableStream,{headers:{"Content-Type":email ? "message/rfc822" : doc.mime,"Content-Disposition":`${email ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox","Referrer-Policy":"same-origin"}});
    }
    throw new HttpError(404,"Not found.");
  } catch(error) {
    if(error instanceof HttpError) return json({error:error.message},error.status);
    if(error instanceof z.ZodError) return json({error:error.issues[0]?.message||"Check your details."},400);
    console.error("Wayfarer API error",error);
    return json({error:"Something went wrong. Please try again."},500);
  }
}
