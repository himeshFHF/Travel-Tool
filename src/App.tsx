"use client";
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
import { checkoutStayForReminder } from "./hotel-checkout";
import HotelCheckout from "./components/HotelCheckout";
import { documentsForDay, documentsForStop, hotelStayForStop } from "./document-links";
import FlightCheckIn from "./components/FlightCheckIn";
import RouteReview from "./components/RouteReview";
import DayDirections from "./components/DayDirections";
import { applyReviewedOrder } from "./route-review";
import NewTripModal from "./components/NewTripModal";
import UploadModal from "./components/UploadModal";

type User = { name: string; email: string };
type Snapshot = {
  id: string;
  trip: Trip;
  version: number;
  documents: Document[];
  members: { name: string }[];
};
type TripSummary = {id:string;title:string;start:string;end:string;stopCount:number;documentCount:number};
const tripLabel = (id:string,title:string) => id==="california" && title==="California, together." ? "California escape" : title;
const readTripId = () => new URLSearchParams(window.location.hash.split("?")[1] || "").get("trip") || "california";
const pageHash = (page:string,tripId:string) => `#${page}${tripId==="california" ? "" : `?trip=${encodeURIComponent(tripId)}`}`;
async function api<T = { version: number }>(url: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch("/api" + url, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  const data = await r.json() as T & { error?: string };
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
          <div className="form-row"><label>
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
          </label>{value.checkoutDate && <label>
            Checkout deadline (local time)
            <input type="time" value={value.checkout?.time || ""} onChange={(e)=>setValue(v=>({...v,checkout:e.target.value ? {time:e.target.value,source:"manual"} : undefined}))} />
          </label>}</div>
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
export default function App({ user }: { user: User }) {

  const [state, setState] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const readPage = () => {
    const value = window.location.hash.slice(1).split("?")[0];
    return ["trips", "day", "overview", "documents", "details"].includes(value) ? value : "day";
  };
  const [page, setPage] = useState(readPage);
  const [tripId, setTripId] = useState(readTripId);
  const [tripList, setTripList] = useState<TripSummary[]>([]);
  const [newTrip, setNewTrip] = useState(false);
  const [date, setDate] = useState("");
  const loadSequence = useRef(0);
  const [now, setNow] = useState(new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Stop | null>(null);
  const [editing, setEditing] = useState<Stop | null>(null);
  const [upload, setUpload] = useState<{ eventId?: string } | null>(null);
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [savingRoute, setSavingRoute] = useState(false);
  const [confirmDoc, setConfirmDoc] = useState<string | null>(null);
  const tripQuery = `?tripId=${encodeURIComponent(tripId)}`;
  const documentUrl = (id:string) => `/api/documents/${encodeURIComponent(id)}${tripQuery}`;
  const refresh = async () => {
    const sequence=++loadSequence.current;
    const [snapshot,collection] = await Promise.all([api<Snapshot>("/trip"+tripQuery),api<{trips:TripSummary[]}>("/trips")]);
    if(sequence!==loadSequence.current || readTripId()!==tripId) return;
    setState(snapshot); setTripList(collection.trips);
    setDate(current=>current>=snapshot.trip.start && current<=snapshot.trip.end ? current : localDate()>=snapshot.trip.start && localDate()<=snapshot.trip.end ? localDate() : snapshot.trip.start);
  };
  useEffect(() => {
    let active=true;
    setState(null); setError(""); setDate("");
    refresh().catch((e)=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[tripId]);
  useEffect(() => {
    const syncPage = () => {
      setPage(readPage());
      setTripId(readTripId());
      setMenu(false);
      setDetail(null);
      setEditing(null);
      setUpload(null);
      setConfirmDoc(null);
      setNewTrip(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);
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
    const r = await api("/trip"+tripQuery, {
      method: "PUT",
      body: JSON.stringify({ trip, version: state.version }),
    });
    setState({ ...state, trip, version: r.version });
    setTripList(items=>items.map(item=>item.id===tripId ? {...item,title:trip.title,start:trip.start,end:trip.end,stopCount:trip.events.length} : item));
    setToast("Your plans are saved.");
  }
  if (!state || state.id!==tripId)
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
  const isCalifornia = tripId==="california";
  const name = tripLabel(tripId,trip.title);
  const dateRange = `${dateLabel(trip.start,{month:"short",day:"numeric",year:"numeric"})} – ${dateLabel(trip.end,{month:"short",day:"numeric",year:"numeric"})}`;
  const tripDates = Array.from(
    {
      length:
        Math.round((Date.parse(trip.end) - Date.parse(trip.start)) / 864e5) + 1,
    },
    (_, i) =>
      new Date(Date.parse(trip.start) + i * 864e5).toISOString().slice(0, 10),
  );
  const stops = trip.events.filter((e) => e.date === date);
  const dayDocuments = documentsForDay(date,documents,trip.events);
  const detailDocuments = detail ? documentsForStop(detail,documents,trip.events) : [];
  const detailCheckoutStay = detail ? checkoutStayForReminder(detail, trip.events) : undefined;
  const detailTime = detailCheckoutStay?.checkout?.time || detail?.time || "";
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
    window.location.hash = pageHash(p,tripId);
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
        <a className="brand" href="#trips">
          <span className="brand-symbol">w</span>wayfarer
          <span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR TRAVEL SPACE</div>
        <nav>
          <button className={page === "trips" ? "active" : ""} onClick={() => navigate("trips")}>
            <FolderOpen size={19} />My trips
          </button>
          {page !== "trips" && <>
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
          </>}
        </nav>
        {page !== "trips" && <div className="sidebar-trip">
          <div className="tiny-landscape">
            <Mountain size={50} />
            <span>{isCalifornia ? "THE GOLDEN STATE" : "YOUR NEXT CHAPTER"}</span>
          </div>
          <strong>{name}</strong>
          <span>{dateRange}</span>
          <div className="travelers">
            <div className="avatar">{members[0]?.name[0]?.toUpperCase()}</div>
            {members[1] ? (
              <div className="avatar second">
                {members[1].name[0].toUpperCase()}
              </div>
            ) : null}
            <small>
              {members.length === 2 ? "Better together" : "Private to you"}
            </small>
          </div>
        </div>}
        <div className="sidebar-bottom">
          <div className="account">
            <span className="avatar account-avatar">
              {user.name[0].toUpperCase()}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>Personal workspace</small>
            </span>
            <a className="icon-btn" title="Sign out" aria-label="Sign out" href="/signout-with-chatgpt?return_to=%2F" target="_top"><LogOut size={17} /></a>
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
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {page === "trips" ? <span aria-current="page">My trips</span> : <>
              <a href={pageHash("trips",tripId)}>My trips</a>
              <ChevronRight size={14} />
              <span>{name}</span>
            </>}
          </nav>
          {page !== "trips" &&
          <div className="top-actions">
            <span className="private-label">
              <LockKeyhole size={13} />
              Private trip
            </span>
            <button className="secondary compact" onClick={() => setUpload({})}>
              <Upload size={15} />
              Add documents
            </button>
          </div>}
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
          {page === "trips" && <>
            <div className="trips-heading"><PageTitle eyebrow="YOUR NEXT CHAPTER" title="My trips" subtitle="Your plans, documents, and little details. All in one place." /><button className="primary" onClick={()=>setNewTrip(true)}><Plus size={18} />New trip</button></div>
            <div className="trips-grid">
              {tripList.map(item=><a key={item.id} className="trip-collection-card" href={pageHash("day",item.id)} aria-label={`Open ${tripLabel(item.id,item.title)}`}>
                <div className="trip-collection-art"><Sun size={48} /><Mountain size={110} /><span>{item.id==="california" ? "THE GOLDEN STATE" : "A NEW ADVENTURE"}</span></div>
                <div className="trip-collection-body">
                  <span className="eyebrow">{today<item.start ? "UPCOMING TRIP" : today>item.end ? "PAST TRIP" : "ON YOUR JOURNEY"}</span>
                  <h2>{tripLabel(item.id,item.title)}</h2>
                  <p><CalendarDays size={15} />{dateLabel(item.start,{month:"short",day:"numeric",year:"numeric"})} – {dateLabel(item.end, {month:"short",day:"numeric",year:"numeric"})}</p>
                  <div className="trip-collection-details"><span>{Math.round((Date.parse(item.end)-Date.parse(item.start))/864e5)+1} days</span><span>{item.stopCount} stops</span><span>{item.documentCount} documents</span></div>
                  <div className="trip-collection-open"><span>Open trip</span><ArrowUpRight size={20} /></div>
                </div>
              </a>)}
            </div>
          </>}
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
                    {isCalifornia && trip.title==="California, together." ? <>California,<br /><em>together.</em></> : trip.title}
                  </h1>
                  <p>{isCalifornia ? "A little city. A little desert. A lot to remember." : "Your places, your plans. A new journey begins here."}</p>
                  <div className="hero-meta">
                    <span>
                      <CalendarDays size={15} />
                      {dateRange}
                    </span>
                    <span>
                      <Users size={15} />{members.length} {members.length===1 ? "traveler" : "travelers"}
                    </span>
                    <span>{tripDates.length} {tripDates.length===1 ? "day" : "days"}, your way</span>
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
                    <Navigation size={14} /> {isCalifornia ? "WEST COAST, BEST COMPANY" : "MAKE ROOM FOR THE JOURNEY"}
                  </div>
                </div>
              </section>
              <div className="date-strip">
                <div className="date-intro">
                  <span>{dateLabel(date,{month:"long"}).toUpperCase()}</span>
                  <strong>{date.slice(0,4)}</strong>
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
                    <span>{trip.start.slice(0,7)!==trip.end.slice(0,7) ? dateLabel(d,{month:"short",weekday:"short"}) : dateLabel(d, { weekday: "short" })}</span>
                    <strong>{Number(d.slice(-2))}</strong>
                    <small>
                      {trip.events.some(stop=>stop.date===d && stop.type==="flight") ? (
                        <Plane size={12} />
                      ) : isCalifornia && i === 1 ? (
                        <Navigation size={12} />
                      ) : isCalifornia && (i === 3 || i === 4) ? (
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
                    {((isCalifornia ? dayPlaces[dayIndex] : stops[0]?.location) || "YOUR PLANS").toUpperCase()}
                  </div>
                  <h2>{isCalifornia ? dayTitles[dayIndex] || dateLabel(date) : stops.length ? "Your day, your way." : "A day full of possibility."}</h2>
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
                    const docs = documentsForStop(stop,documents,trip.events);
                    const checkingOut = checkoutStayForReminder(stop,trip.events);
                    const displayTime = checkingOut?.checkout?.time || stop.time;
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
                              {checkingOut ? "Checkout by " : ""}{timeLabel(displayTime)}
                              {displayTime && (
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
                            {checkingOut?.checkout ? "Checkout time from your saved stay details. Leave earlier if your day’s route needs it." : <>{stop.notes.split(". ")[0]}{stop.notes.includes(". ") ? "." : ""}</>}
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
                              href={documentUrl(docs[0].id)}
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
                      <DayDirections trip={trip} date={date} variant="icon" />
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
                    <DayDirections trip={trip} date={date} />
                  </section>
                  <RouteReview trip={trip} date={date} saving={savingRoute} onApply={async (routeDate)=>{
                    setSavingRoute(true);
                    try { await saveTrip(applyReviewedOrder(trip, routeDate)); }
                    catch (e) { setError((e as Error).message); }
                    finally { setSavingRoute(false); }
                  }} />
                  {dayDocuments.length > 0 && <section className="day-documents" aria-label="Documents for this day">
                    <div className="section-heading"><h3>Documents for this day</h3><FileText size={18} /></div>
                    <p>Tickets and bookings for this day, including your hotel stay.</p>
                    {dayDocuments.map(document=><a key={document.id} href={documentUrl(document.id)} target="_blank" rel="noreferrer"><FileText size={16} /><span>{document.name}</span><ArrowUpRight size={15}/></a>)}
                  </section>}
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
                      <HotelCheckout stop={tonight} stops={trip.events} documents={documents} tripId={tripId} />
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
                        {isCalifornia && dayIndex === 3
                          ? "Today includes two long drives plus Death Valley. Confirm road conditions and leave room for daylight."
                          : isCalifornia && dayIndex === 4
                            ? "A full Joshua Tree morning and a drive to San Diego. Set departure times before filling every stop."
                            : isCalifornia && dayIndex === 2
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
                title={`${tripDates.length} days. Endless possibilities.`}
                subtitle={isCalifornia ? "From city lights to desert skies, and back to the coast." : "Your journey, one day at a time."}
              />
              <div className="stats">
                <div>
                  <strong>{tripDates.length}</strong>
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
                      {trip.events.some(e=>e.date===d&&e.type==="flight") ? (
                        <Plane size={36} />
                      ) : isCalifornia && (i === 3 || i === 4) ? (
                        <Mountain size={42} />
                      ) : isCalifornia && i === 1 ? (
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
                      <h3>{(isCalifornia ? dayPlaces[i] : trip.events.find(e=>e.date===d)?.location) || `Day ${i+1}`}</h3>
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
                          href={documentUrl(d.id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {d.name}
                            <ArrowUpRight size={15} />
                          </a>
                          <p>
                            {trip.events.find((e) => e.id === d.eventId)
                              ?.title || "Whole trip"}{" "}
                            {(() => { const linked=trip.events.find(e=>e.id===d.eventId); const stay=linked ? hotelStayForStop(linked,trip.events) : undefined; return stay?.checkoutDate ? ` · ${dateLabel(stay.date)}–${dateLabel(stay.checkoutDate)} (whole stay)` : ""; })()}
                            {" "}· {Math.max(1, Math.round(d.size / 1024))} KB
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
                {dateLabel(detail.date)} · {detailCheckoutStay ? "Checkout by " : ""}{timeLabel(detailTime)}
                {detailTime
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
            {detail.type === "stay" && <HotelCheckout stop={detail} stops={trip.events} documents={documents} tripId={tripId} />}
            {detail.type === "flight" && <FlightCheckIn stop={detail} now={now} onUpload={()=>{setUpload({eventId:detail.id});setDetail(null);}} />}
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
              {detailDocuments
                .map((d) => (
                  <a
                    key={d.id}
                    href={documentUrl(d.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText size={17} />
                    {d.name}
                    <ArrowUpRight size={15} />
                  </a>
                ))}
              {!detailDocuments.length && (
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
              {detailCheckoutStay && <button className="secondary" onClick={()=>{setEditing(detailCheckoutStay);setDetail(null);}}>Edit hotel checkout</button>}
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
              throw new Error(`Choose a date within ${dateRange}.`);
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
          key={tripId}
          events={trip.events}
          tripId={tripId}
          start={trip.start}
          end={trip.end}
          version={state.version}
          initial={upload.eventId}
          onClose={() => setUpload(null)}
          onUploaded={refresh}
          onImport={async (stops) =>
            saveTrip({ ...trip, events: [...trip.events, ...stops] })
          }
        />
      )}
      {newTrip && <NewTripModal onClose={()=>setNewTrip(false)} onCreate={async(input)=>{
        const created=await api<{id:string}>("/trips",{method:"POST",body:JSON.stringify(input)});
        setNewTrip(false); setDate(""); window.location.hash=pageHash("day",created.id);
      }} />}
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
                    await api("/documents/" + confirmDoc + tripQuery, { method: "DELETE" });
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
