import { streamConsultation } from "./consultation.js";
import { NoteBuilder } from "./note.js";

// Offline walkthrough: stream the consultation, watch the note build, review, and sign.
const b = new NoteBuilder("enc-demo");
for (const seg of streamConsultation()) {
  if (seg.final) console.log(`${seg.speaker === "clinician" ? "Dr " : "Pt "}| ${seg.text}`);
  const before = b.snapshot().items.length;
  if (b.ingest(seg)) {
    const added = b.snapshot().items.slice(before).map((i) => `+${i.text}`);
    console.log(`   ↳ note v${b.snapshot().version}: ${added.join("  ")}`);
  }
}
for (const a of b.snapshot().alerts) console.log(`⚠ ${a.level}: ${a.message}`);
for (const it of b.snapshot().items) b.review(it.id, "accept");
b.sign("Dr N. Dlamini");
console.log(`\n${b.render()}`);
