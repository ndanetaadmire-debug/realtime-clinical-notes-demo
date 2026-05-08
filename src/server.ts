import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { NoteBuilder, NoteLockedError } from "./note.js";
import { redactPhi } from "./phi.js";

const SegmentSchema = z.object({
  id: z.string().min(1).max(64),
  speaker: z.enum(["clinician", "patient"]),
  text: z.string().max(2000),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  final: z.boolean(),
});

/** Versioned client→server protocol. Unknown or malformed messages get an error frame, never a crash. */
const ClientMessage = z.discriminatedUnion("type", [
  z.object({ v: z.literal(1), type: z.literal("segment"), segment: SegmentSchema }),
  z.object({ v: z.literal(1), type: z.literal("review"), itemId: z.string(), action: z.union([z.enum(["accept", "reject"]), z.object({ edit: z.string().min(1).max(500) })]) }),
  z.object({ v: z.literal(1), type: z.literal("sign"), clinician: z.string().min(2) }),
]);

export interface ServerOptions {
  log?: (line: string) => void;
  /** Patient (and family) names for an encounter, from the scheduling system, so logs can redact them. */
  namesFor?: (encounterId: string) => string[];
  now?: () => number;
}

export function buildServer(opts: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const encounters = new Map<string, NoteBuilder>();
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => performance.now());
  app.register(websocket);

  app.get("/healthz", async () => ({ status: "ok", encounters: encounters.size }));

  app.register(async (scoped) => {
    scoped.get("/v1/encounters/:id/stream", { websocket: true }, (socket, req) => {
      const { id } = req.params as { id: string };
      const builder = encounters.get(id) ?? new NoteBuilder(id);
      encounters.set(id, builder);
      const send = (m: object) => socket.send(JSON.stringify({ v: 1, ...m }));
      send({ type: "ready", note: builder.snapshot() });

      socket.on("message", (raw) => {
        let msg: z.infer<typeof ClientMessage>;
        try {
          msg = ClientMessage.parse(JSON.parse(String(raw)));
        } catch {
          return send({ type: "error", error: "invalid_message" });
        }
        try {
          if (msg.type === "segment") {
            const t0 = now();
            send({ type: "transcript", segment: msg.segment }); // echo immediately: the live caption
            if (builder.ingest(msg.segment)) send({ type: "note", note: builder.snapshot(), latencyMs: Math.round(now() - t0) });
            if (msg.segment.final) log(`encounter=${id} segment=${msg.segment.id} speaker=${msg.segment.speaker} text="${redactPhi(msg.segment.text, opts.namesFor?.(id) ?? [])}"`);
          } else if (msg.type === "review") {
            builder.review(msg.itemId, msg.action);
            send({ type: "note", note: builder.snapshot() });
          } else {
            const signed = builder.sign(msg.clinician);
            send({ type: "signed", note: signed, rendered: builder.render() });
          }
        } catch (err) {
          send({ type: "error", error: err instanceof NoteLockedError ? "note_locked" : (err as Error).message });
        }
      });
    });
  });

  return app;
}
