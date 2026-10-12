import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Compass, Loader2, LockKeyhole, X } from "lucide-react";
import "./NewTripModal.css";

export type NewTripInput = {
  id: string;
  title: string;
  start: string;
  end: string;
};

export default function NewTripModal({ onCreate, onClose }: {
  onCreate: (input: NewTripInput) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const introId = useId();
  const errorId = useId();
  const [id] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  const dismiss = () => {
    if (!submitting.current) onClose();
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    if (!title.trim()) { setError("Give your trip a name to get started."); return; }
    if (title.trim().length > 200) { setError("Choose a trip name with 200 characters or fewer."); return; }
    if (!start || !end) { setError("Choose a start date and an end date for your trip."); return; }
    const startTime = Date.parse(`${start}T00:00:00Z`);
    const endTime = Date.parse(`${end}T00:00:00Z`);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) { setError("Enter valid dates for your trip."); return; }
    if (endTime < startTime) { setError("Your end date needs to be on or after your start date."); return; }
    if ((endTime - startTime) / 86_400_000 > 366) { setError("Choose dates no more than 366 days apart."); return; }
    submitting.current = true;
    setBusy(true);
    try {
      await onCreate({ id, title: title.trim(), start, end });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your trip couldn’t be created. Please try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal new-trip-modal"
      aria-labelledby={titleId}
      aria-describedby={introId}
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onClick={(event) => { if (event.target === dialog.current) dismiss(); }}
    >
      <header>
        <h2 id={titleId}>Create a trip</h2>
        <button type="button" className="icon-btn" aria-label="Close dialog" disabled={busy} onClick={dismiss}><X size={21} aria-hidden="true" /></button>
      </header>
      <form className="editor new-trip-form" onSubmit={submit} noValidate aria-busy={busy}>
        <div className="new-trip-intro" id={introId}>
          <span className="new-trip-compass"><Compass size={23} aria-hidden="true" /></span>
          <div><h3>A new trip, a fresh start.</h3><p>Add the basics now. Your itinerary and bookings can follow.</p></div>
        </div>
        <fieldset disabled={busy}>
          <label>Trip name
            <input name="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A weekend by the coast" autoFocus required maxLength={200} autoComplete="off" aria-describedby={error ? errorId : undefined} />
          </label>
          <div className="form-row">
            <label>Start date
              <input name="start" type="date" value={start} onChange={(event) => setStart(event.target.value)} required aria-describedby={error ? errorId : undefined} />
            </label>
            <label>End date
              <input name="end" type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} required aria-describedby={error ? errorId : undefined} />
            </label>
          </div>
        </fieldset>
        <p className="new-trip-private"><LockKeyhole size={13} aria-hidden="true" /> Saved in your private travel workspace.</p>
        {error && <p className="error" id={errorId} role="alert">{error}</p>}
        <footer>
          <button type="button" className="btn secondary" disabled={busy} onClick={dismiss}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? <><Loader2 size={16} className="spin" aria-hidden="true" /> Creating trip…</> : <>Create trip <ArrowRight size={16} aria-hidden="true" /></>}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
