import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleApi } from "../server/api";
import { HOTEL_REVIEW_METADATA, recoverLegacyHotelEvidence } from "../server/hotel-evidence-backfill";
import type { Document, Trip } from "../src/model";
import { seed } from "../src/seed";

const email=(end="2026-12-21",time="11:00AM")=>`Subject: Hotel reservation confirmed\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nCheck-in\n\n2026-12-18\n\n3:00PM\n\nCheck-out\n\n${end}\n\n${time}`;
const owner={userId:"backfill-owner",displayName:"Traveler",email:"traveler@example.test"};
const savedDocument:Document={id:"legacy-hotel",eventId:"burbank",name:"old-confirmation.eml",size:email().length,mime:"text/plain"};

function workspace() {
  const sqlite=new DatabaseSync(":memory:");
  for(const name of readdirSync("drizzle").filter(name=>name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(`drizzle/${name}`,"utf8"));
  const prepare=(sql:string,args:any[]=[]):any=>({bind:(...values:any[])=>prepare(sql,values),first:async()=>sqlite.prepare(sql).get(...args)||null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}})});
  const DB={prepare,batch:async(items:any[])=>{sqlite.exec("BEGIN");try{const results=[];for(const item of items) results.push(await item.run());sqlite.exec("COMMIT");return results;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  const objects=new Map<string,{bytes:Uint8Array;customMetadata?:Record<string,string>}>();
  let reads=0, beforeRead:(()=>void)|undefined;
  const BUCKET={
    put:async(key:string,bytes:Uint8Array,options:any)=>{if(objects.has(key))return null;objects.set(key,{bytes,customMetadata:options?.customMetadata});return {key};},
    get:async(key:string)=>{reads++;const hook=beforeRead;beforeRead=undefined;hook?.();const object=objects.get(key);return object?{size:object.bytes.length,customMetadata:object.customMetadata,body:new Response(new Uint8Array(object.bytes).buffer).body}:null;},
    delete:async(key:string)=>{objects.delete(key);},
  };
  const call=(path:string,options:RequestInit={})=>handleApi(new Request(`https://wayfarer.test/api${path}`,options),{DB,BUCKET} as any,owner);
  const read=async()=>await (await call("/trip")).json() as {id:string;trip:Trip;version:number;documents:Document[]};
  const legacy=(document=savedDocument,text=email())=>{
    sqlite.prepare("INSERT INTO documents (id,trip_id,event_id,name,mime,size) VALUES (?,?,?,?,?,?)").run(document.id,"california",document.eventId,document.name,document.mime,new TextEncoder().encode(text).length);
    objects.set(`documents/${document.id}`,{bytes:new TextEncoder().encode(text)});
  };
  return {call,read,legacy,sqlite,objects,BUCKET,setBeforeRead:(hook:()=>void)=>{beforeRead=hook;},get reads(){return reads;},close:()=>sqlite.close()};
}

test("one legacy hotel email recovers explicit evidence once without moving any itinerary data",async()=>{
  const w=workspace();try {
    const before=await w.read();w.legacy();
    const after=await w.read();
    const original=before.trip.events.find(stop=>stop.id==="burbank")!;
    const hotel=after.trip.events.find(stop=>stop.id==="burbank")!;
    assert.equal(after.version,before.version+1);
    assert.deepEqual(hotel.checkout,{time:"11:00",evidence:"Check-out 2026-12-21 11:00AM",source:"booking",documentId:savedDocument.id,documentName:savedDocument.name});
    assert.equal(hotel.staySource?.start,"2026-12-18");assert.equal(hotel.staySource?.end,"2026-12-21");
    const {checkout,staySource,...unchanged}=hotel;
    assert.deepEqual(unchanged,original);
    assert.deepEqual(after.trip.events.filter(stop=>stop.id!==hotel.id),before.trip.events.filter(stop=>stop.id!==hotel.id));
    const again=await w.read();assert.equal(again.version,after.version);assert.equal(w.reads,1);
  }finally{w.close();}
});

test("legacy recovery preserves saved manual or booking evidence and mismatched stay dates",async()=>{
  for(const existing of ["manual","booking","staySource","wrongDates"] as const) {
    const w=workspace();try {
      const before=await w.read();
      const hotel=before.trip.events.find(stop=>stop.id==="burbank")!;
      if(existing==="manual" || existing==="booking") hotel.checkout={time:"13:00",source:existing};
      if(existing==="staySource") hotel.staySource={start:hotel.date,end:hotel.checkoutDate!,source:"booking",documentId:"known-document",documentName:"known.pdf",evidence:"Existing reviewed dates"};
      w.sqlite.prepare("UPDATE trips SET payload=? WHERE id='california'").run(JSON.stringify(before.trip));
      w.legacy(savedDocument,email(existing==="wrongDates"?"2026-12-22":"2026-12-21"));
      const after=await w.read();assert.equal(after.version,before.version,existing);assert.deepEqual(after.trip,before.trip,existing);
    }finally{w.close();}
  }
});

test("conflicting attached bookings are not guessed and legacy reads stay bounded",async()=>{
  const w=workspace();try {
    const before=await w.read();w.legacy();w.legacy({...savedDocument,id:"second-booking"},email("2026-12-21","12:00PM"));
    assert.deepEqual((await w.read()).trip,before.trip);assert.equal(w.reads,0);
  }finally{w.close();}
  const hotel=seed.events.find(stop=>stop.id==="burbank")!;
  const trip:Trip={...seed,events:Array.from({length:4},(_,index)=>({...hotel,id:`stay-${index}`}))};
  const documents=trip.events.map((stay,index)=>({...savedDocument,id:`doc-${index}`,eventId:stay.id}));
  let reads=0;
  const bucket={get:async()=>{reads++;return{size:email().length,body:new Response(email()).body};}} as unknown as R2Bucket;
  const recovered=await recoverLegacyHotelEvidence(trip,documents,bucket);
  assert.equal(reads,3);assert.equal(recovered?.sources.length,3);
  reads=0;
  assert.equal(await recoverLegacyHotelEvidence(trip,[{...documents[0],size:1024*1024+1}],bucket),undefined);assert.equal(reads,0);
  const oversized={get:async()=>({size:1024*1024+1,body:new Response("not read").body})} as unknown as R2Bucket;
  assert.equal(await recoverLegacyHotelEvidence(trip,[documents[0]],oversized),undefined);
});

test("new uploads with unchecked hotel proposals are never backfilled",async()=>{
  const w=workspace();try {
    const before=await w.read();
    const form=new FormData();form.set("file",new File([email()],"reviewed-email.eml"));form.set("eventId","burbank");
    const response=await w.call("/documents",{method:"POST",body:form});assert.equal(response.status,201);
    const document=await response.json() as Document;
    assert.equal(w.objects.get(`documents/${document.id}`)?.customMetadata?.[HOTEL_REVIEW_METADATA],"1");
    const after=await w.read();assert.equal(after.version,before.version);assert.deepEqual(after.trip,before.trip);
  }finally{w.close();}
});

test("a concurrent manual edit wins over legacy recovery",async()=>{
  const w=workspace();try {
    const before=await w.read();w.legacy();
    w.setBeforeRead(()=>{
      const manual=structuredClone(before.trip);manual.events.find(stop=>stop.id==="burbank")!.checkout={time:"14:00",source:"manual"};
      w.sqlite.prepare("UPDATE trips SET payload=?,version=version+1 WHERE id='california'").run(JSON.stringify(manual));
    });
    const after=await w.read();
    assert.equal(after.version,before.version+1);
    assert.deepEqual(after.trip.events.find(stop=>stop.id==="burbank")?.checkout,{time:"14:00",source:"manual"});
    assert.equal(after.trip.events.find(stop=>stop.id==="burbank")?.staySource,undefined);
  }finally{w.close();}
});

test("a concurrent competing attachment prevents a backfill even without a trip version change",async()=>{
  const w=workspace();try {
    const before=await w.read();w.legacy();
    w.setBeforeRead(()=>w.legacy({...savedDocument,id:"concurrent-booking"},email("2026-12-21","12:00PM")));
    const after=await w.read();assert.equal(after.version,before.version);assert.deepEqual(after.trip,before.trip);assert.equal(after.documents.length,2);
  }finally{w.close();}
});
