import type { ItemKind, NoteItem, Section, Segment } from "./types.js";

/**
 * Clinical fact extraction from final transcript segments.
 *
 * In production this step is an LLM with a strict output schema; here it's a deterministic rule set,
 * so the demo runs offline and the *contract* is testable: every item must cite the segment(s) it came
 * from, negations become pertinent negatives (never positives), and nothing is inferred that wasn't said.
 */

const SYMPTOMS = ["headache", "fever", "cough", "chest pain", "shortness of breath", "nausea", "vomiting", "dizziness", "sore throat", "rash", "fatigue", "abdominal pain", "back pain", "palpitations", "runny nose", "earache"];
const NEGATION = /\b(no|not|denies|denied|without|never had|don't have|haven't had|no history of)\b/;
const DRUGS: Record<string, string> = {
  amoxicillin: "penicillin", "co-amoxiclav": "penicillin", penicillin: "penicillin", flucloxacillin: "penicillin",
  ibuprofen: "nsaid", diclofenac: "nsaid", naproxen: "nsaid", aspirin: "nsaid",
  paracetamol: "analgesic", codeine: "opioid", tramadol: "opioid", azithromycin: "macrolide", cetirizine: "antihistamine",
};

const lower = (s: string) => s.toLowerCase();
let seq = 0;
const item = (section: Section, kind: ItemKind, text: string, seg: Segment): NoteItem => ({ id: `n${++seq}`, section, kind, text, evidence: [seg.id], status: "suggested" });

/** Split a sentence on commas/'and' so "no fever, but a bad cough" negates fever only. */
function clauses(text: string): string[] {
  return lower(text).split(/,|;|\bbut\b|\bhowever\b|\.\s/).map((c) => c.trim()).filter(Boolean);
}

export function extract(seg: Segment): NoteItem[] {
  if (!seg.final) return [];
  const out: NoteItem[] = [];
  const t = lower(seg.text);

  if (seg.speaker === "patient") {
    for (const c of clauses(seg.text)) {
      for (const s of SYMPTOMS) {
        if (!new RegExp(`\\b${s}\\b`).test(c)) continue;
        const negated = NEGATION.test(c.slice(0, c.indexOf(s)));
        out.push(item("subjective", negated ? "pertinent_negative" : "symptom", negated ? `Denies ${s}` : cap(s), seg));
      }
    }
    const dur = t.match(/\b(?:for|since)\s+((?:about|around)?\s*(?:\d+|one|two|three|four|five|six|seven|a|an|a couple of|a few)\s+(?:hours?|days?|weeks?|months?))/);
    if (dur) out.push(item("subjective", "duration", `Duration: ${dur[1]!.trim()}`, seg));
    const allergy = t.match(/\ballergic to ([a-z-]+)|\b([a-z-]+) allergy\b/);
    if (allergy && !/\bno (known )?allerg/.test(t)) out.push(item("subjective", "allergy", `Allergy: ${cap(allergy[1] ?? allergy[2]!)}`, seg));
    if (/\bno (known )?allerg/.test(t)) out.push(item("subjective", "pertinent_negative", "No known allergies", seg));
    for (const drug of Object.keys(DRUGS)) {
      if (new RegExp(`\\b(taking|take|took|on)\\b[^.]*\\b${drug}\\b`).test(t)) out.push(item("subjective", "medication", `Current medication: ${cap(drug)}`, seg));
    }
  } else {
    const temp = t.match(/\btemperature (?:is |of )?(\d{2}(?:\.\d)?)/);
    if (temp) out.push(item("objective", "vital", `Temperature ${temp[1]} °C`, seg));
    const bp = t.match(/\bblood pressure (?:is |of )?(\d{2,3}) over (\d{2,3})/);
    if (bp) out.push(item("objective", "vital", `BP ${bp[1]}/${bp[2]} mmHg`, seg));
    const hr = t.match(/\b(?:heart rate|pulse) (?:is |of )?(\d{2,3})/);
    if (hr) out.push(item("objective", "vital", `Heart rate ${hr[1]} bpm`, seg));
    const sats = t.match(/\b(?:sats|saturation|oxygen) (?:are |is |of )?(\d{2,3}) ?(?:%|percent)/);
    if (sats) out.push(item("objective", "vital", `SpO₂ ${sats[1]}%`, seg));
    const exam = t.match(/\b(?:on examination|exam shows|i can see|i can hear)\b,?\s*(.+?)(?:\.|$)/);
    if (exam) out.push(item("objective", "history", `Exam: ${cap(exam[1]!.trim().replace(/^(your|the patient's|his|her) /, ""))}`, seg));
    const dx = t.match(/\b(?:looks like|consistent with|i think (?:it's|this is)|likely)\s+(?:a |an )?(.+?)(?:\.|,|$)/);
    if (dx) out.push(item("assessment", "assessment", cap(dx[1]!.trim()), seg));
    for (const drug of Object.keys(DRUGS)) {
      const m = t.match(new RegExp(`\\b(?:prescribe|start you on|give you|i'll put you on)\\b[^.]*?\\b(${drug})\\b(?:\\s+(\\d+\\s?mg))?(?:[^.]*?\\b(three times a day|twice a day|once a day|daily))?(?:[^.]*?\\bfor (\\w+ days))?`));
      if (m) out.push(item("plan", "plan", [`Prescribe ${cap(m[1]!)}`, m[2], m[3], m[4] && `for ${m[4]}`].filter(Boolean).join(" "), seg));
    }
    const follow = t.match(/\b(?:come back|follow up|return) (?:in|if|after) (.+?)(?:\.|$)/);
    if (follow) out.push(item("plan", "plan", `Follow up ${follow[0].match(/\b(in|if|after)\b/)![0]} ${follow[1]!.trim()}`, seg));
  }
  return out;
}

export function drugClass(name: string): string | undefined {
  return DRUGS[lower(name)];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const _resetIds = () => (seq = 0);
