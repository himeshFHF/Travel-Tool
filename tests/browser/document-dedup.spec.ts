import { test,expect } from "@playwright/test";
import { seed } from "../../src/seed";

test("duplicate originals are skipped and a different booking document needs an explicit choice",async({page})=>{
  await page.goto("/signin-with-chatgpt?return_to=%2F");
  const tripId=crypto.randomUUID(),title=`Duplicate review ${Date.now()}`,tripApi=`/api/trip?tripId=${tripId}`;
  expect((await page.request.post("/api/trips",{data:{id:tripId,title,start:seed.start,end:seed.end}})).ok()).toBe(true);
  expect((await page.request.put(tripApi,{data:{trip:{...seed,title},version:1}})).ok()).toBe(true);
  await page.goto(`/#day?trip=${tripId}`);
  const original="Booking confirmation ABC123. Flight AA1639. DFW to LAX. Departure December 18, 2026. Passenger One.";
  const additional=original.replace("Passenger One","Passenger Two");
  const upload=(name:string,text:string)=>({name,mimeType:"text/plain",buffer:Buffer.from(text)});
  try {
    const baseline=await (await page.request.get(tripApi)).json();
    await page.getByRole("button",{name:"Add documents",exact:true}).click();
    await page.locator("input[type=file]").setInputFiles([
      upload("flight-original.txt",original),upload("renamed-copy.txt",original),upload("other-passenger.txt",additional),
    ]);
    await expect(page.getByLabel("Attach flight-original.txt to a stop")).toHaveValue("flight-out");
    await expect(page.getByLabel("Attach other-passenger.txt to a stop")).toHaveValue("flight-out");
    await page.getByRole("button",{name:"Save 3 documents",exact:true}).click();
    await expect(page.getByText("Already saved as flight-original.txt.",{exact:false})).toBeVisible();
    const conflict=page.getByRole("group",{name:"Review possible conflict for other-passenger.txt"});
    await expect(conflict).toBeVisible();
    await expect(conflict.getByRole("link",{name:"flight-original.txt",exact:true})).toBeVisible();
    const beforeChoice=await (await page.request.get(tripApi)).json();
    expect(beforeChoice.documents).toHaveLength(1);expect(beforeChoice.version).toBe(baseline.version);
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath("duplicate-review-mobile.png")});
    await conflict.getByRole("button",{name:"Keep existing / skip new",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Documents tucked away",exact:true})).toBeVisible();
    expect((await (await page.request.get(tripApi)).json()).documents).toHaveLength(1);
    await page.getByRole("button",{name:"Done",exact:true}).click();

    await page.getByRole("button",{name:"Add documents",exact:true}).click();
    await page.locator("input[type=file]").setInputFiles(upload("flight-original.txt",additional));
    await expect(page.getByLabel("Attach to a stop",{exact:true})).toHaveValue("flight-out");
    await page.getByRole("button",{name:"Save document",exact:true}).click();
    await expect(page.getByRole("group",{name:"Review possible conflict for flight-original.txt"})).toBeVisible();
    await page.getByRole("button",{name:"Keep both originals",exact:true}).click();
    await expect(page.getByText("Both originals kept.",{exact:false})).toBeVisible();
    const after=await (await page.request.get(tripApi)).json();
    expect(after.documents).toHaveLength(2);expect(after.version).toBe(baseline.version);expect(after.trip).toEqual(baseline.trip);
    const contents=await Promise.all(after.documents.map(async(document:{id:string})=>(await page.request.get(`/api/documents/${document.id}?tripId=${tripId}`)).text()));
    expect(contents.sort()).toEqual([original,additional].sort());
    await page.getByRole("button",{name:"Done",exact:true}).click();
  }finally{
    const current=await (await page.request.get(tripApi)).json();
    for(const document of current.documents) await page.request.delete(`/api/documents/${document.id}?tripId=${tripId}`);
  }
});
