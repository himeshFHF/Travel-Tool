import type { Document, Stop } from "./model";
import { documentsForStop, hotelStayForStop } from "./document-links";

export type ExtractedCheckout = { time: string; evidence: string };
export type ExtractedHotelStayDates = { start: string; end: string; evidence: string };

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthPattern = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const checkoutLabel = /\bcheck[\s\u2010-\u2015-]*out\b/gi;
const timePattern = /\b(?:noon|midnight|(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]\.?m\.?|(?:[01]?\d|2[0-3]):[0-5]\d)(?![\d:])/gi;

/** Only explicit arrival/checkout labels form a stay; a receipt date or a hotel
 * name by itself is insufficient. Conflicting dates and ambiguous numeric dates
 * are left for manual review, including unstated year changes across New Year.
 */
export function extractHotelStayDates(text: string, stop: Stop): ExtractedHotelStayDates | null {
  if(stop.type!=="stay") return null;
  const bounded=text.replace(/\r\n?/g,"\n").slice(0,250_000);
  const found: {kind:"in"|"out";date:string;evidence:string}[]=[];
  let ambiguous=false;
  for(const label of bounded.matchAll(/\bcheck[\s\u2010-\u2015-]*(in|out)\b/gi)) {
    const kind=label[1].toLowerCase() as "in"|"out";
    const after=bounded.slice(label.index!+label[0].length,label.index!+label[0].length+150)
      .split(/\b(?:check[\s\u2010-\u2015-]*(?:in|out)|reservation date|booking date|payment|cancellation|total|breakfast|address)\b/i)[0]
      .split("\n").filter(line=>line.trim()).slice(0,3).join("\n");
    const candidates: {date:string;index:number;length:number}[]=[];
    const inferredYear=(kind==="out" ? stop.checkoutDate : stop.date)?.slice(0,4) || stop.date.slice(0,4);
    const add=(year:string|undefined,month:number,day:number,index:number,length:number)=>{
      const date=`${year||inferredYear}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) {ambiguous=true;return;}
      candidates.push({date,index,length});
    };
    for(const match of after.matchAll(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g)) add(match[1],+match[2],+match[3],match.index!,match[0].length);
    for(const match of after.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) {
      const a=+match[1],b=+match[2];
      if(a<=12 && b<=12 && a!==b) {ambiguous=true;continue;}
      add(match[3],a>12?b:a,a>12?a:b,match.index!,match[0].length);
    }
    for(const match of after.matchAll(new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,"gi"))) add(match[3],months.indexOf(match[1].slice(0,3).toLowerCase())+1,+match[2],match.index!,match[0].length);
    for(const match of after.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?(?:,?\\s+(\\d{4}))?\\b`,"gi"))) add(match[3],months.indexOf(match[2].slice(0,3).toLowerCase())+1,+match[1],match.index!,match[0].length);
    if(!candidates.length) continue;
    if(new Set(candidates.map(candidate=>candidate.date)).size!==1 || /\b(?:subject to|on request|possible|may be)\b/i.test(after)) {ambiguous=true;continue;}
    const candidate=candidates[0];
    const prefix=after.slice(0,candidate.index).replace(/\b(?:date|day|on|is|at|from|by|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi,"").replace(/[\s:,.()\u2010-\u2015-]/g,"");
    if(prefix) continue;
    found.push({kind,date:candidate.date,evidence:`${label[0]} ${after.slice(0,candidate.index+candidate.length)}`.replace(/\s+/g," ").trim()});
  }
  const starts=found.filter(item=>item.kind==="in"), ends=found.filter(item=>item.kind==="out");
  if(ambiguous || new Set(starts.map(item=>item.date)).size!==1 || new Set(ends.map(item=>item.date)).size!==1 || starts[0].date>=ends[0].date) return null;
  return {start:starts[0].date,end:ends[0].date,evidence:`${starts[0].evidence}; ${ends[0].evidence}`.slice(0,300)};
}

function clock(value: string) {
  const clean = value.toLowerCase().replace(/[.\s]/g, "");
  if (clean === "noon") return "12:00";
  if (clean === "midnight") return "00:00";
  const match = clean.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  if (match[3]) hour = hour % 12 + (match[3] === "pm" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2] || "00"}`;
}

/** Validate any date between the checkout label and clock against this stay.
 * Also remove it so a nearby unrelated time cannot masquerade as a checkout time.
 */
function labelPrefix(value: string, expectedDate?: string) {
  let valid = true;
  const expectedYear = expectedDate?.slice(0, 4);
  const check = (year: string | undefined, month: number, day: number) => {
    const actual = `${year || expectedYear || "0000"}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (month < 1 || month > 12 || day < 1 || day > 31 || (expectedDate && actual !== expectedDate)) valid = false;
    return " ";
  };
  let remaining = value.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, year, month, day) => check(year, Number(month), Number(day)));
  remaining = remaining.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g, (_, a, b, year) => {
    // A date such as 03/04 is not safe to interpret without a declared format.
    if (+a <= 12 && +b <= 12 && +a !== +b) valid = false;
    return check(year.length === 2 ? `20${year}` : year, +a > 12 ? +b : +a, +a > 12 ? +a : +b);
  });
  remaining = remaining.replace(new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi"), (_, month, day, year) => check(year, months.indexOf(month.slice(0, 3).toLowerCase()) + 1, Number(day)));
  remaining = remaining.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?(?:\\s+(\\d{4}))?\\b`, "gi"), (_, day, month, year) => check(year, months.indexOf(month.slice(0, 3).toLowerCase()) + 1, Number(day)));
  remaining = remaining.replace(/\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|date|time|by|at|before|on|is|ends|no|later|than|confirmed|until)\b/gi, "");
  return valid && !remaining.replace(/[\s:,.()\u2010-\u2015-]/g, "");
}

/** Extract only a clearly labelled checkout deadline from a matched hotel stay.
 * No check-in, departure, unlabeled clock, conditional late checkout or conflicting
 * room times can silently become a deadline. Caller persists document provenance.
 */
export function extractHotelCheckout(text: string, stop: Stop): ExtractedCheckout | null {
  if (stop.type !== "stay") return null;
  const bounded = text.replace(/\r\n?/g, "\n").slice(0, 250_000);
  const results: ExtractedCheckout[] = [];
  for (const label of bounded.matchAll(checkoutLabel)) {
    const start = label.index!;
    const before = bounded.slice(Math.max(0, start - 30), start);
    const after = bounded.slice(start + label[0].length, start + label[0].length + 160)
      .split(/\b(?:check[\s\u2010-\u2015-]*in|check[\s\u2010-\u2015-]*out|breakfast|reception|front desk|cancellation|room type|total|amount|address)\b/i)[0]
      .split("\n").filter(line=>line.trim()).slice(0, 3).join("\n");
    const times = [...after.matchAll(timePattern)];
    if (!times.length) continue;
    if (/\b(?:request|available|availability|may|possible|subject to)\b/i.test(after)
      || (/\blate\s*$/i.test(before) && !/\bconfirmed\b/i.test(before + after))) return null;
    // A range or two room deadlines needs a person to choose the right one.
    if (new Set(times.map((match) => clock(match[0]))).size !== 1) return null;
    const first = times[0];
    if (!labelPrefix(after.slice(0, first.index), stop.checkoutDate)) continue;
    const time = clock(first[0]);
    if (!time) continue;
    const evidence = `${label[0]} ${after.slice(0, first.index! + first[0].length)}`.replace(/\s+/g, " ").trim().slice(0, 300);
    results.push({ time, evidence });
  }
  if (new Set(results.map((result) => result.time)).size !== 1) return null;
  return results[0] || null;
}

export type HotelCheckoutPolicy = { time: string; name: string; url: string; checkedOn: string };
const policies: HotelCheckoutPolicy[] = [
  { name: "Hotel Burbank", time: "12:00", url: "https://www.hotelburbank.com/reservation-policies", checkedOn: "2026-10-11" },
  { name: "Fairfield Inn & Suites Twentynine Palms", time: "12:00", url: "https://www.marriott.com/en-us/hotels/psptn-fairfield-inn-and-suites-twentynine-palms-joshua-tree-national-park/overview/", checkedOn: "2026-10-11" },
];
const propertyName = (stop: Stop) => stop.location.split(/[·|\n]/)[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A separate checkout reminder can borrow evidence from the overnight stay.
 * Do not apply this to a stay's scheduled check-in or an actual drive departure.
 */
export function checkoutStayForReminder(stop: Stop, stops: Stop[]): Stop | undefined {
  if (stop.type !== "stay" || stop.checkoutDate) return undefined;
  const stay = hotelStayForStop(stop, stops);
  return stay?.checkoutDate === stop.date ? stay : undefined;
}

export function hotelCheckoutPolicy(stop: Stop): HotelCheckoutPolicy | undefined {
  if (stop.type !== "stay") return undefined;
  const property = propertyName(stop);
  if (property === "hotel burbank") return policies[0];
  if (/^fairfield (?:by marriott )?inn (?:and )?suites twentynine palms(?: joshua tree(?: national park)?)?$/.test(property)) return policies[1];
  return undefined;
}

export type HotelCheckoutDisplay = {
  time?: string;
  date?: string;
  source: "booking" | "manual" | "standard" | "unknown";
  policy?: HotelCheckoutPolicy;
  document?: Document;
  documentName?: string;
  evidence?: string;
  reportedTime?: string;
  conflict: boolean;
};

/** Keep checkout deadlines separate from a stay's check-in/departure clock. */
export function getHotelCheckout(stop: Stop, documents: Document[] = [], stops: Stop[] = []): HotelCheckoutDisplay | null {
  if (stop.type !== "stay") return null;
  const related = stops.find((entry) => entry.id !== stop.id && entry.type === "stay"
    && propertyName(entry) === propertyName(stop)
    && (entry.date === stop.checkoutDate || entry.checkoutDate === stop.date));
  const primary = hotelStayForStop(stop, stops) || stop;
  const checkout = primary.checkout || stop.checkout;
  const policy = hotelCheckoutPolicy(primary);
  const reported = extractHotelCheckout(primary.notes, primary) || (related && extractHotelCheckout(related.notes, related));
  const time = checkout?.time || policy?.time;
  return {
    time,
    date: primary.checkoutDate || (related?.checkoutDate === stop.date ? stop.date : undefined),
    source: checkout?.source || (policy ? "standard" : "unknown"),
    policy,
    document: checkout?.documentId ? documentsForStop(stop,documents,stops).find((doc) => doc.id === checkout.documentId) : undefined,
    documentName: checkout?.documentName,
    evidence: checkout?.evidence,
    reportedTime: reported?.time,
    conflict: !!time && !!reported?.time && time !== reported.time,
  };
}
