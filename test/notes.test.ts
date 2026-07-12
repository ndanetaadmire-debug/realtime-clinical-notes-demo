import { beforeEach, describe, expect, it } from "vitest";
import { streamConsultation } from "../src/consultation.js";
import { _resetIds, extract } from "../src/extract.js";
import { NoteBuilder, NoteLockedError } from "../src/note.js";
import { redactPhi } from "../src/phi.js";
import type { Segment } from "../src/types.js";

let n = 0;
const seg = (speaker: Segment["speaker"], text: string, final = true, id = `s${++n}`): Segment => ({ id, speaker, text, startMs: n * 1000, endMs: n * 1000 + 900, final });
const texts = (s: Segment) => extract(s).map((i) => `${i.kind}:${i.text}`);

beforeEach(() => {
  _resetIds();
  n = 0;
});

describe("extraction", () => {
  it("handles negation per clause, not per sentence", () => {
    expect(texts(seg("patient", "No fever, but I have a terrible headache and some nausea"))).toEqual(["pertinent_negative:Denies fever", "symptom:Headache", "symptom:Nausea"]);
    expect(texts(seg("patient", "I denied chest pain to the nurse, however I do have palpitations"))).toEqual(["pertinent_negative:Denies chest pain", "symptom:Palpitations"]);
  });

  it("captures duration, allergies and current medication", () => {
    expect(texts(seg("patient", "It's been going on for about two weeks"))).toEqual(["duration:Duration: about two weeks"]);
    expect(texts(seg("patient", "I'm allergic to penicillin"))).toEqual(["allergy:Allergy: Penicillin"]);
    expect(texts(seg("patient", "No known allergies"))).toEqual(["pertinent_negative:No known allergies"]);
    expect(texts(seg("patient", "I've been taking ibuprofen"))).toEqual(["medication:Current medication: Ibuprofen"]);
  });

  it("extracts vitals, exam, assessment and a structured prescription from the clinician", () => {
    expect(texts(seg("clinician", "Blood pressure is 128 over 82 and pulse 74"))).toEqual(["vital:BP 128/82 mmHg", "vital:Heart rate 74 bpm"]);
    expect(texts(seg("clinician", "I'll prescribe amoxicillin 500 mg three times a day for seven days"))).toEqual(["plan:Prescribe Amoxicillin 500 mg three times a day for seven days"]);
    expect(texts(seg("clinician", "On examination, your chest is clear."))).toEqual(["history:Exam: Chest is clear"]);
  });

  it("never extracts from partial hypotheses or invents facts", () => {
    expect(extract(seg("patient", "I have a fev", false))).toEqual([]);
    expect(extract(seg("patient", "How was your weekend?"))).toEqual([]);
  });
});

describe("incremental note", () => {
  it("partials update the caption only; the note changes on finals", () => {
    const b = new NoteBuilder("e1");
    expect(b.ingest(seg("patient", "I have a sore", false, "x"))).toBe(false);
    expect(b.snapshot().items).toEqual([]);
    expect(b.ingest(seg("patient", "I have a sore throat", true, "x"))).toBe(true);
    expect(b.ingest(seg("patient", "I have a sore throat and fever", true, "x"))).toBe(false); // finals are immutable
    expect(b.snapshot().items.map((i) => i.text)).toEqual(["Sore throat"]);
  });

  it("repeated facts merge evidence instead of duplicating", () => {
    const b = new NoteBuilder("e1");
    b.ingest(seg("patient", "I have a cough", true, "a"));
    b.ingest(seg("patient", "Yes the cough is worse at night", true, "b"));
    expect(b.snapshot().items).toMatchObject([{ text: "Cough", evidence: ["a", "b"] }]);
  });

  it("raises a CRITICAL alert when a prescription conflicts with a documented allergy class", () => {
    const b = new NoteBuilder("e1");
    b.ingest(seg("patient", "I'm allergic to penicillin", true, "p1"));
    b.ingest(seg("clinician", "I'll prescribe amoxicillin 500 mg three times a day", true, "c1"));
    expect(b.snapshot().alerts).toEqual([{ level: "critical", message: "Amoxicillin conflicts with documented Penicillin allergy", evidence: ["c1", "p1"] }]);
  });

  it("flags contradictions rather than guessing", () => {
    const b = new NoteBuilder("e1");
    b.ingest(seg("patient", "I've got a fever"));
    b.ingest(seg("patient", "No fever actually"));
    expect(b.snapshot().alerts[0]).toMatchObject({ level: "warning", message: "Contradiction: fever both reported and denied" });
  });

  it("sign-off requires every item reviewed and critical alerts resolved; then the note is locked", () => {
    const b = new NoteBuilder("e1");
    b.ingest(seg("patient", "I'm allergic to penicillin"));
    b.ingest(seg("clinician", "I'll prescribe amoxicillin 250 mg twice a day"));
    const [allergy, rx] = b.snapshot().items;
    expect(() => b.sign("Dr A")).toThrow(/still need review/);
    b.review(allergy!.id, "accept");
    b.review(rx!.id, "accept");
    expect(() => b.sign("Dr A")).toThrow(/critical alerts/);
    b.review(rx!.id, { edit: "Prescribe Azithromycin 500 mg once a day for three days" });
    const signed = b.sign("Dr A", new Date("2026-11-14T10:00:00Z"));
    expect(signed).toMatchObject({ signedBy: "Dr A", signedAt: "2026-11-14T10:00:00.000Z", alerts: [] });
    expect(() => b.ingest(seg("patient", "one more thing"))).toThrow(NoteLockedError);
    expect(b.render()).toContain("P:\n- Prescribe Azithromycin");
  });

  it("rejected suggestions stay out of the rendered note", () => {
    const b = new NoteBuilder("e1");
    b.ingest(seg("patient", "I have a headache and a rash"));
    b.review(b.snapshot().items[1]!.id, "reject");
    expect(b.render()).toBe("S:\n- Headache");
  });

  it("builds the full synthetic consultation into a complete SOAP note", () => {
    const b = new NoteBuilder("demo");
    for (const s of streamConsultation()) b.ingest(s);
    const note = b.snapshot();
    expect(note.items.every((i) => i.evidence.length > 0)).toBe(true);
    expect(new Set(note.items.map((i) => i.section))).toEqual(new Set(["subjective", "objective", "assessment", "plan"]));
    expect(note.items.map((i) => i.text)).toEqual(expect.arrayContaining(["Allergy: Penicillin", "Denies chest pain", "Temperature 38.4 °C", "Bacterial tonsillitis"]));
    expect(note.alerts).toEqual([]); // azithromycin is not a penicillin
  });
});

describe("PHI redaction", () => {
  it("removes identifiers from log lines", () => {
    expect(redactPhi("Thandi Mokoena, ID 8001015009087, call 082 123 4567 or t@x.co.za, born 1 January 1980", ["Thandi", "Mokoena"]))
      .toBe("[NAME] [NAME], ID [ID_NUMBER], call [PHONE] or [EMAIL], born [DATE]");
  });
});
