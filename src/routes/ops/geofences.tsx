import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { deleteGeofence, getAppSession, listGeofences, saveGeofence, setGeofenceActive } from "@/lib/fleet/api";
import { haversine, scheduleIsOpen } from "@/lib/fleet/geo";
import { FenceStudioMap, type FenceDraft } from "@/components/map/fence-studio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FenceSchedule, GeofenceRow } from "@/lib/fleet/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ops/geofences")({ component: GeofencesPage });

const DAYS = [
  { id: 1, label: "M", name: "Monday" },
  { id: 2, label: "T", name: "Tuesday" },
  { id: 3, label: "W", name: "Wednesday" },
  { id: 4, label: "T", name: "Thursday" },
  { id: 5, label: "F", name: "Friday" },
  { id: 6, label: "S", name: "Saturday" },
  { id: 0, label: "S", name: "Sunday" },
];

const GROUPS = ["Depots", "Client sites", "Corridors", "Forbidden"];

function GeofencesPage() {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["app-session"], queryFn: () => getAppSession() });
  const q = useQuery({ queryKey: ["geofences"], queryFn: () => listGeofences() });
  const canEdit = Boolean(
    session.data && ["super_admin", "company_admin"].includes(session.data.role) && session.data.companyId,
  );

  const [drawing, setDrawing] = useState(false);
  const [kind, setKind] = useState<FenceDraft["kind"]>("circle");
  const [zoneType, setZone] = useState<"allowed" | "forbidden">("allowed");
  const [name, setName] = useState("");
  const [groupName, setGroupName] = useState("Client sites");
  const [points, setPoints] = useState<[number, number][]>([]);
  const [radius, setRadius] = useState(400);
  const [width, setWidth] = useState(160);
  const [timed, setTimed] = useState(false);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState("06:00");
  const [end, setEnd] = useState("18:00");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const fences = q.data ?? [];
  const draft: FenceDraft | null = drawing ? { kind, points, radiusM: radius, widthM: width } : null;

  const canSave =
    canEdit &&
    name.trim().length >= 2 &&
    ((kind === "circle" && points.length >= 1) ||
      (kind === "polygon" && points.length >= 3) ||
      (kind === "route" && points.length >= 2)) &&
    (!timed || days.length > 0);

  function onMapClick(lat: number, lng: number) {
    if (!drawing) return;
    if (kind === "circle") {
      if (points.length === 0) {
        setPoints([[lat, lng]]);
      } else {
        const metres = Math.round(haversine({ lat: points[0][0], lng: points[0][1] }, { lat, lng }));
        setRadius(Math.min(50_000, Math.max(40, metres)));
      }
      return;
    }
    setPoints((prev) => {
      const cap = kind === "polygon" ? 24 : 40;
      if (prev.length >= cap) return prev;
      return [...prev, [lat, lng]];
    });
  }

  function beginDraw() {
    setDrawing(true);
    setPoints([]);
    setSelectedId(null);
    setName("");
  }

  const mut = useMutation({
    mutationFn: () => {
      const geometry =
        kind === "circle"
          ? { type: "circle" as const, lat: points[0][0], lng: points[0][1], radiusM: radius }
          : kind === "polygon"
            ? { type: "polygon" as const, points }
            : { type: "route" as const, path: points, widthM: width };
      const schedule: FenceSchedule | null = timed ? { days, start, end } : null;
      return saveGeofence({
        data: { name: name.trim(), kind, zoneType, groupName, geometry, schedule },
      });
    },
    onSuccess: () => {
      toast.success("Geofence saved");
      setDrawing(false);
      setPoints([]);
      setName("");
      qc.invalidateQueries({ queryKey: ["geofences"] });
      qc.invalidateQueries({ queryKey: ["live-fleet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (args: { id: string; active: boolean }) => setGeofenceActive({ data: args }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["geofences"] });
      qc.invalidateQueries({ queryKey: ["live-fleet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hint =
    kind === "circle"
      ? points.length === 0
        ? "Click the map to place the centre."
        : "Click again to set the radius, or type metres."
      : kind === "polygon"
        ? "Click each corner. Three points close the shape."
        : "Click along the road. Width is the corridor tolerance.";

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-0 flex-col md:h-[calc(100dvh-3.5rem)] lg:flex-row">
      <aside className="order-2 flex max-h-[48%] min-h-0 w-full flex-col border-t border-border bg-surface lg:order-1 lg:max-h-none lg:w-96 lg:border-r lg:border-t-0">
        <div className="border-b border-border px-4 py-3">
          <div className="text-xs uppercase tracking-[0.16em] text-subtle">Zones</div>
          <h1 className="text-lg font-semibold tracking-tight">Geofences</h1>
          <p className="mt-1 text-sm text-muted">Circles, polygons, and route corridors. Schedules use Nairobi time.</p>
          <div className="mt-3 flex gap-1">
            <Button size="sm" variant={!drawing ? "default" : "secondary"} onClick={() => setDrawing(false)}>
              Library
            </Button>
            <Button size="sm" variant={drawing ? "default" : "secondary"} onClick={beginDraw} disabled={!canEdit && !drawing}>
              Draw
            </Button>
          </div>
          {!canEdit && (
            <p className="mt-2 text-xs text-idle">View as a company admin to draw fences for that tenant.</p>
          )}
        </div>

        {drawing ? (
          <form
            className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) mut.mutate();
            }}
          >
            <p className="text-sm text-muted">{hint}</p>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Westlands depot" />
            </div>
            <div className="space-y-1">
              <Label>Shape</Label>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    ["circle", "Circle"],
                    ["polygon", "Polygon"],
                    ["route", "Corridor"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setKind(id);
                      setPoints([]);
                    }}
                    className={cn(
                      "h-10 rounded-[var(--radius-sm)] border text-sm",
                      kind === id ? "border-accent bg-accent text-accent-fg" : "border-border text-muted",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Zone</Label>
                <select
                  className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 text-sm"
                  value={zoneType}
                  onChange={(e) => setZone(e.target.value as typeof zoneType)}
                >
                  <option value="allowed">Allowed</option>
                  <option value="forbidden">Forbidden</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Group</Label>
                <Input list="fence-groups" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                <datalist id="fence-groups">
                  {GROUPS.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>
            </div>
            {kind === "circle" && (
              <div className="space-y-1">
                <Label>Radius (m)</Label>
                <Input type="number" min={40} max={50000} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
              </div>
            )}
            {kind === "route" && (
              <div className="space-y-1">
                <Label>Corridor width (m)</Label>
                <Input type="number" min={20} max={2000} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
              </div>
            )}
            <div className="rounded-[var(--radius-md)] border border-border p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} />
                Active only on a schedule
              </label>
              {timed && (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-1">
                    {DAYS.map((d) => {
                      const on = days.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          aria-label={d.name}
                          title={d.name}
                          onClick={() => setDays((prev) => (on ? prev.filter((x) => x !== d.id) : [...prev, d.id]))}
                          className={cn(
                            "grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] border text-sm",
                            on ? "border-accent bg-accent text-accent-fg" : "border-border text-muted",
                          )}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start" />
                    <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End" />
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-subtle">
              <span>
                {kind === "circle" ? (points.length ? "Centre set" : "No centre") : `${points.length} points`}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-muted hover:text-fg"
                onClick={() => setPoints((p) => (kind === "circle" ? [] : p.slice(0, -1)))}
              >
                <Undo2 className="size-3.5" /> Undo
              </button>
            </div>
            <Button className="w-full" type="submit" disabled={!canSave || mut.isPending}>
              Save geofence
            </Button>
          </form>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            {fences.length === 0 && <p className="px-4 py-6 text-sm text-muted">No geofences for this company yet.</p>}
            <ul>
              {fences.map((g) => (
                <FenceRow
                  key={g.id}
                  fence={g}
                  selected={selectedId === g.id}
                  confirming={confirmId === g.id}
                  canEdit={canEdit}
                  onSelect={() => {
                    setSelectedId(g.id);
                    setFocus(centerOf(g));
                    setConfirmId(null);
                  }}
                  onToggle={() => toggle.mutate({ id: g.id, active: !g.active })}
                  onAskRemove={() => setConfirmId(g.id)}
                  onCancelRemove={() => setConfirmId(null)}
                  onRemove={async () => {
                    await deleteGeofence({ data: { id: g.id } });
                    if (selectedId === g.id) setSelectedId(null);
                    setConfirmId(null);
                    qc.invalidateQueries({ queryKey: ["geofences"] });
                  }}
                />
              ))}
            </ul>
          </div>
        )}
      </aside>
      <section className={cn("relative order-1 min-h-[52%] min-w-0 flex-1 lg:order-2", drawing && "fence-draw")}>
        <FenceStudioMap
          fences={fences}
          draft={draft}
          drawing={drawing}
          selectedId={selectedId}
          focus={focus}
          onMapClick={onMapClick}
          onSelect={(id) => {
            setSelectedId(id);
            const g = fences.find((f) => f.id === id);
            if (g) setFocus(centerOf(g));
          }}
          className="h-full w-full"
        />
        <div className="pointer-events-none absolute left-3 top-3 z-[500] flex gap-2">
          <span className="rounded-full border border-border bg-surface/90 px-2 py-1 text-xs text-info">Allowed</span>
          <span className="rounded-full border border-border bg-surface/90 px-2 py-1 text-xs text-down">Forbidden</span>
          {drawing && <span className="rounded-full border border-border bg-surface/90 px-2 py-1 text-xs text-live">Draft</span>}
        </div>
      </section>
    </div>
  );
}

function FenceRow({
  fence,
  selected,
  confirming,
  canEdit,
  onSelect,
  onToggle,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: {
  fence: GeofenceRow;
  selected: boolean;
  confirming: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
}) {
  const open = useMemo(() => scheduleIsOpen(fence.schedule), [fence.schedule]);
  return (
    <li className={cn("border-b border-border px-4 py-3", selected && "bg-surface-2")}>
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium">{fence.name}</div>
            <div className="mt-0.5 text-xs uppercase tracking-wide text-subtle">
              {fence.kind === "route" ? "corridor" : fence.kind} · {fence.groupName ?? "Ungrouped"}
            </div>
          </div>
          <Badge tone={fence.zoneType === "forbidden" ? "down" : "info"}>{fence.zoneType}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge tone={fence.active ? "live" : "muted"}>{fence.active ? "Armed" : "Paused"}</Badge>
          <Badge tone={fence.schedule ? (open ? "idle" : "muted") : "muted"}>{scheduleLabel(fence.schedule, open)}</Badge>
        </div>
      </button>
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="secondary" onClick={onToggle}>
            {fence.active ? "Pause" : "Arm"}
          </Button>
          {confirming ? (
            <>
              <Button size="sm" variant="danger" onClick={onRemove}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancelRemove}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={onAskRemove}>
              Remove
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function scheduleLabel(schedule: FenceSchedule | null, open: boolean) {
  if (!schedule) return "Always";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = [...schedule.days].sort((a, b) => a - b).map((d) => names[d]);
  return `${open ? "In window" : "Off hours"} · ${days.join(" ")} ${schedule.start}–${schedule.end}`;
}

function centerOf(g: GeofenceRow): [number, number] {
  if (g.geometry.type === "circle") return [g.geometry.lat, g.geometry.lng];
  const pts = g.geometry.type === "polygon" ? g.geometry.points : g.geometry.path;
  if (pts.length === 0) return [-1.286, 36.82];
  const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [lat, lng];
}
