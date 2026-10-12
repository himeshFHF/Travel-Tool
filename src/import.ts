import type { Stop } from "./model";
import { parseEmail } from "./email";
// Deliberately conservative: dated headings become reviewable notes, never bookings.
export function parseItinerary(text: string, year = 2026, range?: {start:string;end:string}): Partial<Stop>[] {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const validDate = (date:string) => !Number.isNaN(Date.parse(date)) && new Date(date+"T12:00:00Z").toISOString().slice(0,10) === date;
  const lines = text.replace(/\r/g, "").split("\n");
  const out: Partial<Stop>[] = [];
  let current: Partial<Stop> | undefined;
  for (const line of lines) {
    const match = line.match(
      /(?:^|\b)(?:(\d{4})-(\d{2})-(\d{2})|((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?)/i,
    );
    if (match) {
      let date = match[1]
        ? `${match[1]}-${match[2]}-${match[3]}`
        : `${match[6] || year}-${String(months.indexOf(match[4].slice(0,3).toLowerCase())+1).padStart(2,"0")}-${String(match[5]).padStart(2, "0")}`;
      if (range && !match[1] && !match[6]) {
        const possibilities = [...new Set([range.start.slice(0,4),range.end.slice(0,4)])]
          .map(y=> y+date.slice(4)).filter(d=>validDate(d)&&d>=range.start&&d<=range.end);
        if (possibilities.length !== 1) {current=undefined;continue;}
        date=possibilities[0];
      }
      if (!validDate(date) || (range && (date < range.start || date > range.end))) {current=undefined;continue;}
      current = {
        id: crypto.randomUUID(),
        date,
        time: "",
        title: line.replace(/^[#*\s-]+/, "").slice(0, 150) || "Imported day",
        type: "activity",
        status: "planned",
        location: "",
        notes: line,
      };
      out.push(current);
    } else if (current) {
      current.notes = (current.notes + "\n" + line).slice(0, 10000);
    }
  }
  return out.slice(0, 30);
}
export async function extractText(file: File): Promise<string> {
  if (/\.eml$/i.test(file.name)) {
    const email = await parseEmail(await file.arrayBuffer());
    return `${email.subject}\n${email.text}`;
  }
  if (/\.txt$/i.test(file.name)) return file.text();
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    });
    try {
      const doc = await task.promise;
      let text = "";
      for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text +=
          content.items
            .map((item) =>
              "str" in item
                ? item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ")
                : "",
            )
            .join("") + "\n";
      }
      return text;
    } finally {
      await task.destroy();
    }
  }
  return "";
}
