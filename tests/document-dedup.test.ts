import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleApi } from "../server/api";
import { documentHash } from "../server/document-dedup";

const owner={userId:"dedup-owner",displayName:"Traveler",email:"traveler@example.test"};
function workspace() {
  const sqlite=new DatabaseSync(":memory:");
  for(const name of readdirSync("drizzle").filter(name=>name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(`drizzle/${name}`,"utf8"));
  const prepare=(sql:string,args:any[]=[]):any=>({bind:(...values:any[])=>prepare(sql,values),first:async()=>sqlite.prepare(sql).get(...args)||null,
    all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}),
    execute:()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}})});
  const DB={prepare,batch:async(items:any[])=>{sqlite.exec("BEGIN");try{const result=items.map(item=>item.execute());sqlite.exec("COMMIT");return result;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  const objects=new Map<string,Uint8Array>();
  let beforePut:(()=>Promise<void>)|undefined;
  const BUCKET={put:async(key:string,bytes:Uint8Array,options?:{onlyIf?:Headers})=>{
    if(beforePut) await beforePut();
    if(options?.onlyIf?.get("If-None-Match")==="*" && objects.has(key)) return null;
    objects.set(key,new Uint8Array(bytes));return {key};
  },get:async(key:string)=>objects.has(key)?{body:new Response(new Uint8Array(objects.get(key)!).buffer).body}:null,delete:async(key:string)=>{objects.delete(key);}};
  const call=(path:string,init:RequestInit={})=>handleApi(new Request(`https://wayfarer.test/api${path}`,init),{DB,BUCKET} as any,owner);
  const snapshot=async()=> (await call("/trip")).json() as Promise<any>;
  const upload=(form:FormData,tripId="california")=>call(`/documents?tripId=${tripId}`,{method:"POST",body:form});
  return {sqlite,objects,call,snapshot,upload,barrier:()=>{let arrivals=0;let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});beforePut=async()=>{if(++arrivals===2)release();await ready;};},close:()=>sqlite.close()};
}
function fileForm(text:string,name="booking.txt",eventId:string|null="flight-out",uploadId=crypto.randomUUID()) {
  const form=new FormData();form.set("file",new File([text],name));form.set("uploadId",uploadId);form.set("eventId",eventId || "");return form;
}

test("renamed identical originals are skipped within a trip without changing attachment or itinerary",async()=>{
  const w=workspace();try {
    const initial=await w.snapshot();
    const first=await w.upload(fileForm("%PDF-1.4\nOriginal bytes","confirmation.pdf"));assert.equal(first.status,201);const saved:any=await first.json();
    const duplicate=await w.upload(fileForm("%PDF-1.4\nOriginal bytes","renamed.pdf","burbank"));assert.equal(duplicate.status,200);
    const result:any=await duplicate.json();assert.equal(result.duplicate,true);assert.equal(result.id,saved.id);assert.equal(result.eventId,"flight-out");assert.equal(result.name,"confirmation.pdf");
    const after=await w.snapshot();assert.equal(after.documents.length,1);assert.equal(after.version,initial.version);assert.deepEqual(after.trip,initial.trip);assert.equal(w.objects.size,1);
    assert.equal(await (await w.call(`/documents/${saved.id}`)).text(),"%PDF-1.4\nOriginal bytes");
  }finally{w.close();}
});

test("identical content in different trips is permitted and cannot reveal another trip's document",async()=>{
  const w=workspace();try {
    const id=crypto.randomUUID();
    const response=await w.call("/trips",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,title:"Other trip",start:"2027-01-01",end:"2027-01-02"})});assert.equal(response.status,201);
    const first:any=await (await w.upload(fileForm("same original"))).json();
    const second=await w.upload(fileForm("same original","copy.txt",null),id);assert.equal(second.status,201);const other:any=await second.json();assert.notEqual(other.id,first.id);assert.equal(other.duplicate,undefined);
    assert.equal((await w.call(`/documents/${first.id}?tripId=${id}`)).status,404);
  }finally{w.close();}
});

test("different originals for one booking require review; keep both preserves originals and retry idempotency",async()=>{
  const w=workspace();try {
    const first:any=await (await w.upload(fileForm("Original passenger one"))).json();
    const next=fileForm("Original passenger two");
    const review=await w.upload(next);assert.equal(review.status,409);const conflict:any=await review.json();assert.equal(conflict.code,"document_conflict");assert.equal(conflict.conflicts[0].id,first.id);
    assert.equal(w.objects.size,1);assert.equal((await w.snapshot()).documents.length,1);
    next.set("reviewedDocumentIds",JSON.stringify([first.id]));const saved=await w.upload(next);assert.equal(saved.status,201);assert.equal((await saved.json() as any).keptBoth,true);
    assert.equal((await w.upload(next)).status,200);assert.equal((await w.snapshot()).documents.length,2);assert.equal(w.objects.size,2);
    assert.equal(await (await w.call(`/documents/${first.id}`)).text(),"Original passenger one");
    next.set("file",new File(["Changed passenger two"],"booking.txt"));assert.equal((await w.upload(next)).status,409);
  }finally{w.close();}
});

test("acknowledgements do not silently approve a subsequently added booking document",async()=>{
  const w=workspace();try {
    const first:any=await (await w.upload(fileForm("first"))).json();
    const second=fileForm("second");second.set("reviewedDocumentIds",JSON.stringify([first.id]));assert.equal((await w.upload(second)).status,201);
    const third=fileForm("third");third.set("reviewedDocumentIds",JSON.stringify([first.id]));const result=await w.upload(third);assert.equal(result.status,409);assert.equal((await result.json() as any).conflicts.length,2);
    assert.equal(w.objects.size,2);
  }finally{w.close();}
});

test("unrelated same-day stops do not conflict and keep both never changes hotel dates or clocks",async()=>{
  const w=workspace();try {
    assert.equal((await w.upload(fileForm("Flight original"))).status,201);
    const before=await w.snapshot();const hotel=fileForm("Hotel original","hotel.txt","burbank");hotel.set("checkoutTime","10:15");hotel.set("checkoutEvidence","Check-out at 10:15");hotel.set("version",String(before.version));
    const first=await w.upload(hotel);assert.equal(first.status,201);const saved:any=await first.json();
    const initial=await w.snapshot();const amendment=fileForm("Changed hotel original","amendment.txt","burbank");amendment.set("checkoutTime","09:00");amendment.set("checkoutEvidence","Changed to 09:00");amendment.set("version",String(initial.version));
    assert.equal((await w.upload(amendment)).status,409);
    amendment.set("reviewedDocumentIds",JSON.stringify([saved.id]));assert.equal((await w.upload(amendment)).status,201);
    const after=await w.snapshot();assert.equal(after.version,initial.version);assert.deepEqual(after.trip,initial.trip);assert.equal(after.documents.length,3);
  }finally{w.close();}
});

test("previously saved originals are fingerprinted without rewriting them and deletion permits reupload",async()=>{
  const w=workspace();try {
    await w.snapshot();const id=crypto.randomUUID(),bytes=new TextEncoder().encode("legacy original");
    w.sqlite.prepare("INSERT INTO documents (id,trip_id,event_id,name,mime,size) VALUES (?,?,?,?,?,?)").run(id,"california","flight-out","old.txt","text/plain",bytes.length);w.objects.set(`documents/${id}`,bytes);
    const result=await w.upload(fileForm("legacy original","renamed.txt"));assert.equal(result.status,200);assert.equal((await result.json() as any).id,id);assert.deepEqual(w.objects.get(`documents/${id}`),bytes);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS count FROM document_fingerprints").get()!.count,1);
    assert.equal((await w.call(`/documents/${id}`,{method:"DELETE"})).status,200);assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS count FROM document_fingerprints").get()!.count,0);
    assert.equal((await w.upload(fileForm("legacy original"))).status,201);
  }finally{w.close();}
});

test("concurrent identical uploads commit just one original",async()=>{
  const w=workspace();try {
    await w.snapshot();w.barrier();
    const responses=await Promise.all([w.upload(fileForm("same concurrent bytes","a.txt",null)),w.upload(fileForm("same concurrent bytes","b.txt",null))]);
    assert.deepEqual(responses.map(response=>response.status).sort(),[200,201]);assert.equal((await w.snapshot()).documents.length,1);assert.equal(w.objects.size,1);
  }finally{w.close();}
});

test("concurrent different uploads to one booking cannot bypass review",async()=>{
  const w=workspace();try {
    await w.snapshot();w.barrier();
    const responses=await Promise.all([w.upload(fileForm("concurrent first")),w.upload(fileForm("concurrent second"))]);
    assert.deepEqual(responses.map(response=>response.status).sort(),[201,409]);assert.equal((await w.snapshot()).documents.length,1);assert.equal(w.objects.size,1);
    assert.equal((await responses.find(response=>response.status===409)!.json() as any).code,"document_conflict");
  }finally{w.close();}
});

test("fingerprinting applies to images and raw email, independent of filenames",async()=>{
  const w=workspace();try {
    const image=Uint8Array.from([137,80,78,71,13,10,26,10,0,5]);
    for(const [name,bytes] of [["screenshot.png",image],["ticket.eml",new TextEncoder().encode("Subject: Flight\r\n\r\nTicket original")]] as const) {
      const first=fileForm("",name,null);first.set("file",new File([bytes],name));assert.equal((await w.upload(first)).status,201);
      const duplicate=fileForm("",`renamed-${name}`,null);duplicate.set("file",new File([bytes],`renamed-${name}`));const result=await w.upload(duplicate);assert.equal(result.status,200);assert.equal((await result.json() as any).duplicate,true);
    }
    assert.equal((await w.snapshot()).documents.length,2);
  }finally{w.close();}
});

test("bounded legacy hashing saves progress and a retry completes without a false upload",async()=>{
  const w=workspace();try {
    await w.snapshot();
    for(let index=0;index<33;index++) {const id=crypto.randomUUID(),bytes=new TextEncoder().encode(`old-${String(index).padStart(2,"0")}`);w.sqlite.prepare("INSERT INTO documents (id,trip_id,event_id,name,mime,size) VALUES (?,?,?,?,?,?)").run(id,"california",null,`${index}.txt`,"text/plain",bytes.length);w.objects.set(`documents/${id}`,bytes);}
    const form=fileForm("new-00","new.txt",null);assert.equal((await w.upload(form)).status,503);assert.equal(w.objects.size,33);
    assert.equal((await w.upload(form)).status,201);assert.equal(w.objects.size,34);
    assert.equal(await documentHash(new TextEncoder().encode("abc")),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  }finally{w.close();}
});
