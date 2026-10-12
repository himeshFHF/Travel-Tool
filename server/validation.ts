import { z } from "zod";
export const stopSchema = z.object({
  id: z.string().max(100),
  date: z.iso.date(),
  time: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/),
  title: z.string().trim().min(1).max(200),
  type: z.enum(["flight", "stay", "activity", "drive"]),
  status: z.enum(["reported", "planned", "optional"]),
  location: z.string().max(300),
  notes: z.string().max(10000),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  url: z
    .string()
    .max(1000)
    .refine((s) => /^https:\/\//.test(s), "Links must use HTTPS")
    .optional(),
  checkoutDate: z.iso.date().optional(),
  checkout: z.object({
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    source: z.enum(["booking", "manual"]),
    documentId: z.string().max(100).optional(),
    documentName: z.string().max(255).optional(),
    evidence: z.string().max(300).optional(),
  }).optional(),
  staySource: z.object({
    start: z.iso.date(),
    end: z.iso.date(),
    source: z.literal("booking"),
    documentId: z.string().max(100),
    documentName: z.string().max(255),
    evidence: z.string().max(300),
  }).optional(),
  zone: z
    .string()
    .refine((s) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: s });
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
});
