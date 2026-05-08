/** Redact identifiers before anything is logged or sent to analytics. Logs are not a medical record. */
export function redactPhi(text: string, knownNames: string[] = []): string {
  let out = text
    .replace(/\b\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{7}\b/g, "[ID_NUMBER]")
    .replace(/(?:\+27|0)(?:[\s-]?\d){9}\b/g, "[PHONE]")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[EMAIL]")
    .replace(/\b\d{1,2}\s(?:january|february|march|april|may|june|july|august|september|october|november|december)\s\d{4}\b/gi, "[DATE]");
  for (const n of knownNames.filter((x) => x.length > 1)) out = out.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "[NAME]");
  return out;
}
