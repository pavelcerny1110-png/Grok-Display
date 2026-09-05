import { DurableObject } from "cloudflare:workers";
import { DisplayEngine, emptyState, type CommandInput, type DisplayState } from "./engine";

interface Env {
  DISPLAY: DurableObjectNamespace<DisplayDO>;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Display-Token",
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { ...CORS, "Cache-Control": "no-store" } });
}

export class DisplayDO extends DurableObject<Env> {
  private async run<T>(fn: (engine: DisplayEngine) => T): Promise<T> {
    const state = (await this.ctx.storage.get<DisplayState>("state")) || emptyState();
    const engine = new DisplayEngine(state);
    const result = fn(engine);
    if (engine.dirty) await this.ctx.storage.put("state", engine.state);
    return result;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    try {
      if (path === "/api/display" && request.method === "GET") {
        const data = await this.run((engine) => engine.getDisplayData());
        return json(data);
      }
      if (path === "/api/action" && request.method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        const data = await this.run((engine) => engine.performDisplayAction(body));
        return json(data);
      }
      if (path === "/api/command" && request.method === "POST") {
        const body = (await request.json()) as CommandInput & { commands?: CommandInput[] };
        const data = await this.run((engine) => {
          if (Array.isArray(body.commands)) {
            const results = body.commands.map((command) => engine.enqueueCommand(command));
            return { ok: true, results, data: engine.getDisplayData() };
          }
          return { ok: true, ...engine.enqueueCommand(body) };
        });
        return json(data);
      }
      if (path === "/api/log" && request.method === "GET") {
        const serviceId = url.searchParams.get("serviceId") || url.searchParams.get("service_id") || "";
        const data = await this.run((engine) => engine.getOrderLog(serviceId || undefined));
        return json(data);
      }
      return json({ ok: false, message: "Not found" }, 404);
    } catch (error) {
      return json({ ok: false, message: error instanceof Error ? error.message : String(error) }, 400);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (url.pathname.startsWith("/api/")) {
      const id = env.DISPLAY.idFromName("kitchen");
      return env.DISPLAY.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
