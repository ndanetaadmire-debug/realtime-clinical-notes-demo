import type { Segment } from "./types.js";

/** A synthetic GP consultation (no real patient data), streamed with partial hypotheses like real ASR. */
const LINES: Array<[Segment["speaker"], string]> = [
  ["clinician", "Hi Thandi, what brings you in today?"],
  ["patient", "I've had a sore throat and a fever for three days, and a bit of a cough."],
  ["patient", "No shortness of breath, no chest pain."],
  ["clinician", "Are you taking anything for it?"],
  ["patient", "I've been taking paracetamol. Oh, and I'm allergic to penicillin."],
  ["clinician", "Okay. Your temperature is 38.4 and your heart rate is 96. Sats are 98 percent."],
  ["clinician", "On examination, your tonsils are swollen with white exudate."],
  ["clinician", "This looks like bacterial tonsillitis."],
  ["clinician", "I'll prescribe azithromycin 500 mg once a day for three days."],
  ["clinician", "Come back if you're not better in 48 hours."],
];

export function* streamConsultation(): Generator<Segment> {
  let t = 0;
  for (const [i, [speaker, text]] of LINES.entries()) {
    const words = text.split(" ");
    const dur = words.length * 350;
    // Partials grow word by word, then a final replaces them (same id).
    for (let k = Math.ceil(words.length / 2); k < words.length; k += Math.ceil(words.length / 3)) {
      yield { id: `s${i + 1}`, speaker, text: words.slice(0, k).join(" "), startMs: t, endMs: t + (dur * k) / words.length, final: false };
    }
    yield { id: `s${i + 1}`, speaker, text, startMs: t, endMs: t + dur, final: true };
    t += dur + 400;
  }
}
