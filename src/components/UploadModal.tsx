import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronRight, FileText, Loader2, LockKeyhole, Plus, Trash2, Upload, X } from "lucide-react";
import { dateLabel, timeLabel, type Stop, type Document } from "../model";
import { extractText, parseItinerary } from "../import";
import { matchBooking, type BookingMatch } from "../booking-match";
import { extractHotelCheckout, extractHotelStayDates } from "../hotel-checkout";
import HotelCheckout from "./HotelCheckout";
import "./UploadModal.css";

export type UploadModalProps = {
  events: Stop[];
  version: number;
  tripId: string;
  start: string;
  end: string;
  initial?: string;
  onClose: () => void;
  onUploaded: () => Promise<void>;
  onImport: (stops: Stop[]) => Promise<void>;
};

type QueuedFile = {
  id: string;
  file: File;
  status: "reading" | "ready" | "saving" | "saved" | "skipped" | "review" | "failed" | "invalid";
  eventId: string;
  manualAttachment: boolean;
  showAllStops: boolean;
  conflicts: Document[];
  reviewedDocumentIds: string[];
  outcome: string;
  existingDocument?: Document;
  text: string;
  matching: BookingMatch | null;
  readNotice: string;
  error: string;
  useCheckout: boolean;
  useStayDates: boolean;
};

const MAX_FILES = 50;
const MAX_SIZE = 20 * 1024 * 1024;
const accepted = /\.(pdf|txt|eml|png|jpe?g|webp)$/i;
const proposalKey = (stop: Stop) => `${stop.date}\n${stop.title.trim().toLowerCase()}\n${stop.notes.trim()}`;

function ImageUploadPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    const mime = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
    // A fixed raster MIME type prevents a mislabeled upload from opening as HTML.
    const preview = URL.createObjectURL(new Blob([file], { type: mime }));
    setLoaded(false);
    setFailed(false);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  return <div className="upload-image-preview">
    {url && !failed && <img src={url} alt={`Preview of ${file.name}`} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    {loaded && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${file.name} at full size`}>Open image at full size <ArrowRight size={13} aria-hidden="true" /></a>}
    {failed && <p className="matching-note">Preview unavailable. You can still try saving the original.</p>}
  </div>;
}

export default function UploadModal({ events, version, tripId, start, end, initial, onClose, onUploaded, onImport }: UploadModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const queueRef = useRef<QueuedFile[]>([]);
  const analysisQueue = useRef<Promise<void>>(Promise.resolve());
  const busyRef = useRef(false);
  const versionRef = useRef(version);
  const defaultAttachmentManual = useRef(Boolean(initial));
  const [defaultAttachment, setDefaultAttachment] = useState(initial || "");
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");
  const [selectionNotice, setSelectionNotice] = useState("");
  const [proposals, setProposals] = useState<Stop[]>([]);
  const [notesAdded, setNotesAdded] = useState(0);
  const seenProposals = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    const node = dialog.current;
    node?.showModal();
    return () => { mounted.current = false; node?.close(); };
  }, []);
  useEffect(() => { versionRef.current = Math.max(versionRef.current, version); }, [version]);

  function updateQueue(update: (items: QueuedFile[]) => QueuedFile[]) {
    if (!mounted.current) return;
    queueRef.current = update(queueRef.current);
    setQueue(queueRef.current);
  }
  function updateFile(id: string, update: Partial<QueuedFile> | ((file: QueuedFile) => Partial<QueuedFile>)) {
    updateQueue((items) => items.map((item) => item.id === id
      ? { ...item, ...(typeof update === "function" ? update(item) : update) }
      : item));
  }
  function close() { if (!busyRef.current) onClose(); }

  function chooseFiles(files: FileList | File[]) {
    if (busyRef.current) return;
    const remaining = MAX_FILES - queueRef.current.length;
    const selected = Array.from(files);
    const acceptedFiles = selected.slice(0, Math.max(0, remaining));
    setSelectionNotice(selected.length > remaining ? `You can review up to ${MAX_FILES} files in one batch. Add the remaining files in another batch.` : "");
    setError("");
    const entries: QueuedFile[] = acceptedFiles.map((file) => {
      const validationError = file.size > MAX_SIZE
        ? "Choose a file smaller than 20 MB."
        : !accepted.test(file.name)
          ? "Unsupported file. Use PDF, TXT, EML, PNG, JPG or WebP."
          : !file.size ? "This file is empty. Choose a file with content." : "";
      return {
        id: crypto.randomUUID(), file, eventId: defaultAttachment,
        manualAttachment: defaultAttachmentManual.current,
        showAllStops: false,
        conflicts: [], reviewedDocumentIds: [], outcome: "",
        status: validationError ? "invalid" : "reading",
        text: "", matching: null, readNotice: "", error: validationError, useCheckout: true, useStayDates: true,
      };
    });
    updateQueue((items) => [...items, ...entries]);
    // Parse one file at a time so large PDF batches do not exhaust browser memory.
    analysisQueue.current = analysisQueue.current.catch(() => undefined).then(async () => {
      for (const entry of entries) {
        if (!mounted.current) return;
        if (entry.status === "invalid" || !queueRef.current.some((item) => item.id === entry.id)) continue;
        try {
          const text = await extractText(entry.file);
          if (!mounted.current) return;
          const matching = matchBooking(text, events);
          updateFile(entry.id, (current) => ({
            status: "ready", text, matching,
            eventId: !current.manualAttachment && matching.autoMatchId ? matching.autoMatchId : current.eventId,
            readNotice: text.trim() ? "" : "We couldn’t extract booking details. Images and scanned PDFs need a manual choice; select a stop below or save with the whole trip.",
          }));
        } catch {
          updateFile(entry.id, {
            status: "ready",
            readNotice: "We couldn’t read this file automatically. You can still choose a stop and save the original.",
          });
        }
      }
    });
  }

  async function upload() {
    if (busyRef.current || queueRef.current.some((item) => item.status === "reading")) return;
    const pending = queueRef.current.filter((item) => item.status === "ready" || item.status === "failed");
    if (!pending.length) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    let currentVersion = versionRef.current;
    const newProposals: Stop[] = [];
    try {
      for (const item of pending) {
        updateFile(item.id, { status: "saving", error: "" });
        let stored = false;
        try {
          const attachedStop = events.find((stop) => stop.id === item.eventId);
          const stayDates = attachedStop?.type === "stay" && item.matching?.isBooking
            ? extractHotelStayDates(item.text, attachedStop) : null;
          const checkoutStop = attachedStop && stayDates && item.useStayDates
            ? { ...attachedStop, date: stayDates.start, checkoutDate: stayDates.end }
            : attachedStop;
          const checkout = checkoutStop?.checkoutDate && item.matching?.isBooking
            ? extractHotelCheckout(item.text, checkoutStop) : null;
          const body = new FormData();
          body.append("file", item.file);
          body.append("eventId", item.eventId);
          body.append("uploadId", item.id);
          if(item.reviewedDocumentIds.length) body.append("reviewedDocumentIds",JSON.stringify(item.reviewedDocumentIds));
          if (stayDates && item.useStayDates) {
            body.append("stayStart", stayDates.start);
            body.append("stayEnd", stayDates.end);
            body.append("stayEvidence", stayDates.evidence);
          }
          if (checkout && item.useCheckout) {
            body.append("checkoutTime", checkout.time);
            body.append("checkoutEvidence", checkout.evidence);
          }
          if ((stayDates && item.useStayDates) || (checkout && item.useCheckout)) {
            body.append("version", String(currentVersion));
          }
          const response = await fetch(`/api/documents?${new URLSearchParams({ tripId })}`, { method: "POST", body });
          const result = await response.json() as Document & { error?: string; tripVersion?: number; duplicate?:boolean; keptBoth?:boolean; code?:string; conflicts?:Document[] };
          if(response.status===409 && result.code==="document_conflict" && result.conflicts?.length) {
            updateFile(item.id,{status:"review",conflicts:result.conflicts,reviewedDocumentIds:[],error:""});
            continue;
          }
          if (!response.ok) throw new Error(result.error || "This document could not be saved. Try again.");
          if (typeof result.tripVersion === "number") {
            currentVersion = result.tripVersion;
            versionRef.current = currentVersion;
          }
          // Mark success before refreshing the trip; refresh failure must never resend a saved file.
          stored = true;
          updateFile(item.id, { status: result.duplicate ? "skipped" : "saved", error: "",
            ...(result.duplicate ? {eventId:result.eventId || "",existingDocument:result,outcome:`Already saved as ${result.name}. Duplicate skipped; the existing attachment was kept.`}
              : result.keptBoth ? {outcome:"Both originals kept. Existing booking dates and times were left unchanged."} : {}),
          });
          if(result.duplicate) continue;
          if (!item.eventId && !item.matching?.isBooking) {
            for (const proposal of parseItinerary(item.text, Number(start.slice(0, 4)), { start, end })) {
              if (!proposal.date || proposal.date < start || proposal.date > end) continue;
              const stop = proposal as Stop;
              const key = proposalKey(stop);
              if (seenProposals.current.has(key) || events.some((event) => proposalKey(event) === key)) continue;
              seenProposals.current.add(key);
              newProposals.push(stop);
            }
          }
        } catch (cause) {
          if (stored) setError(`${item.file.name} was saved, but its day notes could not be prepared. You can review the original document.`);
          else updateFile(item.id, { status: "failed", error: cause instanceof Error ? cause.message : "This document could not be saved. Try again." });
        }
      }
      if (newProposals.length) setProposals((current) => [...current, ...newProposals]);
      try {
        await onUploaded();
      } catch {
        setError("Your saved files are safe, but the trip could not refresh. Close this window and reload to see them.");
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const reading = queue.some((item) => item.status === "reading");
  const readyCount = queue.filter((item) => item.status === "ready").length;
  const failedCount = queue.filter((item) => item.status === "failed").length;
  const invalidCount = queue.filter((item) => item.status === "invalid").length;
  const savedCount = queue.filter((item) => item.status === "saved").length;
  const skippedCount = queue.filter((item) => item.status === "skipped").length;
  const reviewCount = queue.filter((item) => item.status === "review").length;
  const pendingCount = readyCount + failedCount;
  const complete = queue.length > 0 && savedCount + skippedCount === queue.length;
  const batch = queue.length > 1;
  const saveLabel = !readyCount && failedCount
    ? `Retry ${failedCount === 1 ? "failed file" : `${failedCount} failed files`}`
    : !batch ? "Save document" : `Save ${pendingCount} document${pendingCount === 1 ? "" : "s"}`;

  function attachmentSelect(item?: QueuedFile) {
    const label = item && batch ? `Attach ${item.file.name} to a stop` : "Attach to a stop";
    const types = item?.matching?.documentTypes || [];
    const filtered = !!item && types.length > 0 && !item.showAllStops;
    const options = filtered ? events.filter(event => types.includes(event.type) || event.id === item.eventId) : events;
    return <div className="upload-attachment-selector"><label>
      Attach to a stop
      <select
        aria-label={label}
        value={item?.eventId ?? defaultAttachment}
        disabled={busy || item?.status === "saved" || item?.status === "invalid"}
        onChange={(event) => {
          if (item) updateFile(item.id, { eventId: event.target.value, manualAttachment: true, useCheckout: true, useStayDates: true, conflicts:[],reviewedDocumentIds:[],...(item.status==="review" ? {status:"ready"} : {}) });
          else { defaultAttachmentManual.current = true; setDefaultAttachment(event.target.value); }
        }}
      >
        <option value="">Whole trip / itinerary</option>
        {options.map((event) => <option key={event.id} value={event.id}>{dateLabel(event.date)} · {event.title}</option>)}
      </select>
    </label>
      {filtered && <p className="matching-note">Showing stops for this document’s booking type. <button type="button" className="text-btn" disabled={busy || item.status === "saved"} onClick={() => updateFile(item.id, { showAllStops: true })}>Show all stops for a manual correction</button></p>}
    </div>;
  }

  return <dialog
    ref={dialog}
    aria-labelledby={titleId}
    className="modal wide"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === dialog.current) close(); }}
  >
    <header>
      <h2 id={titleId}>{complete ? batch ? "Documents tucked away" : "Document tucked away" : "Bring your plans together"}</h2>
      <button type="button" className="icon-btn" aria-label="Close dialog" disabled={busy} onClick={close}><X size={21} /></button>
    </header>
    <div className="upload-body">
      {!complete && <>
        <p className="muted">Upload bookings together and we’ll look for each matching stop in your itinerary.</p>
        <div
          className={`dropzone ${drag && !busy ? "drag" : ""} ${queue.length ? "upload-dropzone-compact" : ""}`}
          onDragOver={(event) => { event.preventDefault(); if (!busy) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(event) => { event.preventDefault(); setDrag(false); if (!busy) chooseFiles(event.dataTransfer.files); }}
        >
          <div className="upload-orb"><Upload size={25} /></div>
          <h3>{queue.length ? "Add more documents" : "Drop your documents here"}</h3>
          <p>or <button type="button" className="text-btn" disabled={busy || queue.length >= MAX_FILES} onClick={() => fileInput.current?.click()}>browse files</button></p>
          <small>PDF, TXT, EML, PNG, JPG or WebP · up to 20 MB each · {MAX_FILES} files per batch</small>
          <input
            ref={fileInput} type="file" hidden multiple disabled={busy}
            accept=".pdf,.txt,.eml,.png,.jpg,.jpeg,.webp"
            onChange={(event) => { if (event.target.files) chooseFiles(event.target.files); event.target.value = ""; }}
          />
        </div>
        {selectionNotice && <p className="matching-note" role="status">{selectionNotice}</p>}
        {!queue.length && attachmentSelect()}
      </>}

      <div className="upload-queue" aria-live="polite">
        {queue.map((item) => {
          const attachedStop = events.find((event) => event.id === item.eventId);
          const stayDates = attachedStop?.type === "stay" && item.matching?.isBooking ? extractHotelStayDates(item.text, attachedStop) : null;
          const checkoutStop = attachedStop && stayDates && item.useStayDates
            ? { ...attachedStop, date: stayDates.start, checkoutDate: stayDates.end }
            : attachedStop;
          const checkout = checkoutStop?.checkoutDate && item.matching?.isBooking ? extractHotelCheckout(item.text, checkoutStop) : null;
          if (item.status === "saved" || item.status === "skipped") return <div className="success-banner" key={item.id}>
            <CheckCircle2 size={22} />
            <span><strong>{item.file.name}</strong><br />{item.outcome || "Original saved."} {attachedStop ? `Attached to ${attachedStop.title}.` : item.status==="saved" || item.existingDocument ? "Kept with the whole trip." : ""}
              {item.existingDocument && <> <a href={`/api/documents/${encodeURIComponent(item.existingDocument.id)}?${new URLSearchParams({tripId})}`} target="_blank" rel="noopener noreferrer">Open existing original</a></>}
            </span>
          </div>;
          return <section key={item.id} className={batch ? "upload-file-card" : "upload-file-single"} aria-label={`Upload ${item.file.name}`}>
            <div className="upload-file-heading">
              <FileText size={20} aria-hidden="true" />
              <div><h3>{item.file.name}</h3><small>{(item.file.size / 1024 / 1024).toFixed(2)} MB{item.status === "saving" ? " · Saving…" : item.status === "failed" || item.status === "invalid" ? " · Not saved" : ""}</small></div>
              <button type="button" className="icon-btn" aria-label={`Remove ${item.file.name}`} disabled={busy} onClick={() => updateQueue((items) => items.filter((entry) => entry.id !== item.id))}><Trash2 size={17} /></button>
            </div>
            {item.status !== "invalid" && /\.(png|jpe?g|webp)$/i.test(item.file.name) && <ImageUploadPreview file={item.file} />}
            {item.status === "reading" && <p className="matching-progress"><Loader2 size={16} className="spin" />Reading your booking and checking the itinerary…</p>}
            {item.status !== "reading" && item.matching?.autoMatchId && item.eventId === item.matching.autoMatchId && <div className="booking-match-banner">
              <CheckCircle2 size={21} />
              <div><strong>Matched to {attachedStop?.title}</strong><p>{item.matching.candidates.find((candidate) => candidate.eventId === item.eventId)?.reasons.slice(0, 2).join(" · ")}. You can change the stop below.</p></div>
            </div>}
            {item.status !== "reading" && item.matching && !item.matching.autoMatchId && item.matching.candidates.length > 0 && <div className="booking-candidates">
              <strong>Choose the matching stop</strong>
              <p>Review the evidence below, then select the stop this document belongs to.</p>
              {item.matching.candidates.map((candidate) => {
                const stop = events.find((event) => event.id === candidate.eventId);
                return stop ? <button key={stop.id} type="button" disabled={busy} aria-pressed={item.eventId === stop.id} onClick={() => updateFile(item.id, { eventId: stop.id, manualAttachment: true, useCheckout: true, useStayDates: true,conflicts:[],reviewedDocumentIds:[],...(item.status==="review" ? {status:"ready"} : {}) })}>
                  <span><strong>{stop.title}</strong><small>{dateLabel(stop.date)} · {stop.location}</small><small>{candidate.reasons.join(" · ")}</small></span><ChevronRight size={17} />
                </button> : null;
              })}
            </div>}
            {item.status !== "reading" && item.matching?.isBooking && !item.matching.candidates.length && <p className="matching-note">No matching stop found. Choose one below or keep the booking with the whole trip.</p>}
            {item.status !== "reading" && item.matching?.notice && <p className="matching-note">{item.matching.notice}</p>}
            {item.readNotice && <p className="matching-note">{item.readNotice}</p>}
            {item.status==="review" && <div className="booking-candidates upload-document-review" role="group" aria-label={`Review possible conflict for ${item.file.name}`}>
              <strong>Another document is already attached to this booking — review before adding</strong>
              <p>This file is different. It may be another passenger’s ticket, a boarding pass, or a changed booking. Open the existing originals to compare.</p>
              <ul>{item.conflicts.map(document=><li key={document.id}><a href={`/api/documents/${encodeURIComponent(document.id)}?${new URLSearchParams({tripId})}`} target="_blank" rel="noopener noreferrer">{document.name}</a></li>)}</ul>
              <p>Keeping both saves the extra original. Your existing booking dates and times stay unchanged; edit the stop separately if they need correcting.</p>
              <button type="button" disabled={busy} onClick={()=>updateFile(item.id,{status:"skipped",outcome:"New file skipped. Existing originals kept.",error:""})}>Keep existing / skip new</button>
              <button type="button" disabled={busy} onClick={()=>{updateFile(item.id,{status:"ready",reviewedDocumentIds:item.conflicts.map(document=>document.id),useCheckout:false,useStayDates:false});void upload();}}>Keep both originals</button>
            </div>}
            {item.status !== "invalid" && attachmentSelect(item)}
            {stayDates && item.status !== "reading" && item.status!=="review" && !item.reviewedDocumentIds.length && <div className="checkout-import">
              <label><input type="checkbox" checked={item.useStayDates} disabled={busy} onChange={(event) => updateFile(item.id, { useStayDates: event.target.checked })} /><span>Save stay dates <strong>{dateLabel(stayDates.start, { month: "short", day: "numeric", year: "numeric" })} – {dateLabel(stayDates.end, { month: "short", day: "numeric", year: "numeric" })}</strong> with this hotel</span></label>
              <p>From this booking: “{stayDates.evidence}”</p>
              {attachedStop && (attachedStop.date !== stayDates.start || (attachedStop.checkoutDate && attachedStop.checkoutDate !== stayDates.end)) && <p>This replaces the saved stay dates: {dateLabel(attachedStop.date, { month: "short", day: "numeric", year: "numeric" })}{attachedStop.checkoutDate ? ` – ${dateLabel(attachedStop.checkoutDate, { month: "short", day: "numeric", year: "numeric" })}` : " (checkout date missing)"}.</p>}
              <small>The same booking will be available throughout this stay, including checkout day.</small>
            </div>}
            {checkout && item.status !== "reading" && item.status!=="review" && !item.reviewedDocumentIds.length && <div className="checkout-import">
              <label><input type="checkbox" checked={item.useCheckout} disabled={busy} onChange={(event) => updateFile(item.id, { useCheckout: event.target.checked })} /><span>Save checkout at <strong>{timeLabel(checkout.time)}</strong> with this stay</span></label>
              <p>From this booking: “{checkout.evidence}”</p>
              {attachedStop?.checkout && attachedStop.checkout.time !== checkout.time && <p>This replaces the saved checkout time of {timeLabel(attachedStop.checkout.time)}.</p>}
              <small>Checkout is a deadline. You can leave earlier for your day’s plans.</small>
            </div>}
            {attachedStop?.type === "stay" && attachedStop.checkoutDate && item.status !== "reading" && !checkout && item.status !== "invalid" && <HotelCheckout stop={attachedStop} stops={events} />}
            {item.error && <p className="error" role="alert">{item.error}</p>}
          </section>;
        })}
      </div>

      {!complete && <div className="info-note"><LockKeyhole size={17} /><span>Only people with access to your private trip can open these files. Originals are kept in your private document collection.</span></div>}
      {(failedCount > 0 || invalidCount > 0) && <p className="matching-note" role="status">{failedCount + invalidCount} file{failedCount + invalidCount === 1 ? " was" : "s were"} not saved. {savedCount ? `${savedCount} saved file${savedCount === 1 ? " is" : "s are"} safe and won’t be sent again. ` : ""}{invalidCount ? "Remove unsupported or oversized files to finish this batch. " : ""}{failedCount ? "You can retry failed uploads." : ""}</p>}
      {reviewCount>0 && <p className="matching-note" role="status">{reviewCount} document{reviewCount===1 ? " needs" : "s need"} your choice before being saved. Existing originals are safe.</p>}

      {proposals.length > 0 && <>
        <h3>Review extracted day notes</h3>
        <p className="muted">We found dated sections. These are suggested notes, not verified bookings. Edit titles or remove duplicates before adding them.</p>
        <div className="proposal-list">{proposals.map((stop, index) => <div className="proposal" key={stop.id}>
          <span>{dateLabel(stop.date)}</span>
          <input aria-label={`Imported title ${index + 1}`} value={stop.title} disabled={busy} onChange={(event) => setProposals((items) => items.map((item) => item.id === stop.id ? { ...item, title: event.target.value } : item))} />
          <button type="button" aria-label="Discard suggestion" className="icon-btn" disabled={busy} onClick={() => setProposals((items) => items.filter((item) => item.id !== stop.id))}><X size={17} /></button>
          <details><summary>Extracted notes</summary><pre>{stop.notes}</pre></details>
        </div>)}</div>
      </>}
      {complete && !proposals.length && <p className="muted">{queue.some((item) => item.eventId || item.matching?.isBooking)
        ? "Your booking documents are available with the selected itinerary stops or in the trip’s document collection. No new itinerary stops were added."
        : queue.some((item) => item.text)
          ? "No supported dated sections found. Your originals are saved; add or edit a stop to fill in its details."
          : "These files need a manual review. Image and scanned-ticket recognition is not connected yet; your originals are ready to use."}</p>}
      {notesAdded > 0 && <p className="matching-note" role="status">{notesAdded} reviewed note{notesAdded === 1 ? "" : "s"} added.</p>}
      {queue.filter((item) => item.status === "saved" && item.text).map((item) => <details key={item.id} className="extracted">
        <summary>{batch ? `View extracted text · ${item.file.name}` : "View extracted text"}</summary><pre>{item.text.slice(0, 30000)}</pre>
      </details>)}
      {error && <p className="error" role="alert">{error}</p>}
      <footer className="upload-batch-footer">
        {savedCount + skippedCount > 0 && <button type="button" className="secondary" disabled={busy} onClick={close}>Done</button>}
        {!complete && <button type="button" disabled={!pendingCount || busy || reading} className="primary" onClick={() => void upload()}>
          {busy ? <><Loader2 className="spin" size={16} />Saving…</> : <>{saveLabel}<ArrowRight size={17} /></>}
        </button>}
        {proposals.length > 0 && <button type="button" className="primary" disabled={busy || reading || proposals.some((stop) => !stop.title.trim())} onClick={async () => {
          if (busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          setError("");
          try {
            await onImport(proposals);
            setNotesAdded((count) => count + proposals.length);
            setProposals([]);
            if (complete) onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "The notes could not be added. Try again.");
          } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
        }}>Add {proposals.length} reviewed notes<Plus size={16} /></button>}
      </footer>
    </div>
  </dialog>;
}
