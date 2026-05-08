export type Speaker = "clinician" | "patient";

/** A transcript segment from streaming speech recognition. Partials are revised until `final`. */
export interface Segment {
  id: string;
  speaker: Speaker;
  text: string;
  startMs: number;
  endMs: number;
  final: boolean;
}

export type Section = "subjective" | "objective" | "assessment" | "plan";

export type ItemKind = "symptom" | "pertinent_negative" | "duration" | "medication" | "allergy" | "vital" | "assessment" | "plan" | "history";

/** One line of the note. `evidence` points to the exact transcript segments it came from. */
export interface NoteItem {
  id: string;
  section: Section;
  kind: ItemKind;
  text: string;
  evidence: string[]; // segment ids
  status: "suggested" | "accepted" | "edited" | "rejected";
}

export interface Alert {
  level: "warning" | "critical";
  message: string;
  evidence: string[];
}

export interface Note {
  encounterId: string;
  items: NoteItem[];
  alerts: Alert[];
  signedBy?: string;
  signedAt?: string;
  version: number;
}
