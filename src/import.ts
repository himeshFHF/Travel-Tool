import type { Stop } from "./model";
// Deliberately conservative: dated headings become reviewable notes, never bookings.
export function parseItinerary(text: string, year = 2026): Partial<Stop>[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: Partial<Stop>[] = [];
  let current: Partial<Stop> | undefined;
  for (const line of lines) {
    const match = line.match(
      /(?:^|\b)(?:(\d{4})-(\d{2})-(\d{2})|(?:December|Dec\.?)\s+(\d{1,2})(?:[a-z]{2})?\b)/i,
    );
    if (match) {
      const date = match[1]
        ? `${match[1]}-${match[2]}-${match[3]}`
        : `${year}-12-${String(match[4]).padStart(2, "0")}`;
      if (!/^\d{4}-12-(?:0[1-9]|[12]\d|3[01])$/.test(date) && !match[1])
        continue;
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
  if (/\.(txt|eml)$/i.test(file.name)) return file.text();
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
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
