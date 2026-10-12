import express from "express";
import multer from "multer";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { seed } from "../src/seed";

const data = path.resolve(process.env.DATA_DIR || ".data");
mkdirSync(path.join(data, "uploads"), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(data, "travel.sqlite"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,salt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS members(user_id TEXT NOT NULL,trip_id TEXT NOT NULL,PRIMARY KEY(user_id,trip_id));
CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY,trip_id TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,trip_id TEXT NOT NULL,event_id TEXT,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL);`);
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      const origin = new URL(req.headers.origin);
      if (origin.host !== req.headers.host)
        return res
          .status(403)
          .json({ error: "Request origin does not match this app." });
    }
  }
  next();
});
const hashToken = (s: string) => createHash("sha256").update(s).digest("hex");
function user(req: express.Request) {
  const token = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("wayfarer="))
    ?.slice(9);
  if (!token) return null;
  return db
    .prepare(
      "SELECT users.id,users.name,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?",
    )
    .get(hashToken(token), Date.now()) as
    { id: string; name: string; email: string } | undefined;
}
function tripFor(uid: string) {
  return db
    .prepare(
      "SELECT trips.* FROM trips JOIN members ON trips.id=members.trip_id WHERE members.user_id=?",
    )
    .get(uid) as { id: string; payload: string; version: number } | undefined;
}
function session(res: express.Response, uid: string) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    hashToken(token),
    uid,
    Date.now() + 30 * 864e5,
  );
  res.cookie("wayfarer", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 30 * 864e5,
    path: "/",
  });
}
const identity = z.object({
  name: z.string().trim().min(1).max(70),
  email: z
    .email()
    .max(200)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(10).max(128),
  code: z.string().optional(),
});
const attempts = new Map<string, { count: number; until: number }>();
app.use("/api/auth", (req, res, next) => {
  if (req.method === "GET") return next();
  const key = req.ip || "unknown";
  const entry = attempts.get(key);
  if (entry && entry.until > Date.now() && entry.count >= 15)
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again in 15 minutes." });
  attempts.set(key, {
    count: entry && entry.until > Date.now() ? entry.count + 1 : 1,
    until:
      entry && entry.until > Date.now() ? entry.until : Date.now() + 900000,
  });
  next();
});
app.get("/api/auth", (req, res) =>
  res.json({
    user: user(req) || null,
    needsSetup: !db.prepare("SELECT id FROM users LIMIT 1").get(),
  }),
);
app.post("/api/auth/setup", (req, res) => {
  const input = identity.parse(req.body);
  if (db.prepare("SELECT id FROM users LIMIT 1").get())
    return res.status(409).json({
      error:
        "This private workspace has already been set up. Sign in or use your companion invitation.",
    });
  createAccount(input, res, true);
});
function createAccount(
  input: z.infer<typeof identity>,
  res: express.Response,
  first: boolean,
) {
  const id = randomUUID(),
    salt = randomBytes(16).toString("hex"),
    hash = scryptSync(input.password, salt, 64).toString("hex");
  let tid: string = randomUUID();
  const invitation = first
    ? null
    : (db
        .prepare("SELECT * FROM invites WHERE code=? AND expires>?")
        .get(hashToken(input.code || ""), Date.now()) as
        { trip_id: string } | undefined);
  if (!first && !invitation)
    return res
      .status(400)
      .json({ error: "That invitation is invalid or has expired." });
  if (invitation) {
    tid = invitation.trip_id;
    const n = db
      .prepare("SELECT count(*) AS n FROM members WHERE trip_id=?")
      .get(tid) as { n: number };
    if (n.n >= 2)
      return res
        .status(409)
        .json({ error: "This workspace already has two travelers." });
  }
  if (db.prepare("SELECT id FROM users WHERE email=?").get(input.email))
    return res
      .status(409)
      .json({ error: "That email already has an account." });
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      id,
      input.name,
      input.email,
      hash,
      salt,
    );
    if (first)
      db.prepare("INSERT INTO trips(id,payload) VALUES(?,?)").run(
        tid,
        JSON.stringify(seed),
      );
    db.prepare("INSERT INTO members VALUES(?,?)").run(id, tid);
    if (invitation) db.prepare("DELETE FROM invites WHERE trip_id=?").run(tid);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  session(res, id);
  res.json({ user: { id, name: input.name, email: input.email } });
}
app.post("/api/auth/join", (req, res) =>
  createAccount(identity.parse(req.body), res, false),
);
app.post("/api/auth/login", (req, res) => {
  const input = z
    .object({ email: z.string().max(200), password: z.string().max(128) })
    .parse(req.body);
  const u = db
    .prepare("SELECT * FROM users WHERE email=?")
    .get(input.email.toLowerCase()) as
    | { id: string; name: string; email: string; hash: string; salt: string }
    | undefined;
  const actual = scryptSync(input.password, u?.salt || "dummy-salt", 64);
  if (!u || !timingSafeEqual(actual, Buffer.from(u.hash, "hex")))
    return res
      .status(401)
      .json({ error: "Email or password was not recognized." });
  session(res, u.id);
  res.json({ user: { id: u.id, name: u.name, email: u.email } });
});
app.post("/api/auth/logout", (req, res) => {
  const token = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("wayfarer="))
    ?.slice(9);
  if (token)
    db.prepare("DELETE FROM sessions WHERE token=?").run(hashToken(token));
  res.clearCookie("wayfarer", { path: "/" });
  res.json({ ok: true });
});
app.use("/api", (req, res, next) => {
  const u = user(req);
  if (!u)
    return res
      .status(401)
      .json({ error: "Please sign in to your private workspace." });
  res.locals.user = u;
  res.locals.trip = tripFor(u.id);
  next();
});
app.get("/api/trip", (_req, res) => {
  const t = res.locals.trip;
  res.json({
    trip: JSON.parse(t.payload),
    version: t.version,
    documents: db
      .prepare(
        "SELECT id,name,event_id AS eventId,size,mime FROM documents WHERE trip_id=?",
      )
      .all(t.id),
    members: db
      .prepare(
        "SELECT users.name FROM users JOIN members ON members.user_id=users.id WHERE trip_id=?",
      )
      .all(t.id),
  });
});
const stopSchema = z.object({
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
app.put("/api/trip", (req, res) => {
  const b = z
    .object({
      version: z.number().int(),
      trip: z.object({
        title: z.string().min(1).max(200),
        start: z.iso.date(),
        end: z.iso.date(),
        events: z.array(stopSchema).max(300),
      }),
    })
    .parse(req.body);
  if (
    b.trip.start > b.trip.end ||
    b.trip.events.some(
      (e) =>
        e.date < b.trip.start ||
        e.date > b.trip.end ||
        (e.checkoutDate && e.checkoutDate <= e.date) ||
        (e.lat === undefined) !== (e.lng === undefined),
    ) ||
    new Set(b.trip.events.map((e) => e.id)).size !== b.trip.events.length
  )
    return res
      .status(400)
      .json({ error: "Stops must have unique IDs and dates within the trip." });
  const t = res.locals.trip;
  const r = db
    .prepare(
      "UPDATE trips SET payload=?,version=version+1 WHERE id=? AND version=?",
    )
    .run(JSON.stringify(b.trip), t.id, b.version);
  if (!r.changes)
    return res.status(409).json({
      error:
        "Your companion updated this trip. Refresh the page to see their changes before saving.",
    });
  res.json({ version: b.version + 1 });
});
app.post("/api/invite", (_req, res) => {
  const tid = res.locals.trip.id;
  const n = db
    .prepare("SELECT count(*) AS n FROM members WHERE trip_id=?")
    .get(tid) as { n: number };
  if (n.n >= 2)
    return res
      .status(409)
      .json({ error: "Both traveler accounts are already connected." });
  const code = randomBytes(12).toString("hex");
  db.prepare("DELETE FROM invites WHERE trip_id=?").run(tid);
  db.prepare("INSERT INTO invites VALUES(?,?,?)").run(
    hashToken(code),
    tid,
    Date.now() + 864e5,
  );
  res.json({ code });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});
app.post("/api/documents", upload.single("file"), (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ error: "Choose a file first." });
  const ext = path.extname(f.originalname).toLowerCase();
  let mime = "";
  const b = f.buffer;
  if (ext === ".pdf" && b.subarray(0, 5).toString() === "%PDF-")
    mime = "application/pdf";
  if (
    [".jpg", ".jpeg"].includes(ext) &&
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255
  )
    mime = "image/jpeg";
  if (
    ext === ".png" &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    mime = "image/png";
  if (
    ext === ".webp" &&
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    mime = "image/webp";
  if ([".txt", ".eml"].includes(ext) && !b.includes(0)) mime = "text/plain";
  if (!mime)
    return res.status(400).json({
      error:
        "Use a PDF, TXT, EML, PNG, JPEG or WebP file with matching contents.",
    });
  const tid = res.locals.trip.id;
  const eventId =
    typeof req.body.eventId === "string" && req.body.eventId
      ? req.body.eventId
      : null;
  if (
    eventId &&
    !JSON.parse(res.locals.trip.payload).events.some(
      (e: { id: string }) => e.id === eventId,
    )
  )
    return res.status(400).json({ error: "That stop no longer exists." });
  const id = randomUUID();
  const name =
    path
      .basename(f.originalname)
      .replace(/[\r\n\x00-\x1f]/g, "")
      .slice(0, 200) || "Document";
  writeFileSync(path.join(data, "uploads", id), b, { mode: 0o600 });
  try {
    db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?)").run(
      id,
      tid,
      eventId,
      name,
      mime,
      f.size,
    );
  } catch (e) {
    unlinkSync(path.join(data, "uploads", id));
    throw e;
  }
  res.status(201).json({ id, name, eventId, size: f.size, mime });
});
app.get("/api/documents/:id", (req, res) => {
  const doc = db
    .prepare("SELECT * FROM documents WHERE id=? AND trip_id=?")
    .get(String(req.params.id), res.locals.trip.id) as
    { id: string; name: string; mime: string } | undefined;
  if (!doc) return res.status(404).json({ error: "Document not found." });
  res.setHeader("Content-Type", doc.mime);
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
  );
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.send(readFileSync(path.join(data, "uploads", doc.id)));
});
app.delete("/api/documents/:id", (req, res) => {
  const doc = db
    .prepare("SELECT id FROM documents WHERE id=? AND trip_id=?")
    .get(String(req.params.id), res.locals.trip.id) as
    { id: string } | undefined;
  if (!doc) return res.status(404).json({ error: "Document not found." });
  db.prepare("DELETE FROM documents WHERE id=?").run(doc.id);
  try {
    unlinkSync(path.join(data, "uploads", doc.id));
  } catch {}
  res.json({ ok: true });
});
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: err.issues[0]?.message || "Check your details." });
    if (err instanceof multer.MulterError)
      return res.status(400).json({
        error:
          err.code === "LIMIT_FILE_SIZE"
            ? "Files must be 20 MB or smaller."
            : err.message,
      });
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  },
);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: {
      middlewareMode: true,
      fs: {
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          "**/.data/**",
          "**/server/**",
          "**/tests/**",
          data + "/**",
        ],
      },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
app.listen(port, process.env.HOST || "0.0.0.0", () =>
  console.log(`Wayfarer ready on port ${port}`),
);
