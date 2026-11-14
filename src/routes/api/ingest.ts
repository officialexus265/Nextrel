import { createFileRoute } from "@tanstack/react-router";
import { acceptDevicePayload } from "@/lib/fleet/api";
import { isDecoderName } from "@/lib/fleet/decoders";

export const Route = createFileRoute("/api/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const text = await request.text();
          if (text.length > 8000) {
            return new Response(JSON.stringify({ error: "Packet is too large" }), { status: 413 });
          }
          const url = new URL(request.url);
          const queryDecoder = url.searchParams.get("decoder");
          const queryImei = url.searchParams.get("imei");
          let body = text;
          if (queryImei && !text.trim().startsWith("{")) {
            body = JSON.stringify({ imei: queryImei, hex: text.trim() });
          }
          const decoder = queryDecoder && isDecoderName(queryDecoder) ? queryDecoder : undefined;
          const result = await acceptDevicePayload(body, { decoder });
          return new Response(JSON.stringify({ ok: true, count: result.fixes.length }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "ingest failed";
          const status = message.includes("Unknown") ? 404 : message.includes("Unauthorized") || message.includes("Forbidden") ? 401 : message.includes("Too many") ? 429 : 400;
          return new Response(JSON.stringify({ error: message }), { status });
        }
      },
    },
  },
});
