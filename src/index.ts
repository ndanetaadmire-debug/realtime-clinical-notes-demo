import { buildServer } from "./server.js";

const app = buildServer({ log: (l) => console.log(l) });
await app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" });
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void app.close().then(() => process.exit(0)));
