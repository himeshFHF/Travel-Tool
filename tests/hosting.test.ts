import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleApi } from "../server/api";

const owner = {userId:"test-owner",displayName:"Traveler",email:"traveler@example.test"};
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
  const BUCKET={put:async(k:string,v:Uint8Array)=>objects.set(k,v),get:async(k:string)=>objects.has(k)?{body:new Response(new Uint8Array(objects.get(k)!).buffer).body}:null,delete:async(k:string)=>{objects.delete(k);}};
  const call=(path:string,init:RequestInit={},who:typeof owner|null=owner)=>handleApi(new Request(`https://wayfarer.test/api${path}`,init),{DB,BUCKET} as any,who);
  return {call,close:()=>sqlite.close()};
}
test("private API rejects anonymous access and cross-origin mutations",async()=>{
  const w=workspace();try {
    assert.equal((await w.call("/trip",{},null)).status,401);
    assert.equal((await w.call("/trip",{method:"PUT",headers:{origin:"https://other.test"},body:"{}"})).status,403);
    assert.equal((await w.call("/trip",{method:"PUT",headers:{"sec-fetch-site":"cross-site"},body:"{}"})).status,403);
    assert.equal((await w.call("/auth/setup",{method:"POST",body:"{}"})).status,404);
  }finally{w.close();}
});
test("saved edits survive reads, conflicts are rejected, and admission is capped at two",async()=>{
  const w=workspace();try {
    const snapshot:any=await (await w.call("/trip")).json();
    snapshot.trip.events[0].notes="Persisted note";
    const init={method:"PUT",headers:{"Content-Type":"application/json",origin:"https://wayfarer.test"},body:JSON.stringify({trip:snapshot.trip,version:snapshot.version})};
    assert.equal((await w.call("/trip",init)).status,200);
    assert.equal((await w.call("/trip",init)).status,409);
    const fresh:any=await (await w.call("/trip")).json();
    assert.equal(fresh.trip.events[0].notes,"Persisted note");
    fresh.trip.events.push(fresh.trip.events[0]);
    assert.equal((await w.call("/trip",{...init,body:JSON.stringify({trip:fresh.trip,version:fresh.version})})).status,400);
    assert.equal((await w.call("/trip",{}, {...owner,userId:"second"})).status,200);
    assert.equal((await w.call("/trip",{}, {...owner,userId:"third"})).status,403);
  }finally{w.close();}
});
test("documents persist privately; signatures, stop IDs and deletion are enforced",async()=>{
  const w=workspace();try {
    const form=new FormData();form.set("file",new File(["Sample confirmation"],"ticket.txt"));form.set("eventId","flight-out");
    const saved=await w.call("/documents",{method:"POST",body:form});assert.equal(saved.status,201);
    const doc:any=await saved.json();
    assert.equal((await w.call(`/documents/${doc.id}`,{},null)).status,401);
    const download=await w.call(`/documents/${doc.id}`);assert.equal(download.headers.get("cache-control"),"private, no-store");assert.equal(await download.text(),"Sample confirmation");
    const bad=new FormData();bad.set("file",new File(["Not a PDF"],"ticket.pdf"));assert.equal((await w.call("/documents",{method:"POST",body:bad})).status,400);
    form.set("eventId","nonexistent");assert.equal((await w.call("/documents",{method:"POST",body:form})).status,400);
    assert.equal((await w.call(`/documents/${doc.id}`,{method:"DELETE"})).status,200);
    assert.equal((await w.call(`/documents/${doc.id}`)).status,404);
  }finally{w.close();}
});

test("hotel document and checkout time save together without overwriting concurrent edits",async()=>{
  const w=workspace();try {
    const before:any=await (await w.call("/trip")).json();
    const form=new FormData();
    form.set("file",new File(["Hotel Burbank reservation confirmation. Check-out December 21, 2026 at 12:00 PM."],"hotel.txt"));
    form.set("eventId","burbank");form.set("checkoutTime","12:00");form.set("checkoutEvidence","Check-out December 21, 2026 at 12:00 PM.");form.set("version",String(before.version));
    const response=await w.call("/documents",{method:"POST",body:form});
    assert.equal(response.status,201);
    const document:any=await response.json();
    const after:any=await (await w.call("/trip")).json();
    const hotel=after.trip.events.find((e:any)=>e.id==="burbank");
    assert.equal(hotel.checkout.time,"12:00");assert.equal(hotel.checkout.source,"booking");assert.equal(hotel.checkout.documentId,document.id);
    assert.equal(after.version,before.version+1);
    assert.equal(after.trip.events.length,before.trip.events.length);
    const duplicate=await w.call("/documents",{method:"POST",body:form});
    assert.equal(duplicate.status,200);assert.equal((await duplicate.json() as any).duplicate,true);
    const unchanged:any=await (await w.call("/trip")).json();
    assert.equal(unchanged.documents.length,1);
    assert.equal(unchanged.version,after.version);
    assert.deepEqual(unchanged.trip,after.trip);
    // A different original for a different stay has no document conflict to mask
    // the stale version guard, so it still cannot overwrite concurrent edits.
    const stale=new FormData();stale.set("file",new File(["Fairfield checkout confirmation"],"fairfield.txt"));
    stale.set("eventId","fairfield");stale.set("checkoutTime","11:00");stale.set("checkoutEvidence","Check-out at 11 AM");stale.set("version",String(before.version));
    const staleResponse=await w.call("/documents",{method:"POST",body:stale});assert.equal(staleResponse.status,409);
    assert.match((await staleResponse.json() as any).error,/trip changed/);
    form.set("version",String(after.version));form.set("eventId","flight-out");
    assert.equal((await w.call("/documents",{method:"POST",body:form})).status,400);
    form.set("eventId","burbank");form.set("checkoutTime","28:00");
    assert.equal((await w.call("/documents",{method:"POST",body:form})).status,400);
  }finally{w.close();}
});
