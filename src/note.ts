import { drugClass, extract } from "./extract.js";
import type { Alert, Note, NoteItem, Segment } from "./types.js";

export class NoteLockedError extends Error {}

/**
 * Incremental note builder. Partials update the live transcript only; the note changes on final
 * segments, so the clinician isn't distracted by text flickering as recognition revises itself.
 * Duplicate facts merge their evidence instead of repeating. Clinician decisions always win.
 */
export class NoteBuilder {
  private readonly segments = new Map<string, Segment>();
  private readonly note: Note;

  constructor(encounterId: string) {
    this.note = { encounterId, items: [], alerts: [], version: 0 };
  }

  /** Returns true if the note changed. */
  ingest(seg: Segment): boolean {
    if (this.note.signedAt) throw new NoteLockedError("note is signed");
    const prev = this.segments.get(seg.id);
    if (prev?.final) return false; // finals are immutable; late duplicates are ignored
    this.segments.set(seg.id, seg);
    if (!seg.final) return false;

    let changed = false;
    for (const it of extract(seg)) {
      const dup = this.note.items.find((x) => x.kind === it.kind && x.text.toLowerCase() === it.text.toLowerCase());
      if (dup) {
        if (!dup.evidence.includes(seg.id)) dup.evidence.push(seg.id);
        continue;
      }
      // A later pertinent negative and an earlier positive for the same symptom conflict: flag, don't guess.
      this.note.items.push(it);
      changed = true;
    }
    if (changed) {
      this.note.alerts = computeAlerts(this.note.items);
      this.note.version++;
    }
    return changed;
  }

  review(itemId: string, action: "accept" | "reject" | { edit: string }): NoteItem {
    if (this.note.signedAt) throw new NoteLockedError("note is signed");
    const it = this.note.items.find((x) => x.id === itemId);
    if (!it) throw new Error(`unknown item ${itemId}`);
    if (action === "accept") it.status = "accepted";
    else if (action === "reject") it.status = "rejected";
    else {
      it.text = action.edit.trim();
      it.status = "edited";
    }
    this.note.alerts = computeAlerts(this.note.items);
    this.note.version++;
    return it;
  }

  /** Sign-off requires every suggestion to be reviewed and every critical alert to be resolved. */
  sign(clinician: string, at = new Date()): Note {
    const pending = this.note.items.filter((x) => x.status === "suggested");
    if (pending.length) throw new Error(`${pending.length} suggested item(s) still need review`);
    if (this.note.alerts.some((a) => a.level === "critical")) throw new Error("resolve critical alerts before signing");
    this.note.signedBy = clinician;
    this.note.signedAt = at.toISOString();
    this.note.version++;
    return this.snapshot();
  }

  snapshot(): Note {
    return structuredClone(this.note);
  }

  transcript(): Segment[] {
    return [...this.segments.values()].sort((a, b) => a.startMs - b.startMs);
  }

  /** The signed note only contains accepted/edited items; rejected suggestions are kept in the audit, not the note. */
  render(): string {
    const live = this.note.items.filter((i) => i.status !== "rejected");
    const sec = (s: NoteItem["section"], title: string) => {
      const xs = live.filter((i) => i.section === s);
      return xs.length ? `${title}\n${xs.map((i) => `- ${i.text}`).join("\n")}` : "";
    };
    return [sec("subjective", "S:"), sec("objective", "O:"), sec("assessment", "A:"), sec("plan", "P:")].filter(Boolean).join("\n\n");
  }
}

export function computeAlerts(items: NoteItem[]): Alert[] {
  const live = items.filter((i) => i.status !== "rejected");
  const alerts: Alert[] = [];
  const allergies = live.filter((i) => i.kind === "allergy");
  for (const p of live.filter((i) => i.kind === "plan" && i.text.startsWith("Prescribe"))) {
    const drug = p.text.split(" ")[1]!;
    for (const a of allergies) {
      const allergen = a.text.replace("Allergy: ", "");
      const sameClass = drugClass(drug) && (drugClass(drug) === drugClass(allergen) || drugClass(drug) === allergen.toLowerCase());
      if (sameClass) {
        alerts.push({ level: "critical", message: `${drug} conflicts with documented ${allergen} allergy`, evidence: [...p.evidence, ...a.evidence] });
      }
    }
  }
  const pos = live.filter((i) => i.kind === "symptom").map((i) => i.text.toLowerCase());
  for (const n of live.filter((i) => i.kind === "pertinent_negative" && i.text.startsWith("Denies"))) {
    const s = n.text.slice(7).toLowerCase();
    if (pos.includes(s)) alerts.push({ level: "warning", message: `Contradiction: ${s} both reported and denied`, evidence: n.evidence });
  }
  return alerts;
}
