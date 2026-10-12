import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleApi } from "../server/api";
import { seed } from "../src/seed";
import type { Trip, Document } from "../src/model";
import { checkoutStayForReminder } from "../src/hotel-checkout";

const owner = {userId:"test-owner",displayName:"Traveler",email:"traveler@example.test"};
const NEW_ID = "65d7c8bf-508d-4e41-9d35-f8d0a28a25db";
const OTHER_ID = "1bc0a7ce-c265-477b-9a8e-5a2f2b54a977";
const input = {id:NEW_ID,title:"Japan in spring",start:"2027-04-10",end:"2027-04-19"};
type Snapshot = {id:string;trip:Trip;version:number;documents:Document[];members:{name:string}[]};
const jsonBody = (body:unknown,method="POST") => ({method,headers:{"Content-Type":"application/json",origin:"https://wayfarer.test"},body:JSON.stringify(body)});

function workspace() {
  const sqlite = new DatabaseSync(":memory:");
  for(const name of readdirSync("drizzle").filter(n=>n.endsWith(".sql")).sort()) sqlite.exec(readFileSync(`drizzle/${name}`,"utf8"));
  const prepare = (sql:string, args:any[]=[]):any => ({
    bind:(...values:any[])=>prepare(sql,values),
    first:async()=>sqlite.prepare(sql).get(...args)||null,
    all:async()=>({results:sqlite.prepare(sql).all(...args)}),
    run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}),
  });
  const DB = {prepare,batch:async (items:any[])=>{sqlite.exec("BEGIN");try{const values=[];for(const s of items) values.push(await s.run());sqlite.exec("COMMIT");return values;}catch(e){sqlite.exec("ROLLBACK");throw e;}}};
  const objects=new Map<string,Uint8Array>();
  const BUCKET={put:async(k:string,v:Uint8Array,options?:{onlyIf?:Headers})=>{
    if(options?.onlyIf?.get("If-None-Match")==="*" && objects.has(k)) return null;
    objects.set(k,v);return {key:k};
  },get:async(k:string)=>objects.has(k)?{body:new Response(new Uint8Array(objects.get(k)!).buffer).body}:null,delete:async(k:string)=>{objects.delete(k);}};
  const call=(path:string,init:RequestInit={},who:typeof owner|null=owner)=>handleApi(new Request(`https://wayfarer.test/api${path}`,init),{DB,BUCKET} as any,who);
  const read = async (id?:string): Promise<Snapshot> => (await call(`/trip${id ? `?tripId=${id}` : ""}`)).json();
  return {call,read,objects,sqlite,close:()=>sqlite.close()};
}

function documentForm(eventId?:string) {
  const form=new FormData();
  form.set("file",new File(["A private booking confirmation"],"booking.txt"));
  if(eventId) form.set("eventId",eventId);
  return form;
}

test("new trips persist with no imported California stops and creation retries never duplicate them",async()=>{
  const w=workspace();try {
    const california=await w.read();
    assert.equal(california.id,"california");
    const created=await w.call("/trips",jsonBody(input));
    assert.equal(created.status,201);
    assert.deepEqual(await created.json(),{id:NEW_ID});
    const trip=await w.read(NEW_ID);
    assert.equal(trip.id,NEW_ID);
    assert.deepEqual(trip.trip,{title:input.title,start:input.start,end:input.end,events:[],routeRevision:1});
    assert.equal(trip.version,1);
    assert.deepEqual(trip.documents,[]);
    assert.deepEqual(trip.members,california.members);
    assert.equal((await w.call("/trips",jsonBody(input))).status,200);
    assert.equal((await w.call("/trips",jsonBody({...input,id:NEW_ID.toUpperCase()}))).status,200);
    assert.equal((await w.call("/trips",jsonBody({...input,title:"Conflicting retry"}))).status,409);
    assert.equal((await w.call("/trips",jsonBody({...input,end:"2027-04-20"}))).status,409);
    const collection:any=await (await w.call("/trips")).json();
    assert.equal(collection.trips.length,2);
    assert.deepEqual(collection.trips.find((item:any)=>item.id===NEW_ID),{...input,stopCount:0,documentCount:0});
    assert.deepEqual(await w.read(),california);
  }finally{w.close();}
});

test("trip edits and version conflicts are independent and unknown IDs never fall back to California",async()=>{
  const w=workspace();try {
    const california=await w.read();
    await w.call("/trips",jsonBody(input));
    const created=await w.read(NEW_ID);
    const updated={...created.trip,title:"Kyoto and Tokyo",events:[{id:"flight-out",date:input.start,time:"09:00",title:"Fly to Tokyo",type:"flight",status:"planned",location:"ORD → HND",notes:"New trip only"}]};
    const request=jsonBody({trip:updated,version:created.version},"PUT");
    assert.equal((await w.call(`/trip?tripId=${NEW_ID}`,request)).status,200);
    assert.equal((await w.call(`/trip?tripId=${NEW_ID}`,request)).status,409);
    const saved=await w.read(NEW_ID);
    assert.equal(saved.version,2);
    assert.equal(saved.trip.events[0].notes,"New trip only");
    assert.deepEqual(await w.read(),california);
    assert.equal((await w.call(`/trip?tripId=${OTHER_ID}`)).status,404);
    assert.equal((await w.call("/trip?tripId=")).status,404);
    assert.equal((await w.call(`/trip?tripId=${OTHER_ID}`,request)).status,404);
    assert.equal((await w.call(`/documents?tripId=${OTHER_ID}`,{method:"POST",body:documentForm()})).status,404);
    assert.equal(w.objects.size,0);
  }finally{w.close();}
});

test("documents belong only to the selected trip and links cannot cross trip boundaries",async()=>{
  const w=workspace();try {
    await w.call("/trips",jsonBody(input));
    const invalid=await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:documentForm("flight-out")});
    assert.equal(invalid.status,400,"California's stop is not a stop in this new trip");
    const originalDoc:any=await (await w.call("/documents",{method:"POST",body:documentForm("flight-out")})).json();
    const newDoc:any=await (await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:documentForm()})).json();
    assert.equal(newDoc.tripVersion,undefined,"Document-only uploads don't advance itinerary version");
    assert.equal((await w.read(NEW_ID)).documents.length,1);
    assert.equal((await w.read()).documents[0].id,originalDoc.id);
    assert.equal((await w.call(`/documents/${newDoc.id}`)).status,404);
    assert.equal((await w.call(`/documents/${originalDoc.id}?tripId=${NEW_ID}`)).status,404);
    assert.equal((await w.call(`/documents/${newDoc.id}?tripId=${OTHER_ID}`)).status,404);
    assert.equal((await w.call(`/documents/${newDoc.id}?tripId=${NEW_ID}`)).status,200);
    assert.equal((await w.call(`/documents/${newDoc.id}`,{method:"DELETE"})).status,404);
    assert.equal((await w.call(`/documents/${newDoc.id}?tripId=${NEW_ID}`,{method:"DELETE"})).status,200);
    assert.equal((await w.read(NEW_ID)).documents.length,0);
    assert.equal((await w.call(`/documents/${originalDoc.id}`)).status,200);
    const collection:any=await (await w.call("/trips")).json();
    assert.equal(collection.trips.find((trip:any)=>trip.id==="california").documentCount,1);
    assert.equal(collection.trips.find((trip:any)=>trip.id===NEW_ID).documentCount,0);
  }finally{w.close();}
});

test("hotel checkout and duplicate uploads are scoped to the selected trip",async()=>{
  const w=workspace();try {
    const california=await w.read();
    await w.call("/trips",jsonBody(input));
    const fresh=await w.read(NEW_ID);
    const stay={id:"burbank",date:input.start,checkoutDate:input.end,time:"15:00",title:"Kyoto stay",type:"stay",status:"reported",location:"Kyoto Hotel",notes:"This is not Hotel Burbank"};
    await w.call(`/trip?tripId=${NEW_ID}`,jsonBody({trip:{...fresh.trip,events:[stay]},version:fresh.version},"PUT"));
    const before=await w.read(NEW_ID);
    const form=documentForm("burbank");
    form.set("checkoutTime","10:00");form.set("checkoutEvidence","Check-out: 10 AM");form.set("version",String(before.version));
    const response=await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form});
    assert.equal(response.status,201);
    const saved:any=await response.json();
    assert.equal(saved.tripVersion,before.version+1);
    assert.equal((await w.read(NEW_ID)).trip.events[0].checkout?.documentId,saved.id);
    assert.equal((await w.read(NEW_ID)).trip.events[0].checkout?.time,"10:00");
    const duplicate=await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form});
    assert.equal(duplicate.status,200);assert.equal((await duplicate.json() as any).duplicate,true);
    assert.equal(w.objects.size,1);
    form.set("version",String(saved.tripVersion));form.set("checkoutTime","11:00");form.set("checkoutEvidence","Check-out: 11 AM");
    const next:any=await (await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form})).json();
    assert.equal(next.tripVersion,saved.tripVersion);
    assert.equal(next.duplicate,true);
    assert.equal((await w.read(NEW_ID)).trip.events[0].checkout?.time,"10:00");
    assert.deepEqual(await w.read(),california);
    const collection:any=await (await w.call("/trips")).json();
    assert.equal(collection.trips.find((trip:any)=>trip.id===NEW_ID).stopCount,1);
    assert.equal(collection.trips.find((trip:any)=>trip.id===NEW_ID).documentCount,1);
  }finally{w.close();}
});

test("trip creation validates dates, title and retry identifier without creating rejected rows",async()=>{
  const w=workspace();try {
    for(const invalid of [
      {...input,title:"   "}, {...input,title:"a".repeat(201)}, {...input,id:"california"},
      {...input,start:"2027-02-30"}, {...input,start:"not-a-date"}, {...input,end:"2027-04-09"},
      {...input,end:"2028-04-11"}, {...input,id:undefined},
    ]) assert.equal((await w.call("/trips",jsonBody(invalid))).status,400,JSON.stringify(invalid));
    const collection:any=await (await w.call("/trips")).json();
    assert.equal(collection.trips.length,1);
    assert.equal((await w.call("/trips",jsonBody({...input,end:input.start}))).status,201,"A single-day trip is valid");
  }finally{w.close();}
});

test("new trips retain their own route data and share existing private workspace admission",async()=>{
  const w=workspace();try {
    assert.equal((await w.call("/trips",{},null)).status,401);
    assert.equal((await w.call("/trips",{...jsonBody(input),headers:{origin:"https://other.test"}})).status,403);
    await w.call("/trips",jsonBody({...input,start:seed.start,end:seed.end}));
    const fresh=await w.read(NEW_ID);
    const {routeRevision,...custom}=structuredClone(seed);
    await w.call(`/trip?tripId=${NEW_ID}`,jsonBody({trip:custom,version:fresh.version},"PUT"));
    const after=await w.read(NEW_ID);
    assert.equal(after.trip.routeRevision,undefined,"The California-specific upgrade must not run on another trip");
    assert.deepEqual(after.trip.events,JSON.parse(JSON.stringify(custom.events)));
    assert.equal((await w.call(`/trip?tripId=${NEW_ID}`,{}, {...owner,userId:"second"})).status,200);
    assert.equal((await w.call(`/trip?tripId=${NEW_ID}`,{}, {...owner,userId:"third"})).status,403);
    assert.equal((await w.call("/trips",{}, {...owner,userId:"third"})).status,403);
  }finally{w.close();}
});

test("upload IDs make retries idempotent and reject changed files or cross-trip reuse",async()=>{
  const w=workspace();try {
    await w.call("/trips",jsonBody(input));
    const form=documentForm();form.set("uploadId",OTHER_ID);
    const first=await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form});
    assert.equal(first.status,201);
    assert.equal((await first.json() as {id:string}).id,OTHER_ID);
    assert.equal((await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form})).status,200);
    assert.equal((await w.read(NEW_ID)).documents.length,1);
    assert.equal(w.objects.size,1);
    assert.equal((await w.call("/documents",{method:"POST",body:form})).status,409);
    form.set("file",new File(["B private booking confirmation"],"booking.txt"));
    assert.equal((await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form})).status,409,"Same name and size with different bytes is not a retry");
    form.set("uploadId","not-a-uuid");
    assert.equal((await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form})).status,400);
    assert.equal(await (await w.call(`/documents/${OTHER_ID}?tripId=${NEW_ID}`)).text(),"A private booking confirmation");
    assert.equal((await w.read()).documents.length,0);
  }finally{w.close();}
});

test("checkout upload retries bypass stale versions without reapplying changed checkout details",async()=>{
  const w=workspace();try {
    const initial=await w.read();
    const form=documentForm("burbank");form.set("uploadId",OTHER_ID);
    form.set("checkoutTime","10:00");form.set("checkoutEvidence","Check-out at 10 AM");form.set("version",String(initial.version));
    const first:any=await (await w.call("/documents",{method:"POST",body:form})).json();
    assert.equal(first.tripVersion,initial.version+1);
    const saved=await w.read();
    saved.trip.events.find(stop=>stop.id==="burbank")!.checkout={time:"12:00",source:"manual"};
    await w.call("/trip",jsonBody({trip:saved.trip,version:saved.version},"PUT"));
    const retry=await w.call("/documents",{method:"POST",body:form});
    assert.equal(retry.status,200);
    assert.equal((await retry.json() as {tripVersion:number}).tripVersion,saved.version+1);
    const current=await w.read();
    assert.equal(current.trip.events.find(stop=>stop.id==="burbank")?.checkout?.time,"12:00");
    assert.equal(current.documents.length,1);
  }finally{w.close();}
});

test("a simultaneous upload cannot overwrite or remove an object with the same upload ID",async()=>{
  const w=workspace();try {
    await w.call("/trips",jsonBody(input));
    const pending=new TextEncoder().encode("File being saved by another request");
    w.objects.set(`documents/${OTHER_ID}`,pending);
    const form=documentForm();form.set("uploadId",OTHER_ID);
    assert.equal((await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form})).status,409);
    assert.deepEqual(w.objects.get(`documents/${OTHER_ID}`),pending);
    assert.equal((await w.read(NEW_ID)).documents.length,0);
  }finally{w.close();}
});

test("email documents open as readable private previews and retain the exact original download",async()=>{
  const w=workspace();try {
    await w.call("/trips",jsonBody(input));
    const raw="From: Hotel <reservations@example.test>\r\nTo: Traveler <traveler@example.test>\r\nSubject: Your hotel booking\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nReservation confirmed.\r\nCheck-out: 11 AM\r\nThank you =E2=80=94 see you soon.\r\n";
    const form=new FormData();form.set("file",new File([raw],"booking.eml"));
    const saved:any=await (await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form})).json();
    assert.equal(saved.mime,"message/rfc822");
    const path=`/documents/${saved.id}?tripId=${NEW_ID}`;
    const preview=await w.call(path);
    assert.match(preview.headers.get("content-type")||"",/text\/html/);
    assert.equal(preview.headers.get("cache-control"),"private, no-store");
    const html=await preview.text();
    assert.match(html,/Your hotel booking/);
    assert.match(html,/see you soon/);
    assert.doesNotMatch(html,/=E2=80=94/);
    assert.match(html,/download=1/);
    const original=await w.call(`${path}&download=1`);
    assert.equal(original.headers.get("content-type"),"message/rfc822");
    assert.match(original.headers.get("content-disposition")||"",/^attachment;/);
    assert.equal(await original.text(),raw);
    assert.equal((await w.call(`/documents/${saved.id}`)).status,404);
    assert.equal((await w.call(`${path}&download=1`,{},null)).status,401);
    w.sqlite.prepare("UPDATE documents SET mime='text/plain' WHERE id=?").run(saved.id);
    assert.match((await w.call(path)).headers.get("content-type")||"",/text\/html/,"Previously uploaded .eml files also get the readable view");
  }finally{w.close();}
});

test("reviewed stay dates and checkout save atomically on a hotel missing its stay range",async()=>{
  const w=workspace();try {
    await w.call("/trips",jsonBody(input));
    const snapshot=await w.read(NEW_ID);
    const hotel={id:"kyoto",date:input.start,time:"",title:"Kyoto hotel",type:"stay",status:"planned",location:"Kyoto Hotel",notes:"Awaiting booking"};
    await w.call(`/trip?tripId=${NEW_ID}`,jsonBody({trip:{...snapshot.trip,events:[hotel]},version:snapshot.version},"PUT"));
    const before=await w.read(NEW_ID);
    const form=documentForm(hotel.id);form.set("uploadId",OTHER_ID);
    form.set("stayStart","2027-04-11");form.set("stayEnd","2027-04-15");form.set("stayEvidence","Check-in April 11, 2027; Check-out April 15, 2027");
    form.set("checkoutTime","10:00");form.set("checkoutEvidence","Check-out by 10 AM");form.set("version",String(before.version));
    const response=await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form});
    assert.equal(response.status,201);
    const document:any=await response.json();
    const after=await w.read(NEW_ID), saved=after.trip.events[0];
    assert.equal(saved.date,"2027-04-11");assert.equal(saved.checkoutDate,"2027-04-15");assert.equal(saved.checkout?.time,"10:00");
    assert.equal(saved.staySource?.documentId,document.id);
    assert.equal(saved.staySource?.evidence,"Check-in April 11, 2027; Check-out April 15, 2027");
    assert.equal(saved.notes,hotel.notes);assert.equal(after.trip.events.length,1);
    assert.equal(after.version,before.version+1);
    assert.equal(document.tripVersion,after.version);
    assert.equal((await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form})).status,200);
    assert.equal((await w.read(NEW_ID)).documents.length,1);
  }finally{w.close();}
});

test("invalid or stale stay date proposals save neither a document nor itinerary changes",async()=>{
  const w=workspace();try {
    const before=await w.read();
    for(const [start,end] of [["2026-12-17","2026-12-21"],["2026-12-18","2026-12-26"],["2026-12-21","2026-12-18"],["2026-12-18","2026-12-18"],["2026-02-30","2026-12-21"]]) {
      const form=documentForm("burbank");form.set("stayStart",start);form.set("stayEnd",end);form.set("stayEvidence","Printed dates");form.set("version",String(before.version));
      assert.equal((await w.call("/documents",{method:"POST",body:form})).status,400);
    }
    const form=documentForm("burbank");form.set("stayStart","2026-12-18");form.set("stayEnd","2026-12-21");form.set("stayEvidence","Printed dates");form.set("version",String(before.version));
    await w.call("/trip",jsonBody({trip:{...before.trip,title:"Changed elsewhere"},version:before.version},"PUT"));
    assert.equal((await w.call("/documents",{method:"POST",body:form})).status,409);
    assert.equal(w.objects.size,0);
    const after=await w.read();assert.equal(after.documents.length,0);assert.equal(after.trip.events.find(stop=>stop.id==="burbank")?.staySource,undefined);
  }finally{w.close();}
});

test("email ticket attachments remain private and can be opened as PDF or image documents",async()=>{
  const w=workspace();try {
    await w.call("/trips",jsonBody(input));
    const pdf=Buffer.from("%PDF-1.4\nTicket barcode document\n%%EOF");
    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4foAAAAASUVORK5CYII=","base64");
    const raw=["From: Tickets <tickets@example.test>","Subject: Ticket attachments","MIME-Version: 1.0","Content-Type: multipart/mixed; boundary=tickets","","--tickets","Content-Type: text/plain","","Your ticket is attached.","--tickets","Content-Type: application/pdf","Content-Disposition: attachment; filename=admission.pdf","Content-Transfer-Encoding: base64","",pdf.toString("base64"),"--tickets","Content-Type: image/png","Content-Disposition: attachment; filename=barcode.png","Content-Transfer-Encoding: base64","",png.toString("base64"),"--tickets--",""].join("\r\n");
    const form=new FormData();form.set("file",new File([raw],"tickets.eml"));
    const document:any=await (await w.call(`/documents?tripId=${NEW_ID}`,{method:"POST",body:form})).json();
    const path=`/documents/${document.id}?tripId=${NEW_ID}`;
    for(const [index,mime,bytes] of [[0,"application/pdf",pdf],[1,"image/png",png]] as const) {
      const response=await w.call(`${path}&attachment=${index}`);
      assert.equal(response.status,200);
      assert.equal(response.headers.get("content-type"),mime);
      assert.equal(response.headers.get("cache-control"),"private, no-store");
      assert.equal(response.headers.get("x-content-type-options"),"nosniff");
      assert.match(response.headers.get("content-security-policy")||"",/sandbox/);
      assert.match(response.headers.get("content-disposition")||"",/^inline;/);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(bytes));
    }
    assert.equal((await w.call(`${path}&attachment=999`)).status,404);
    assert.equal((await w.call(`${path}&attachment=-1`)).status,404);
    assert.equal((await w.call(`/documents/${document.id}?attachment=0`)).status,404);
    assert.equal((await w.call(`${path}&attachment=0`,{},null)).status,401);
  }finally{w.close();}
});

test("a reviewed checkout date moves only its unambiguous hotel reminder and preserves departure clocks",async()=>{
  const w=workspace();try {
    const initial=await w.read();
    const reminder=initial.trip.events.find(stop=>stop.id==="checkout")!;
    const transfer={...reminder,id:"checkout-transfer",type:"drive" as const,title:"Checkout transfer",time:"06:00"};
    const unrelated={...reminder,id:"other-checkout",location:"Another Hotel"};
    initial.trip.events.push(transfer,unrelated);
    await w.call("/trip",jsonBody({trip:initial.trip,version:initial.version},"PUT"));
    const before=await w.read();
    const form=documentForm("burbank");form.set("stayStart","2026-12-18");form.set("stayEnd","2026-12-20");form.set("stayEvidence","Check-in December 18; Check-out December 20");form.set("version",String(before.version));
    assert.equal((await w.call("/documents",{method:"POST",body:form})).status,201);
    const after=await w.read();
    const moved=after.trip.events.find(stop=>stop.id===reminder.id)!;
    assert.equal(moved.date,"2026-12-20");
    assert.equal(moved.time,reminder.time);
    assert.equal(moved.notes,reminder.notes);
    assert.equal(checkoutStayForReminder(moved,after.trip.events)?.id,"burbank");
    assert.deepEqual(after.trip.events.find(stop=>stop.id===transfer.id),transfer);
    assert.deepEqual(after.trip.events.find(stop=>stop.id===unrelated.id),unrelated);
    assert.ok(after.trip.events.every(stop=>stop.date>=after.trip.start && stop.date<=after.trip.end));
  }finally{w.close();}
});

test("ambiguous checkout reminders stay on their original dates when a hotel booking changes",async()=>{
  for(const ambiguity of ["overlapping stay","duplicate reminder"] as const) {
    const w=workspace();try {
      const initial=await w.read();
      const hotel=initial.trip.events.find(stop=>stop.id==="burbank")!;
      const reminder=initial.trip.events.find(stop=>stop.id==="checkout")!;
      initial.trip.events.push(ambiguity==="overlapping stay" ? {...hotel,id:"other-reservation"} : {...reminder,id:"other-reminder"});
      await w.call("/trip",jsonBody({trip:initial.trip,version:initial.version},"PUT"));
      const before=await w.read();
      const form=documentForm(hotel.id);form.set("stayStart","2026-12-18");form.set("stayEnd","2026-12-20");form.set("stayEvidence","Check-out December 20");form.set("version",String(before.version));
      assert.equal((await w.call("/documents",{method:"POST",body:form})).status,201);
      const after=await w.read();
      assert.equal(after.trip.events.find(stop=>stop.id===hotel.id)?.checkoutDate,"2026-12-20");
      assert.equal(after.trip.events.find(stop=>stop.id===reminder.id)?.date,"2026-12-21",ambiguity);
      if(ambiguity==="duplicate reminder") assert.equal(after.trip.events.find(stop=>stop.id==="other-reminder")?.date,"2026-12-21");
    }finally{w.close();}
  }
});
