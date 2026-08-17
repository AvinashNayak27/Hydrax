import { createServer } from "node:http";
import { createApp } from "./app.js";

const app = createApp();
const port = Number(process.env.PORT ?? 3000);
createServer(async (request, response) => {
  try {
    const host = request.headers.host ?? "localhost";
    const path = request.url?.startsWith("/") ? request.url : "/";
    const result = await app(new Request(`http://${host}${path}`, { method: request.method ?? "GET", headers: request.headers as HeadersInit }));
    response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: "internal server error" }));
  }
}).listen(port, "0.0.0.0", () => console.log(`BlastCut API listening on http://localhost:${port}`));
