import {
  useState,
  useEffect,
  useRef,
  useId,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Compass,
  CalendarDays,
  FolderOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  MapPin,
  Plane,
  BedDouble,
  Car,
  Ticket,
  Upload,
  FileText,
  X,
  LogOut,
  Users,
  Sun,
  Mountain,
  Search,
  ExternalLink,
  AlertCircle,
  Loader2,
  Menu,
  Trash2,
  CalendarCheck,
  Navigation,
  LockKeyhole,
} from "lucide-react";
import RouteMap from "./components/RouteMap";
import {
  dateLabel,
  localDate,
  timeLabel,
  nextScheduledStop,
  missingDetails,
  type Stop,
  type Trip,
  type Document,
} from "./model";
import { extractText, parseItinerary } from "./import";

type User = { name: string; email: string };
type Snapshot = {
  trip: Trip;
  version: number;
  documents: Document[];
  members: { name: string }[];
};
async function api(url: string, options: RequestInit = {}) {
  const r = await fetch("/api" + url, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed.");
  return data;
}
const icons = { flight: Plane, stay: BedDouble, activity: Compass, drive: Car };
const statusLabel = {
  reported: "Booking reported",
  planned: "To plan",
  optional: "Optional",
};
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={wide ? "modal wide" : "modal"}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-btn"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Auth({
  needsSetup,
  onLogin,
}: {
  needsSetup: boolean;
  onLogin: (u: User) => void;
}) {
  const [mode, setMode] = useState(needsSetup ? "setup" : "login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const r = await api("/auth/" + mode, {
        method: "POST",
        body: JSON.stringify(data),
      });
      onLogin(r.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen">
      <div className="auth-story">
        <a className="brand" href="/">
          <span className="brand-symbol">w</span>wayfarer
          <span className="brand-dot">.</span>
        </a>
        <div>
          <div className="eyebrow light">LESS PLANNING. MORE BEING THERE.</div>
          <h1>
            Your next chapter
            <br />
            starts here.
          </h1>
          <p>
            Every stop, every ticket, every little detail.
            <br />
            One beautiful place for your journey together.
          </p>
        </div>
        <div className="auth-caption">
          <Mountain size={22} />
          <span>
            CALIFORNIA, DECEMBER 2026
            <br />
            <small>A little city. A little desert. A lot to remember.</small>
          </span>
        </div>
      </div>
      <div className="auth-form">
        <div className="auth-form-inner">
          <span className="pill">
            <LockKeyhole size={13} /> Your private travel space
          </span>
          <h2>
            {mode === "setup"
              ? "Let the adventure begin."
              : mode === "join"
                ? "Better together."
                : "Welcome back."}
          </h2>
          <p>
            {mode === "setup"
              ? "Create your account to explore your California trip. Invite your companion whenever you’re ready."
              : mode === "join"
                ? "Use the invitation from your travel companion."
                : "Your plans are right where you left them."}
          </p>
          <form onSubmit={submit}>
            {mode !== "login" && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={70}
                  placeholder="What should we call you?"
                />
              </label>
            )}
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={mode === "login" ? 1 : 10}
                maxLength={128}
                placeholder={
                  mode === "login" ? "Your password" : "At least 10 characters"
                }
              />
            </label>
            {mode === "join" && (
              <label>
                Invitation code
                <input
                  name="code"
                  required
                  placeholder="Paste your companion’s code"
                />
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <>
                  {" "}
                  {mode === "login"
                    ? "Open my trip"
                    : mode === "setup"
                      ? "Create my travel space"
                      : "Join the adventure"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          {!needsSetup && (
            <button
              className="text-btn auth-switch"
              onClick={() => {
                setMode(mode === "join" ? "login" : "join");
                setError("");
              }}
            >
              {mode === "join"
                ? "Already have an account? Sign in"
                : "Have an invitation? Join your companion"}
            </button>
          )}
          <div className="auth-foot">
            <LockKeyhole size={14} /> Private to you and your companion. No
            public signups.
          </div>
        </div>
      </div>
    </div>
  );
}
function Editor({
  stop,
  onSave,
  onClose,
  onDelete,
}: {
  stop: Stop;
  onSave: (s: Stop) => Promise<void>;
  onClose: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [value, setValue] = useState(stop);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const update = (key: keyof Stop, v: string) =>
    setValue((s) => ({ ...s, [key]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(value);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={onDelete ? "Make this stop yours" : "Add a little adventure"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="editor">
        <label>
          Stop title
          <input
            value={value.title}
            onChange={(e) => update("title", e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <div className="form-row">
          <label>
            Date
            <input
              type="date"
              value={value.date}
              onChange={(e) => update("date", e.target.value)}
              required
            />
          </label>
          <label>
            Local time <span className="muted">(optional)</span>
            <input
              type="time"
              value={value.time}
              onChange={(e) => update("time", e.target.value)}
            />
          </label>
        </div>
        {value.type === "stay" && (
          <label>
            Checkout date (for overnight stays)
            <input
              type="date"
              value={value.checkoutDate || ""}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  checkoutDate: e.target.value || undefined,
                }))
              }
            />
          </label>
        )}
        <label>
          Time zone
          <select
            value={value.zone || "America/Los_Angeles"}
            onChange={(e) => update("zone", e.target.value)}
          >
            <option value="America/Los_Angeles">
              Pacific · Los Angeles / San Diego
            </option>
            <option value="America/Chicago">Central · Dallas</option>
            <option value="America/New_York">Eastern · New York</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        <div className="form-row">
          <label>
            Type
            <select
              value={value.type}
              onChange={(e) => update("type", e.target.value)}
            >
              <option value="activity">Activity</option>
              <option value="flight">Flight</option>
              <option value="stay">Hotel</option>
              <option value="drive">Transport</option>
            </select>
          </label>
          <label>
            Booking status
            <select
              value={value.status}
              onChange={(e) => update("status", e.target.value)}
            >
              <option value="planned">To plan</option>
              <option value="reported">Booking reported</option>
              <option value="optional">Optional</option>
            </select>
          </label>
        </div>
        <label>
          Place or address
          <input
            value={value.location}
            onChange={(e) => update("location", e.target.value)}
            maxLength={300}
          />
        </label>
        <div className="form-row">
          <label>
            Latitude <span className="muted">(optional)</span>
            <input
              type="number"
              step="any"
              min={-90}
              max={90}
              value={value.lat ?? ""}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  lat:
                    e.target.value === "" ? undefined : Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            Longitude <span className="muted">(optional)</span>
            <input
              type="number"
              step="any"
              min={-180}
              max={180}
              value={value.lng ?? ""}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  lng:
                    e.target.value === "" ? undefined : Number(e.target.value),
                }))
              }
            />
          </label>
        </div>
        <p className="field-note">
          Coordinates place this stop on your map. Address lookup is not
          connected yet.
        </p>
        <label>
          Official information link
          <input
            type="url"
            value={value.url || ""}
            placeholder="https://…"
            onChange={(e) =>
              setValue((v) => ({ ...v, url: e.target.value || undefined }))
            }
          />
        </label>
        <label>
          Details & things to know
          <textarea
            rows={5}
            value={value.notes}
            onChange={(e) => update("notes", e.target.value)}
            maxLength={10000}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer>
          {onDelete && (
            <button
              type="button"
              className="text-btn danger"
              disabled={busy}
              onClick={async () => {
                if (!deleting) {
                  setDeleting(true);
                  return;
                }
                setBusy(true);
                try {
                  await onDelete();
                  onClose();
                } catch (e) {
                  setError((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              {deleting ? "Confirm removal" : "Remove stop"}
            </button>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save stop"}
            <Check size={16} />
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function UploadModal({
  events,
  initial,
  onClose,
  onUploaded,
  onImport,
}: {
  events: Stop[];
  initial?: string;
  onClose: () => void;
  onUploaded: () => Promise<void>;
  onImport: (stops: Stop[]) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [eventId, setEventId] = useState(initial || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [proposals, setProposals] = useState<Stop[]>([]);
  const [saved, setSaved] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("eventId", eventId);
      await api("/documents", { method: "POST", body: fd });
      setSaved(true);
      await onUploaded();
      try {
        const t = await extractText(file);
        setText(t);
        setProposals(
          parseItinerary(t).filter(
            (s) => s.date! >= "2026-12-18" && s.date! <= "2026-12-25",
          ) as Stop[],
        );
      } catch {
        setError(
          "Your document is safely saved. Text extraction was unavailable; add the details manually.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const choose = (f: File | undefined) => {
    if (f) {
      if (f.size > 20 * 1024 * 1024) {
        setError("Choose a file smaller than 20 MB.");
        return;
      }
      setFile(f);
      setError("");
    }
  };
  return (
    <Modal
      title={saved ? "Document tucked away" : "Bring your plans together"}
      onClose={onClose}
      wide
    >
      <div className="upload-body">
        {!saved ? (
          <>
            <p className="muted">
              Tickets, confirmations, or your whole itinerary. Keep them close.
            </p>
            <div
              className={"dropzone " + (drag ? "drag" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                choose(e.dataTransfer.files[0]);
              }}
            >
              <div className="upload-orb">
                <Upload size={25} />
              </div>
              <h3>{file ? file.name : "Drop your document here"}</h3>
              <p>
                or{" "}
                <button
                  className="text-btn"
                  onClick={() => fileInput.current?.click()}
                >
                  browse files
                </button>
              </p>
              <small>PDF, TXT, EML, PNG, JPG or WebP · up to 20 MB</small>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept=".pdf,.txt,.eml,.png,.jpg,.jpeg,.webp"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </div>
            <label>
              Attach to a stop
              <select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
              >
                <option value="">Whole trip / itinerary</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {dateLabel(e.date)} · {e.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="info-note">
              <LockKeyhole size={17} />
              <span>
                Only your two traveler accounts can access these files.
                Originals are kept in your private document collection.
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="success-banner">
              <CheckCircle2 size={22} />
              <span>
                <strong>{file?.name}</strong>
                <br />
                Original saved. Your document is ready to open.
              </span>
            </div>
            {proposals.length > 0 ? (
              <>
                <h3>Review extracted day notes</h3>
                <p className="muted">
                  We found dated sections. These are suggested notes, not
                  verified bookings. Edit titles or remove duplicates before
                  adding them.
                </p>
                <div className="proposal-list">
                  {proposals.map((s, i) => (
                    <div className="proposal" key={s.id}>
                      <span>{dateLabel(s.date)}</span>
                      <input
                        aria-label={`Imported title ${i + 1}`}
                        value={s.title}
                        onChange={(e) =>
                          setProposals((p) =>
                            p.map((x) =>
                              x.id === s.id
                                ? { ...x, title: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                      <button
                        aria-label="Discard suggestion"
                        className="icon-btn"
                        onClick={() =>
                          setProposals((p) => p.filter((x) => x.id !== s.id))
                        }
                      >
                        <X size={17} />
                      </button>
                      <details>
                        <summary>Extracted notes</summary>
                        <pre>{s.notes}</pre>
                      </details>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">
                {text
                  ? "No supported dated sections found. Your original is saved; add or edit a stop to fill in its details."
                  : "This file needs a manual review. Image and scanned-ticket recognition is not connected yet; your original is ready to use."}
              </p>
            )}
            {text && (
              <details className="extracted">
                <summary>View extracted text</summary>
                <pre>{text.slice(0, 30000)}</pre>
              </details>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer>
          {saved ? (
            <>
              <button className="secondary" onClick={onClose}>
                Done
              </button>
              {proposals.length > 0 && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onImport(proposals);
                      onClose();
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy(false);
                    }
                  }}
                >
                  Add {proposals.length} reviewed notes
                  <Plus size={16} />
                </button>
              )}
            </>
          ) : (
            <button
              disabled={!file || busy}
              className="primary"
              onClick={upload}
            >
              {busy ? (
                <>
                  <Loader2 className="spin" size={16} />
                  Saving & reading…
                </>
              ) : (
                <>
                  Save document
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          )}
        </footer>
      </div>
    </Modal>
  );
}
export default function App() {
  const [auth, setAuth] = useState<{
    user: User | null;
    needsSetup: boolean;
  } | null>(null);
  const [state, setState] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState("day");
  const [date, setDate] = useState(() => {
    const today = localDate();
    return today >= "2026-12-18" && today <= "2026-12-25"
      ? today
      : "2026-12-18";
  });
  const [now, setNow] = useState(new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Stop | null>(null);
  const [editing, setEditing] = useState<Stop | null>(null);
  const [upload, setUpload] = useState<{ eventId?: string } | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [confirmDoc, setConfirmDoc] = useState<string | null>(null);
  const refresh = async () => setState(await api("/trip"));
  useEffect(() => {
    api("/auth")
      .then(setAuth)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (auth?.user) refresh().catch((e) => setError(e.message));
  }, [auth?.user]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  async function saveTrip(trip: Trip) {
    if (!state) return;
    const r = await api("/trip", {
      method: "PUT",
      body: JSON.stringify({ trip, version: state.version }),
    });
    setState({ ...state, trip, version: r.version });
    setToast("Your plans are saved.");
  }
  if (!auth)
    return (
      <div className="loading">
        <span className="brand-symbol">w</span>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => location.reload()}>Try again</button>
          </>
        ) : (
          <p>Getting your journey ready…</p>
        )}
      </div>
    );
  if (!auth.user)
    return (
      <Auth
        needsSetup={auth.needsSetup}
        onLogin={(user) => setAuth({ needsSetup: false, user })}
      />
    );
  if (!state)
    return (
      <div className="loading">
        <Loader2 className="spin" />
        {error ? (
          <>
            <p>{error}</p>
            <button onClick={() => location.reload()}>Retry</button>
          </>
        ) : (
          <p>Opening your trip…</p>
        )}
      </div>
    );
  const { trip, documents, members } = state;
  const tripDates = Array.from(
    {
      length:
        Math.round((Date.parse(trip.end) - Date.parse(trip.start)) / 864e5) + 1,
    },
    (_, i) =>
      new Date(Date.parse(trip.start) + i * 864e5).toISOString().slice(0, 10),
  );
  const stops = trip.events.filter((e) => e.date === date);
  const needs = missingDetails(trip, documents);
  const today = localDate(now);
  const isToday = date === today;
  const dayIndex = tripDates.indexOf(date);
  const before = today < trip.start;
  const after = today > trip.end;
  const next = nextScheduledStop(stops, now);
  const knownCount = trip.events.filter((e) => e.status === "reported").length;
  const tonight = trip.events.find(
    (e) =>
      e.type === "stay" &&
      e.checkoutDate &&
      e.date <= date &&
      date < e.checkoutDate,
  );
  const dayTitles = [
    "Touch down. Slow down.",
    "A little farther from the ordinary.",
    "Let the magic find you.",
    "Take the scenic way.",
    "Desert days, coastal nights.",
    "Make room for the unexpected.",
    "Stay a little longer.",
    "Take the memories home.",
  ];
  const dayPlaces = [
    "Los Angeles & Burbank",
    "Channel Islands",
    "Universal Studios Hollywood",
    "Death Valley & Twentynine Palms",
    "Joshua Tree → San Diego",
    "San Diego",
    "San Diego",
    "San Diego → Dallas",
  ];
  const navigate = (p: string) => {
    setPage(p);
    setMenu(false);
  };
  const addStop = () =>
    setEditing({
      id: crypto.randomUUID(),
      date,
      time: "",
      title: "",
      type: "activity",
      status: "planned",
      location: "",
      notes: "",
    });
  const selectStop = (id: string) => {
    setSelected(id);
    document
      .getElementById("stop-" + id)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  return (
    <div className="app">
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <a className="brand" href="/">
          <span className="brand-symbol">w</span>wayfarer
          <span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR TRAVEL SPACE</div>
        <nav>
          <button
            className={page === "day" ? "active" : ""}
            onClick={() => navigate("day")}
          >
            <Compass size={19} />
            My journey
            <span className="nav-dot" />
          </button>
          <button
            className={page === "overview" ? "active" : ""}
            onClick={() => navigate("overview")}
          >
            <CalendarDays size={19} />
            Trip overview
          </button>
          <button
            className={page === "documents" ? "active" : ""}
            onClick={() => navigate("documents")}
          >
            <FolderOpen size={19} />
            Documents<span className="nav-count">{documents.length}</span>
          </button>
          <button
            className={page === "details" ? "active" : ""}
            onClick={() => navigate("details")}
          >
            <CheckCircle2 size={19} />
            To sort out<span className="nav-count">{needs.length}</span>
          </button>
        </nav>
        <div className="sidebar-trip">
          <div className="tiny-landscape">
            <Mountain size={50} />
            <span>THE GOLDEN STATE</span>
          </div>
          <strong>California escape</strong>
          <span>Dec 18 – 25, 2026</span>
          <div className="travelers">
            <div className="avatar">{members[0]?.name[0]?.toUpperCase()}</div>
            {members[1] ? (
              <div className="avatar second">
                {members[1].name[0].toUpperCase()}
              </div>
            ) : (
              <button
                className="avatar invite-avatar"
                aria-label="Invite companion"
                onClick={async () => {
                  try {
                    const r = await api("/invite", { method: "POST" });
                    setInvite(r.code);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Plus size={13} />
              </button>
            )}
            <small>
              {members.length === 2 ? "Better together" : "Room for one more"}
            </small>
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="account">
            <span className="avatar account-avatar">
              {auth.user.name[0].toUpperCase()}
            </span>
            <span>
              <strong>{auth.user.name}</strong>
              <small>Personal workspace</small>
            </span>
            <button
              className="icon-btn"
              title="Sign out"
              aria-label="Sign out"
              onClick={async () => {
                await api("/auth/logout", { method: "POST" });
                setAuth({ user: null, needsSetup: false });
                setState(null);
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="mobile-menu icon-btn"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            My trips
            <ChevronRight size={14} />
            <span>California escape</span>
          </div>
          <div className="top-actions">
            <span className="private-label">
              <LockKeyhole size={13} />
              Private trip
            </span>
            <button className="secondary compact" onClick={() => setUpload({})}>
              <Upload size={15} />
              Add documents
            </button>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="error global-error" role="alert">
              {error}
              <button className="text-btn" onClick={() => setError("")}>
                Dismiss
              </button>
            </div>
          )}
          {page === "day" && (
            <>
              <section className="hero">
                <div className="hero-content">
                  <div className="eyebrow">
                    <span className="live-dot" />
                    {before
                      ? "YOUR NEXT GREAT ADVENTURE"
                      : after
                        ? "A JOURNEY WORTH REMEMBERING"
                        : "YOU’RE RIGHT WHERE YOU SHOULD BE"}
                  </div>
                  <h1>
                    California,
                    <br />
                    <em>together.</em>
                  </h1>
                  <p>A little city. A little desert. A lot to remember.</p>
                  <div className="hero-meta">
                    <span>
                      <CalendarDays size={15} />
                      Dec 18 – 25, 2026
                    </span>
                    <span>
                      <Users size={15} />2 travelers
                    </span>
                    <span>8 days, your way</span>
                  </div>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <svg
                    viewBox="0 0 650 370"
                    preserveAspectRatio="xMidYMid slice"
                  >
                    <defs>
                      <linearGradient id="sky" x2="0" y2="1">
                        <stop stopColor="#ecddc5" />
                        <stop offset="1" stopColor="#f7eee0" />
                      </linearGradient>
                      <linearGradient id="hill" x2="0" y2="1">
                        <stop stopColor="#65796a" />
                        <stop offset="1" stopColor="#233e35" />
                      </linearGradient>
                    </defs>
                    <rect width="650" height="370" fill="url(#sky)" />
                    <circle cx="448" cy="100" r="42" fill="#fff5d9" />
                    <path
                      d="M0 257L135 134 215 201 343 78 490 214 565 134 650 210V370H0Z"
                      fill="#bdc1ad"
                    />
                    <path
                      d="M0 307L127 244 200 265 338 160 400 223 459 186 650 283V370H0Z"
                      fill="#96a28e"
                    />
                    <path
                      d="M0 321Q117 234 227 307T444 275T650 310V370H0Z"
                      fill="url(#hill)"
                    />
                    <path
                      d="M405 370Q288 333 368 316T470 287"
                      fill="none"
                      stroke="#dbc9a6"
                      strokeWidth="13"
                    />
                    <path
                      d="M567 302V164M566 168Q529 125 502 151M566 168Q590 116 621 150M566 168Q608 154 629 179M566 169Q534 145 509 176"
                      fill="none"
                      stroke="#294d3e"
                      strokeWidth="7"
                      strokeLinecap="round"
                    />
                    <path
                      d="M48 331V235M48 239Q24 210 5 230M48 239Q65 209 89 224M48 239Q77 229 94 246"
                      fill="none"
                      stroke="#294d3e"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="hero-stamp">
                    <Navigation size={14} /> WEST COAST, BEST COMPANY
                  </div>
                </div>
              </section>
              <div className="date-strip">
                <div className="date-intro">
                  <span>DECEMBER</span>
                  <strong>2026</strong>
                </div>
                {tripDates.map((d, i) => (
                  <button
                    key={d}
                    className={"date-button " + (date === d ? "selected" : "")}
                    onClick={() => {
                      setDate(d);
                      setSelected(null);
                    }}
                    aria-pressed={date === d}
                  >
                    <span>{dateLabel(d, { weekday: "short" })}</span>
                    <strong>{Number(d.slice(-2))}</strong>
                    <small>
                      {i === 0 || i === 7 ? (
                        <Plane size={12} />
                      ) : i === 1 ? (
                        <Navigation size={12} />
                      ) : i === 3 || i === 4 ? (
                        <Mountain size={12} />
                      ) : (
                        <span className="date-dot" />
                      )}
                    </small>
                  </button>
                ))}
              </div>
              <div className="day-heading">
                <div>
                  <div className="eyebrow">
                    DAY {dayIndex + 1} <span className="eyebrow-sep">/</span>{" "}
                    {dayPlaces[dayIndex]?.toUpperCase()}
                  </div>
                  <h2>{dayTitles[dayIndex] || dateLabel(date)}</h2>
                  <p>
                    {isToday ? (
                      <>
                        <span className="live-dot" /> Today ·{" "}
                        {new Intl.DateTimeFormat("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: "America/Los_Angeles",
                        }).format(now)}{" "}
                        Pacific{next ? ` · Next: ${next.title}` : ""}
                      </>
                    ) : (
                      <>
                        {" "}
                        {dateLabel(date, {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        })}{" "}
                        <span className="preview-tag">
                          {date < today ? "Past day" : "Trip preview"}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <button className="secondary" onClick={addStop}>
                  <Plus size={17} />
                  Add a stop
                </button>
              </div>
              <div className="journey-grid">
                <section className="agenda">
                  <div className="section-heading">
                    <h3>Your day, at a glance</h3>
                    <span>
                      {stops.length} {stops.length === 1 ? "stop" : "stops"}
                    </span>
                  </div>
                  {stops.length === 0 && (
                    <div className="empty-state">
                      <Sun />
                      <h3>A little room for possibility.</h3>
                      <p>Add your first stop for the day.</p>
                      <button className="primary" onClick={addStop}>
                        Add a stop
                      </button>
                    </div>
                  )}
                  {stops.map((stop, index) => {
                    const Icon = icons[stop.type];
                    const docs = documents.filter((d) => d.eventId === stop.id);
                    return (
                      <article
                        id={"stop-" + stop.id}
                        key={stop.id}
                        className={
                          "stop-card " +
                          (selected === stop.id ? "highlight" : "") +
                          (stop.status === "optional" ? " optional" : "")
                        }
                      >
                        <div className="timeline">
                          <span>{index + 1}</span>
                          {index !== stops.length - 1 && <i />}
                        </div>
                        <div className="stop-content">
                          {isToday && next?.id === stop.id && (
                            <div className="up-next">
                              <span className="live-dot" />
                              UP NEXT
                            </div>
                          )}
                          <div className="stop-top">
                            <span className={"type-icon " + stop.type}>
                              <Icon size={18} />
                            </span>
                            <span className="stop-time">
                              {timeLabel(stop.time)}
                              {stop.time && (
                                <small>
                                  {stop.zone === "America/Chicago"
                                    ? "CT"
                                    : "PT"}
                                </small>
                              )}
                            </span>
                            <span className={"status " + stop.status}>
                              {stop.status === "reported" && (
                                <Check size={12} />
                              )}{" "}
                              {statusLabel[stop.status]}
                            </span>
                          </div>
                          <button
                            className="stop-title"
                            onClick={() => {
                              setDetail(stop);
                              setSelected(stop.id);
                            }}
                          >
                            {stop.title}
                            <ArrowUpRight size={18} />
                          </button>
                          <p className="stop-location">
                            <MapPin size={13} />
                            {stop.location || "Location to add"}
                          </p>
                          <p className="stop-summary">
                            {stop.notes.split(". ")[0]}
                            {stop.notes.includes(". ") ? "." : ""}
                          </p>
                          <div className="stop-actions">
                            <button
                              className="text-btn"
                              onClick={() => setDetail(stop)}
                            >
                              View details
                              <ChevronRight size={14} />
                            </button>
                            {docs.length ? (
                              <a
                                className="ticket-link"
                                href={"/api/documents/" + docs[0].id}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Ticket size={14} />
                                Open document
                                <ArrowUpRight size={13} />
                              </a>
                            ) : stop.status === "reported" ? (
                              <button
                                className="ticket-link missing-ticket"
                                onClick={() => setUpload({ eventId: stop.id })}
                              >
                                <Plus size={13} />
                                Add confirmation
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                  <div className="agenda-foot">
                    <Compass size={16} />
                    Great trips leave a little room for the unexpected.
                  </div>
                </section>
                <aside className="day-aside">
                  <section className="map-card">
                    <div className="section-heading">
                      <h3>A sense of direction</h3>
                      <span className="round-icon">
                        <MapPin size={16} />
                      </span>
                    </div>
                    <RouteMap
                      stops={stops}
                      selected={selected}
                      onSelect={selectStop}
                    />
                    <div className="map-stop-list">
                      {stops
                        .filter(
                          (s) => s.lat !== undefined && s.lng !== undefined,
                        )
                        .map((s, i) => (
                          <button
                            key={s.id}
                            className={selected === s.id ? "selected" : ""}
                            onClick={() => selectStop(s.id)}
                          >
                            <span>
                              {stops.findIndex((stop) => stop.id === s.id) + 1}
                            </span>
                            {s.location}
                            <ChevronRight size={13} />
                          </button>
                        ))}
                    </div>
                  </section>
                  {tonight && (
                    <section className="stay-card">
                      <div className="eyebrow">
                        <BedDouble size={14} />
                        TONIGHT’S HOME BASE
                      </div>
                      <h3>{tonight.location.split(" · ")[0]}</h3>
                      <p>
                        {tonight.status === "reported"
                          ? "Booking reported"
                          : "Still to book"}{" "}
                        · Checkout {dateLabel(tonight.checkoutDate!)}
                      </p>
                      <button
                        className="text-btn"
                        onClick={() => setDetail(tonight)}
                      >
                        Stay details
                        <ArrowUpRight size={14} />
                      </button>
                    </section>
                  )}
                  <section className="gentle-card">
                    <span className="round-icon">
                      <Sun size={19} />
                    </span>
                    <div>
                      <h3>A little heads-up</h3>
                      <p>
                        {dayIndex === 3
                          ? "Today includes two long drives plus Death Valley. Confirm road conditions and leave room for daylight."
                          : dayIndex === 4
                            ? "A full Joshua Tree morning and a drive to San Diego. Set departure times before filling every stop."
                            : dayIndex === 2
                              ? "Park hours change by date. Check the official calendar, then add your arrival time and tickets."
                              : "Your plans are coming together. Add the missing times and confirmations so travel day feels effortless."}
                      </p>
                      <button
                        className="text-btn"
                        onClick={() => navigate("details")}
                      >
                        Tie up the loose ends
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </section>
                  <div className="source-note">
                    <CheckCircle2 size={14} />
                    <p>
                      Based on your itinerary. “Booking reported” means listed
                      as booked, pending original confirmation. Hours and
                      conditions are not live.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          {page === "overview" && (
            <>
              <PageTitle
                eyebrow="THE WHOLE PICTURE"
                title="Eight days. Endless possibilities."
                subtitle="From city lights to desert skies, and back to the coast."
              />
              <div className="stats">
                <div>
                  <strong>8</strong>
                  <span>days of discovery</span>
                </div>
                <div>
                  <strong>{trip.events.length}</strong>
                  <span>stops in your story</span>
                </div>
                <div>
                  <strong>{knownCount}</strong>
                  <span>bookings reported</span>
                </div>
                <div>
                  <strong>{documents.length}</strong>
                  <span>documents together</span>
                </div>
              </div>
              <div className="overview-grid">
                {tripDates.map((d, i) => (
                  <button
                    key={d}
                    className="overview-day"
                    onClick={() => {
                      setDate(d);
                      navigate("day");
                    }}
                  >
                    <div className={"day-art art-" + (i % 4)}>
                      {i === 0 || i === 7 ? (
                        <Plane size={36} />
                      ) : i === 3 || i === 4 ? (
                        <Mountain size={42} />
                      ) : i === 1 ? (
                        <Navigation size={40} />
                      ) : (
                        <Sun size={40} />
                      )}
                      <span>DAY {i + 1}</span>
                    </div>
                    <div className="overview-day-content">
                      <small>
                        {dateLabel(d, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </small>
                      <h3>{dayPlaces[i]}</h3>
                      <p>
                        {trip.events.filter((e) => e.date === d).length} stops
                        planned
                        <ArrowUpRight size={17} />
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {page === "documents" && (
            <>
              <PageTitle
                eyebrow="EVERYTHING, RIGHT HERE"
                title="Less searching. More exploring."
                subtitle="Your tickets, confirmations, and plans — ready when you need them."
                action={
                  <button className="primary" onClick={() => setUpload({})}>
                    <Plus size={17} />
                    Add document
                  </button>
                }
              />
              <div className="document-tools">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search documents"
                    placeholder="Find a ticket or confirmation…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <span>{documents.length} documents · private to your trip</span>
              </div>
              {documents.length === 0 ? (
                <div className="empty-documents">
                  <div className="document-illustration">
                    <FileText size={55} />
                    <span>
                      <Check size={18} />
                    </span>
                  </div>
                  <h2>A home for all the little details.</h2>
                  <p>
                    Drop in your flight confirmation, hotel booking,
                    <br />
                    or that ticket you’ll be glad you can find.
                  </p>
                  <button className="primary" onClick={() => setUpload({})}>
                    <Upload size={17} />
                    Add your first document
                  </button>
                  <small>
                    PDF, text, saved emails & images · up to 20 MB each
                  </small>
                </div>
              ) : (
                <div className="document-list">
                  {documents
                    .filter((d) =>
                      d.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((d) => (
                      <article key={d.id} className="document-row">
                        <span className="document-icon">
                          <FileText size={25} />
                        </span>
                        <div>
                          <a
                            href={"/api/documents/" + d.id}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {d.name}
                            <ArrowUpRight size={15} />
                          </a>
                          <p>
                            {trip.events.find((e) => e.id === d.eventId)
                              ?.title || "Whole trip"}{" "}
                            · {Math.max(1, Math.round(d.size / 1024))} KB
                          </p>
                        </div>
                        <button
                          className="icon-btn danger"
                          aria-label={"Remove " + d.name}
                          onClick={() => setConfirmDoc(d.id)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </article>
                    ))}
                  {documents.filter((d) =>
                    d.name.toLowerCase().includes(search.toLowerCase()),
                  ).length === 0 && (
                    <p className="empty-state">
                      No documents match that search.
                    </p>
                  )}
                </div>
              )}
              <div className="info-note">
                <LockKeyhole size={18} />
                <p>
                  Original files stay private. Uploading an itinerary can
                  suggest dated notes for your review. Images and scanned PDFs
                  need manual details in this first version.
                </p>
              </div>
            </>
          )}
          {page === "details" && (
            <>
              <PageTitle
                eyebrow="A LITTLE PREPARATION, A LOT MORE PEACE"
                title="Let’s fill in the blanks."
                subtitle="Small details now. Smoother travel days later."
              />
              <div className="details-banner">
                <span className="round-icon">
                  <CalendarCheck size={24} />
                </span>
                <div>
                  <h3>{needs.length} details to sort out</h3>
                  <p>
                    Nothing is booked or verified automatically. You’re in
                    control of every update.
                  </p>
                </div>
              </div>
              <div className="needs-list">
                {needs.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (n.id.endsWith("doc"))
                        setUpload({ eventId: n.eventId });
                      else
                        setEditing(
                          trip.events.find((e) => e.id === n.eventId)!,
                        );
                    }}
                  >
                    <span className="need-circle" />
                    <div>
                      <strong>{n.title}</strong>
                      <p>{n.detail}</p>
                    </div>
                    <ChevronRight size={18} />
                  </button>
                ))}
              </div>
              {!needs.length && (
                <div className="empty-state">
                  <CheckCircle2 />
                  <h2>The essentials are in place.</h2>
                  <p>
                    Keep checking official opening hours and travel conditions
                    before departure.
                  </p>
                </div>
              )}
              <div className="info-note">
                <AlertCircle size={18} />
                <p>
                  Also check official park hours, road conditions, rental
                  instructions, and travel time. These can change and aren’t
                  connected to live services yet.
                </p>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>Made for the journey, not just the destination.</span>
            <span>wayfarer.</span>
          </footer>
        </div>
      </main>
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          <div className="detail-body">
            <div className="detail-meta">
              <span className={"status " + detail.status}>
                {statusLabel[detail.status]}
              </span>
              <span>
                {dateLabel(detail.date)} · {timeLabel(detail.time)}
                {detail.time
                  ? detail.zone === "America/Chicago"
                    ? " CT"
                    : " PT"
                  : ""}
              </span>
            </div>
            <h3>
              <MapPin size={18} />
              {detail.location || "Location to add"}
            </h3>
            <p className="detail-notes">
              {detail.notes ||
                "Add details to make this stop easier on the day."}
            </p>
            {detail.url && (
              <a
                className="official-link"
                href={detail.url}
                target="_blank"
                rel="noreferrer"
              >
                Check official information
                <ExternalLink size={15} />
              </a>
            )}
            <div className="detail-docs">
              <h4>Documents for this stop</h4>
              {documents
                .filter((d) => d.eventId === detail.id)
                .map((d) => (
                  <a
                    key={d.id}
                    href={"/api/documents/" + d.id}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText size={17} />
                    {d.name}
                    <ArrowUpRight size={15} />
                  </a>
                ))}
              {!documents.some((d) => d.eventId === detail.id) && (
                <p className="muted">No document attached yet.</p>
              )}
              <button
                className="text-btn"
                onClick={() => {
                  setUpload({ eventId: detail.id });
                  setDetail(null);
                }}
              >
                <Plus size={15} />
                Attach a ticket or confirmation
              </button>
            </div>
            <footer>
              <button
                className="primary"
                onClick={() => {
                  setEditing(detail);
                  setDetail(null);
                }}
              >
                Edit this stop
                <ArrowRight size={17} />
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {editing && (
        <Editor
          stop={editing}
          onClose={() => setEditing(null)}
          onSave={async (s) => {
            if (s.date < trip.start || s.date > trip.end)
              throw new Error("Choose a date within December 18–25, 2026.");
            if ((s.lat === undefined) !== (s.lng === undefined))
              throw new Error(
                "Provide both latitude and longitude, or leave both blank.",
              );
            await saveTrip({
              ...trip,
              events: trip.events.some((e) => e.id === s.id)
                ? trip.events.map((e) => (e.id === s.id ? s : e))
                : [...trip.events, s],
            });
          }}
          onDelete={
            trip.events.some((e) => e.id === editing.id)
              ? async () => {
                  await saveTrip({
                    ...trip,
                    events: trip.events.filter((e) => e.id !== editing.id),
                  });
                }
              : undefined
          }
        />
      )}
      {upload && (
        <UploadModal
          events={trip.events}
          initial={upload.eventId}
          onClose={() => setUpload(null)}
          onUploaded={refresh}
          onImport={async (stops) =>
            saveTrip({ ...trip, events: [...trip.events, ...stops] })
          }
        />
      )}
      {invite && (
        <Modal
          title="The best trips are shared."
          onClose={() => setInvite(null)}
        >
          <div className="detail-body">
            <p>
              Send this code to your companion along with this app’s address.
              They can choose “Join your companion” on the sign-in page.
            </p>
            <label>
              One-use invitation code
              <input
                readOnly
                value={invite}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <p className="muted">
              Expires in 24 hours. Your companion can view and edit this trip
              and open its documents. Generating a new code replaces the
              previous one.
            </p>
            <button
              className="primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(invite);
                  setToast("Invitation copied.");
                } catch {
                  setToast("Select and copy the invitation code above.");
                }
              }}
            >
              Copy invitation
              <Users size={16} />
            </button>
          </div>
        </Modal>
      )}
      {confirmDoc && (
        <Modal
          title="Remove this document?"
          onClose={() => setConfirmDoc(null)}
        >
          <div className="detail-body">
            <p>
              The original file will be deleted from this workspace. You can
              upload it again if you still have a copy.
            </p>
            <footer>
              <button className="secondary" onClick={() => setConfirmDoc(null)}>
                Keep document
              </button>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await api("/documents/" + confirmDoc, { method: "DELETE" });
                    await refresh();
                    setConfirmDoc(null);
                    setToast("Document removed.");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Remove document
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function PageTitle({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
