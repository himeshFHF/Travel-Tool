import type { Stop } from "./model";

export type BookingCandidate = { eventId: string; score: number; reasons: string[] };
export type BookingMatch = { isBooking: boolean; autoMatchId?: string; candidates: BookingCandidate[]; documentTypes?: Stop["type"][]; notice?: string };
const normalize = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => normalize(s).split(" ").filter(w => w.length >= 3 && !generic.has(w));
const generic = new Set("the and for your with from this that booking reservation confirmation reported itinerary original still needed upload check hotel stay flight ticket activity pickup return trip day san los new city international airport north south east west angeles diego time pm am".split(" "));
const cities = new Set(["los angeles", "san diego", "burbank", "twentynine palms", "joshua tree", "california", "dallas"]);
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// Booking providers often insert the parent brand into a property's name.
// Require every meaningful property word, in order and close together; a shared
// destination such as Joshua Tree is not enough to identify a hotel.
function expandedHotelNameIn(documentWords: string[], location: string) {
  const propertyWords = words(location);
  if (propertyWords.length < 3) return false;
  for (let start = 0; start < documentWords.length; start++) {
    if (documentWords[start] !== propertyWords[0]) continue;
    const window = documentWords.slice(start, start + propertyWords.length + 6);
    let cursor = 0;
    if (propertyWords.every(word => {
      const found = window.indexOf(word, cursor);
      if (found < 0) return false;
      cursor = found + 1;
      return true;
    })) return true;
  }
  return false;
}
const flightCodes = (s: string) => [...new Set([...s.toUpperCase()
  .replace(/\b(?:BOOKING CONFIRMATION|RESERVATION CONFIRMATION|CONFIRMATION(?: NUMBER| CODE| REFERENCE)?|BOOKING REFERENCE|RESERVATION NUMBER|RECORD LOCATOR|PNR)\s*[:#-]?\s*([A-Z0-9]{4,})\b/g, "")
  .matchAll(/\b([A-Z][A-Z0-9]|[0-9][A-Z])[ -]?(\d{1,4}[A-Z]?)\b/g)]
  .filter(m => !/^(AM|PM|IN|ON|AT|NO|OF|TO|ID|US)$/.test(m[1]) && !months.some(month => month.slice(0, 3).toUpperCase() === m[1] + m[2][0]))
  .map(m => m[1] + m[2].replace(/^0+(?=\d)/, "")))];

// Keep direction: a return flight shares airports with the outbound flight.
const routesIn = (s: string) => {
  const text=s.toUpperCase();
  const routes=[...text.matchAll(/\b([A-Z]{3})\s*(?:→|➜|->|–|—|-|\bTO\b)\s*([A-Z]{3})\b/g)]
  .filter(m => m[1] !== m[2] && ![m[1],m[2]].some(code => /^(THE|AND|FOR|YOU|OUR|ONE|WAY|NOT|CAN|ALL|NOW|SEE|GET|ARE|HAS|WAS|PER|USE|OUT|CAR|BUS|TAX|FEE)$/.test(code)))
  .map(m => `${m[1]}>${m[2]}`);
  const origins=[...text.matchAll(/\b(?:FROM|ORIGIN|DEPARTURE AIRPORT)\s*:\s*([A-Z]{3})\b/g)];
  const destinations=[...text.matchAll(/\b(?:TO|DESTINATION|ARRIVAL AIRPORT)\s*:\s*([A-Z]{3})\b/g)];
  if(origins.length===1 && destinations.length===1) routes.push(`${origins[0][1]}>${destinations[0][1]}`);
  return [...new Set(routes)];
};

function documentTypes(text: string, codes: string[], routes: string[]): Stop["type"][] {
  const body = normalize(text);
  const types: Stop["type"][] = [];
  const flight = /\b(?:flight|airline|airlines|airways|boarding pass|e ticket|eticket)\b/.test(body) || (codes.length > 0 && routes.length > 0);
  if (flight) types.push("flight");
  // A flight email's hotel advertisement is not a second booking. Mixed documents
  // need actual stay/pickup/admission evidence before widening the suggestions.
  const lodging=/\b(?:hotel|resort|motel|inn|suites|lodge|hostel|guesthouse|lodging|accommodation|apartment|airbnb)\b/.test(body);
  const stayDates=/\bcheck ?in\b/.test(body) && /\bcheck ?out\b/.test(body);
  if ((!flight && (lodging || stayDates)) || (lodging && /\b(?:hotel|resort|motel|inn|suites|lodge|hostel|guesthouse|lodging|accommodation|apartment|airbnb)\b[^.!?]{0,120}\b(?:check[ -]?in|check[ -]?out|room type|guest name)\b/i.test(text))) types.push("stay");
  if (/\b(?:car rental|rental car|vehicle rental|rent a car|rental agreement)\b/.test(body) && (!flight || /\b(?:car rental|rental car|vehicle rental|rent a car|rental agreement)\b[^.!?]{0,120}\b(?:pick[ -]?up|drop[ -]?off|vehicle class|driver name)\b/i.test(text))) types.push("drive");
  if (/\b(?:admission|timed entry|event ticket|tour date|entry date)\b/.test(body) || (!flight && /\b(?:ticket|tour|excursion|attraction|concert|museum|theme park|ferry|boat)\b/.test(body))) types.push("activity");
  return types;
}

function relevantDates(text: string, type: Stop["type"], years: number[]) {
  const labels = { flight: /\b(?:departure(?: date)?|departs?|outbound|travel date)\s*[:\-]?\s*([^\n;]{0,90})/gi,
    stay: /\b(?:check[ -]?in|arrival(?: date)?)\s*[:\-]?\s*([^\n;]{0,90})/gi,
    drive: /\b(?:pick[ -]?up(?: date)?)\s*[:\-]?\s*([^\n;]{0,90})/gi,
    activity: /\b(?:admission(?: date)?|visit(?: date)?|event date|tour date|entry date)\s*[:\-]?\s*([^\n;]{0,90})/gi };
  const fragments = [...text.matchAll(labels[type])].map(m => m[1].split(/\b(?:arrival|arrives|check[ -]?out|return|drop[ -]?off)\b/i)[0]);
  const labeled = datesIn(fragments.join("\n"), years);
  return labeled.dates.size ? labeled : datesIn(text, years);
}

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
    const after=new RegExp(`\\b${name}[ -]+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(20\\d{2}))?\\b`,"gi");
    const before=new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[ -]*${name}(?:[ -]*,?[ -]*(20\\d{2}))?\\b`,"gi");
    for (const pattern of [after,before]) for(const m of text.matchAll(pattern)) for(const year of m[2]?[+m[2]]:years) add(year,i+1,+m[1]);
  }
  return {dates,ambiguous};
}

// Attachment matching uses readable document text and the existing itinerary only.
// It never creates stops, changes booking status, or fills unverified travel details.
export function matchBooking(text: string, events: Stop[]): BookingMatch {
  const excerpt=text.slice(0,200000), body=normalize(excerpt), padded=` ${body} `;
  const confirmation=/\b(?:booking|reservation|ticket)\s+(?:confirmation|confirmed|reference|number|code|id)\b|\b(?:booking|reservation)\s+(?:is|has been)\s+confirmed\b|\bconfirmation\s+(?:number|code|reference|id)\b|\b(?:booking|reservation|confirmation|pnr|record locator)\s*[:#]|\b(?:e[ -]?ticket|boarding pass|reservation confirmed|booking confirmed|reservation details|booking details)\b/i.test(excerpt);
  if(!body) return {isBooking:false,candidates:[]};
  const docWords=new Set(words(excerpt));
  const documentWords=body.split(" ");
  const years=[...new Set(events.map(e=>+e.date.slice(0,4)))];
  const {dates}=datesIn(excerpt,years);
  const codes=flightCodes(excerpt);
  const routes=routesIn(excerpt);
  const types=documentTypes(excerpt,codes,routes);
  const dateEvidence={flight:relevantDates(excerpt,"flight",years), stay:relevantDates(excerpt,"stay",years), drive:relevantDates(excerpt,"drive",years), activity:relevantDates(excerpt,"activity",years)};
  const isBooking=confirmation || (types.includes("flight") && /\b(?:itinerary|flight details|travel details)\b/i.test(excerpt) && (codes.length>0 || routes.length>0));
  const inactive=/\b(?:cancelled|canceled|voided|not confirmed|pending confirmation)\b/i.test(excerpt);
  const multiFlight=codes.length>1 || routes.length>1 || dateEvidence.flight.dates.size>1;
  const scored=events.map(event=>{
    if(types.length && !types.includes(event.type)) return null;
    if(types.includes("drive") && event.type==="drive" && !/\b(?:rental|rent|vehicle|pick[ -]?up|drop[ -]?off)\b/i.test(`${event.title} ${event.notes}`)) return null;
    const reasons:string[]=[];
    const evidenceDates=dateEvidence[event.type];
    const dateMatch=evidenceDates.dates.has(event.date);
    let score=dateMatch?4:0, strongIdentity=false, conflict=false;
    if(dateMatch) reasons.push("Travel date matches");
    else if(evidenceDates.dates.size) {score-=3; reasons.push("Travel date differs — review before attaching");}
    const eventCodes=event.type==="flight"?flightCodes(`${event.title}\n${event.location}\n${event.notes}`):[];
    if(eventCodes.some(c=>codes.includes(c))) {
      score+=16; strongIdentity=true; reasons.push("Flight number matches");
    } else if(eventCodes.length && codes.length) {conflict=true; reasons.push("Flight number differs — review before attaching");}
    const location=normalize(event.location.split(/[·|]/)[0]);
    // A hotel confirmation belongs on the stay, not its separate checkout reminder.
    const checkoutReminder=event.type==="stay" && !event.checkoutDate && events.some(other=>
      other.type==="stay" && other.checkoutDate===event.date &&
      normalize(other.location.split(/[·|]/)[0])===location && dates.has(other.date));
    const exactLocation=location.length>=4 && (location.split(" ").length>=2 || words(location).length>=1) && padded.includes(` ${location} `);
    const expandedHotelName=event.type==="stay" && expandedHotelNameIn(documentWords,location);
    if((exactLocation || expandedHotelName) && !cities.has(location)) {
      score+=9; reasons.push("Place or property matches");
      strongIdentity=strongIdentity || event.type!=="flight";
    }
    if(event.type==="flight") {
      const eventRoutes=routesIn(event.location);
      if(eventRoutes.some(route=>routes.includes(route))) {
        score+=10;strongIdentity=true;reasons.push("Flight route matches");
      } else if(eventRoutes.length && routes.length) {
        conflict=true; reasons.push("Flight route differs — review before attaching");
      }
    }
    const tokens=[...new Set(words(event.location+" "+event.title))];
    const shared=tokens.filter(w=>docWords.has(w));
    const distinctiveOverlap=shared.length>=2;
    if(distinctiveOverlap && event.type!=="flight") {score+=Math.min(shared.length,3);if(!exactLocation) reasons.push("Some place or title details match");}
    const typeWords={flight:/\b(flight|airline|boarding|e ticket)\b/,stay:/\b(hotel|check in|check out|accommodation|room|lodging)\b/,activity:/\b(admission|ticket|tour|entry|experience)\b/,drive:/\b(car rental|rental car|vehicle|pick up)\b/};
    if(typeWords[event.type].test(body)) {score+=1;reasons.push("Booking type matches");}
    // A dated booking for another day can be suggested by name, but never auto-linked.
    if(checkoutReminder) return null;
    if(conflict) score-=8;
    const qualified=isBooking && dateMatch && strongIdentity && !conflict && !evidenceDates.ambiguous && !inactive && !(event.type==="flight" && multiFlight);
    return {eventId:event.id,score,reasons,qualified,hasIdentity:strongIdentity || (event.type!=="flight" && distinctiveOverlap)};
  }).filter((c): c is NonNullable<typeof c>=>c!==null && c.hasIdentity && c.score>=3).sort((a,b)=>b.score-a.score);
  const top=scored[0], qualified=scored.filter(c=>c.qualified);
  const autoMatchId=top?.qualified && qualified.length===1 && (!scored[1] || top.score-scored[1].score>=3) ? top.eventId : undefined;
  const notice=inactive ? "This document mentions an unconfirmed or cancelled booking. Review it before attaching."
    : types.length>1 ? "This document contains more than one booking type. Review the matching stops or keep it with the whole trip."
    : multiFlight && types.includes("flight") ? "This document may cover multiple flight segments. Choose a stop or keep it with the whole trip."
    : undefined;
  return {isBooking,autoMatchId:types.length>1 ? undefined : autoMatchId,documentTypes:types,notice,candidates:scored.slice(0,5).map(({eventId,score,reasons})=>({eventId,score,reasons}))};
}
