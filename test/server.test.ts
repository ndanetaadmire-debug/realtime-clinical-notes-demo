import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { streamConsultation } from "../src/consultation.js";
import { buildServer } from "../src/server.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

async function connect(logs: string[] = []) {
  const app = buildServer({ log: (l) => logs.push(l), namesFor: (id) => (id === "enc-1" ? ["Thandi", "Mokoena"] : []) });
  await app.listen({ port: 0, host: "127.0.0.1" });
  close = () => app.close();
  const port = (app.server.address() as { port: number }).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/encounters/enc-1/stream`);
  const inbox: Array<Record<string, any>> = [];
  ws.on("message", (m) => inbox.push(JSON.parse(String(m))));
  await new Promise((r) => ws.once("open", r));
  const send = (m: object) => ws.send(JSON.stringify({ v: 1, ...m }));
  const settle = () => new Promise((r) => setTimeout(r, 150));
  return { ws, inbox, send, settle };
}

describe("WebSocket protocol", () => {
  it("streams captions instantly and note updates on finals, with latency", async () => {
    const logs: string[] = [];
    const { inbox, send, settle, ws } = await connect(logs);
    for (const segment of streamConsultation()) send({ type: "segment", segment });
    await settle();
    expect(inbox[0]).toMatchObject({ type: "ready" });
    const notes = inbox.filter((m) => m.type === "note");
    expect(notes.length).toBe(8);
    expect(notes.at(-1)!.note.items.length).toBeGreaterThan(10);
    expect(typeof notes[0]!.latencyMs).toBe("number");
    expect(inbox.filter((m) => m.type === "transcript").length).toBeGreaterThan(notes.length);
    expect(logs.length).toBeGreaterThan(5);
    expect(logs.some((l) => l.includes("Thandi"))).toBe(false); // patient name redacted from every log line
    expect(logs.some((l) => l.includes("[NAME]"))).toBe(true);
    ws.close();
  });

  it("supports review and sign-off over the socket, and locks afterwards", async () => {
    const { inbox, send, settle, ws } = await connect();
    send({ type: "segment", segment: { id: "a", speaker: "patient", text: "I have a cough", startMs: 0, endMs: 900, final: true } });
    await settle();
    const item = inbox.find((m) => m.type === "note")!.note.items[0];
    send({ type: "sign", clinician: "Dr B" });
    await settle();
    expect(inbox.at(-1)).toMatchObject({ type: "error", error: expect.stringMatching(/need review/) });
    send({ type: "review", itemId: item.id, action: "accept" });
    send({ type: "sign", clinician: "Dr B" });
    await settle();
    expect(inbox.at(-1)).toMatchObject({ type: "signed", rendered: "S:\n- Cough" });
    send({ type: "segment", segment: { id: "b", speaker: "patient", text: "and a fever", startMs: 1000, endMs: 1900, final: true } });
    await settle();
    expect(inbox.at(-1)).toMatchObject({ type: "error", error: "note_locked" });
    ws.close();
  });

  it("rejects malformed and unversioned messages without dropping the connection", async () => {
    const { inbox, ws, settle, send } = await connect();
    ws.send("not json");
    ws.send(JSON.stringify({ type: "segment" }));
    send({ type: "segment", segment: { id: "z", speaker: "robot", text: "x", startMs: 0, endMs: 1, final: true } });
    await settle();
    expect(inbox.filter((m) => m.type === "error")).toHaveLength(3);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
