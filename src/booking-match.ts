import type { Stop } from "./model";

export type BookingCandidate = { eventId: string; score: number; reasons: string[] };
export type BookingMatch = { isBooking: boolean; autoMatchId?: string; candidates: BookingCandidate[] };
const normalize = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => normalize(s).split(" ").filter(w => w.length >= 3 && !generic.has(w));
const generic = new Set("the and for your with from this that booking reservation confirmation reported itinerary original still needed upload check hotel stay flight ticket activity pickup return trip day san los new city international airport north south east west angeles diego time pm am".split(" "));
const cities = new Set(["los angeles", "san diego", "burbank", "twentynine palms", "joshua tree", "california", "dallas"]);
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const flightCodes = (s: string) => [...s.toUpperCase().matchAll(/\b([A-Z]{2})\s?(\d{2,4}[A-Z]?)\b/g)].map(m => m[1]+m[2]).filter(c => !/^(AM|PM|IN|ON|AT|NO|OF|TO)/.test(c));

function datesIn(text: string, years: number[]) {
  const dates = new Set<string>();
  let ambiguous = false;
  const add = (year: number, month: number, day: number) => {
    const date = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    if (!Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date) dates.add(date);
  };
  for (const m of text.matchAll(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g)) add(+m[1],+m[2],+m[3]);
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/g)) {
    const a=+m[1], b=+m[2];
    if (a<=12 && b<=12 && a!==b) ambiguous=true;
    if(a<=12) add(+m[3],a,b);
    if(b<=12) add(+m[3],b,a);
  }
  for(let i=0;i<months.length;i++) {
    const name=`(?:${months[i]}|${months[i].slice(0,3)}\\.?)`;
    const after=new RegExp(`\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(20\\d{2}))?\\b`,"gi");
    const before=new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${name}(?:\\s*,?\\s*(20\\d{2}))?\\b`,"gi");
    for (const pattern of [after,before]) for(const m of text.matchAll(pattern)) for(const year of m[2]?[+m[2]]:years) add(year,i+1,+m[1]);
  }
  return {dates,ambiguous};
}

// Attachment matching uses readable document text and the existing itinerary only.
// It never creates stops, changes booking status, or fills unverified travel details.
export function matchBooking(text: string, events: Stop[]): BookingMatch {
  const excerpt=text.slice(0,200000), body=normalize(excerpt), padded=` ${body} `;
  const isBooking=/\b(?:booking|reservation|ticket)\s+(?:confirmation|confirmed|reference|number|code|id)\b|\b(?:booking|reservation)\s+(?:is|has been)\s+confirmed\b|\bconfirmation\s+(?:number|code|reference|id)\b|\b(?:booking|reservation|confirmation)\s*[:#]|\b(?:e[ -]?ticket|boarding pass|reservation confirmed|booking confirmed|reservation details|booking details)\b/i.test(excerpt);
  if(!body) return {isBooking:false,candidates:[]};
  const docWords=new Set(words(excerpt));
  const years=[...new Set(events.map(e=>+e.date.slice(0,4)))];
  const {dates,ambiguous}=datesIn(excerpt,years);
  const codes=flightCodes(excerpt);
  const scored=events.map(event=>{
    const reasons:string[]=[];
    const dateMatch=dates.has(event.date);
    let score=dateMatch?4:0, strongIdentity=false, conflict=false;
    if(dateMatch) reasons.push("Travel date matches");
    const eventCodes=event.type==="flight"?flightCodes(event.notes):[];
    if(eventCodes.some(c=>codes.includes(c))) {
      score+=10; strongIdentity=true; reasons.push("Flight number matches");
    } else if(eventCodes.length && codes.length) conflict=true;
    const location=normalize(event.location.split(/[·|]/)[0]);
    // A hotel confirmation belongs on the stay, not its separate checkout reminder.
    const checkoutReminder=event.type==="stay" && !event.checkoutDate && events.some(other=>
      other.type==="stay" && other.checkoutDate===event.date &&
      normalize(other.location.split(/[·|]/)[0])===location && dates.has(other.date));
    const exactLocation=location.length>=6 && location.split(" ").length>=2 && padded.includes(` ${location} `);
    if(exactLocation && !cities.has(location)) {
      score+=7; reasons.push("Place or property matches");
      strongIdentity=event.type!=="drive";
    }
    if(event.type==="flight") {
      const airports=event.location.match(/\b[A-Z]{3}\b/g)||[];
      if(airports.length>=2 && airports.every(a=>new RegExp(`\\b${a}\\b`,"i").test(excerpt))) {
        score+=6;strongIdentity=true;reasons.push("Flight route matches");
      }
    }
    const tokens=[...new Set(words(event.location+" "+event.title))];
    const shared=tokens.filter(w=>docWords.has(w));
    if(shared.length) {score+=Math.min(shared.length,3);if(!exactLocation) reasons.push("Some place or title details match");}
    const typeWords={flight:/\b(flight|airline|boarding|e ticket)\b/,stay:/\b(hotel|check in|check out|accommodation|room|lodging)\b/,activity:/\b(admission|ticket|tour|entry|experience)\b/,drive:/\b(car rental|rental car|vehicle|pick up)\b/};
    if(typeWords[event.type].test(body)) {score+=1;reasons.push("Booking type matches");}
    // A dated booking for another day can be suggested by name, but never auto-linked.
    if(checkoutReminder) score-=4;
    const qualified=isBooking && dateMatch && strongIdentity && !conflict && !ambiguous && !checkoutReminder;
    return {eventId:event.id,score,reasons,qualified,hasIdentity:strongIdentity || shared.length>=1};
  }).filter(c=>c.hasIdentity && c.score>=3).sort((a,b)=>b.score-a.score);
  const top=scored[0], qualified=scored.filter(c=>c.qualified);
  const autoMatchId=top?.qualified && qualified.length===1 && (!scored[1] || top.score-scored[1].score>=3) ? top.eventId : undefined;
  return {isBooking,autoMatchId,candidates:scored.slice(0,3).map(({eventId,score,reasons})=>({eventId,score,reasons}))};
}
