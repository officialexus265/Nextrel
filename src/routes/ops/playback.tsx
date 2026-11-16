import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { getPlayback, listVehicles } from "@/lib/fleet/api";
import { PlaybackMap, type PlaybackEvent } from "@/components/map/playback-map";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { formatSpeed } from "@/lib/utils";

export const Route = createFileRoute("/ops/playback")({ component: PlaybackPage });

function PlaybackPage() {
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => listVehicles() });
  const [vehicleId, setVehicleId] = useState<string>(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("vehicleId") ?? "");
  const to = new Date();
  const from = new Date(to.getTime() - 8 * 3600_000);
  const play = useQuery({
    queryKey: ["playback", vehicleId],
    queryFn: () => getPlayback({ data: { vehicleId, from: from.toISOString(), to: to.toISOString() } }),
    enabled: Boolean(vehicleId),
  });
  const points = play.data?.points ?? [];
  const events = (play.data?.events ?? []) as PlaybackEvent[];
  const markers = events.filter((e) => e.kind !== "stop");
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [rate, setRate] = useState(4);

  useEffect(() => {
    setIndex(0);
    setRunning(false);
  }, [vehicleId]);

  useEffect(() => {
    if (!running || points.length === 0) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1 >= points.length ? 0 : i + 1));
    }, Math.max(40, 400 / rate));
    return () => window.clearInterval(id);
  }, [running, points.length, rate]);

  const current = points[index];
  const list = vehicles.data ?? [];
  useEffect(() => {
    if (!vehicleId && list[0]) setVehicleId(list[0].id);
  }, [list, vehicleId]);

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col md:h-[calc(100dvh-3.5rem)]">
      <PageHeader title="Trip playback" subtitle="Last eight hours of recorded positions." />
      <div className="flex flex-wrap items-center gap-2 px-4 md:px-6">
        <select
          className="h-10 rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm"
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
        >
          {list.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate} — {v.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="secondary" onClick={() => setRunning((r) => !r)} disabled={points.length === 0}>
          {running ? <Pause className="size-4" /> : <Play className="size-4" />}
          {running ? "Pause" : "Play"}
        </Button>
        {[1, 4, 16].map((r) => (
          <Button key={r} size="sm" variant={rate === r ? "default" : "secondary"} onClick={() => setRate(r)}>
            {r}x
          </Button>
        ))}
        {current && (
          <span className="tabular text-sm text-muted">
            {formatSpeed(current.speed)} · {current.address} · {new Date(current.ts).toLocaleTimeString()}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 p-4 md:px-6">
        <div className="h-full overflow-hidden rounded-[var(--radius-lg)] border border-border">
          {points.length > 0 ? (
            <PlaybackMap points={points} index={index} events={events} className="h-full w-full" />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted">
              {play.isFetching ? "Loading history…" : "No positions in this window."}
            </div>
          )}
        </div>
      </div>
      {points.length > 0 && (
        <div className="space-y-2 px-4 pb-16 md:px-6 md:pb-6">
          <input
            type="range"
            min={0}
            max={points.length - 1}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            className="w-full"
          />
          {markers.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {markers.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setIndex(nearestIndex(points, e.ts))}
                  className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted hover:text-fg"
                >
                  {e.type.replaceAll("_", " ")} · {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function nearestIndex(points: { ts: string }[], ts: string) {
  const target = new Date(ts).getTime();
  let best = 0;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = Math.abs(new Date(p.ts).getTime() - target);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}
