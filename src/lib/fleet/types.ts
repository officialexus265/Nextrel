export const ROLES = [
  "super_admin",
  "field_admin",
  "company_admin",
  "tracker",
  "accounts",
  "pending",
] as const;

export type Role = (typeof ROLES)[number];

export type MovementState = "moving" | "idle" | "stopped" | "offline";

export const DEVICE_CAPABILITIES = [
  "gps_tracking",
  "ignition_status",
  "fuel_level",
  "battery_status",
  "gsm_signal",
  "gps_signal",
  "temperature_sensor",
  "door_sensor",
  "sos_button",
  "canbus_data",
  "engine_immobilize",
  "engine_restore",
  "remote_restart",
  "remote_locate",
  "camera_snapshot",
  "buzzer",
  "central_lock",
] as const;

export type DeviceCapability = (typeof DEVICE_CAPABILITIES)[number];

export const DEVICE_CAPABILITY_LABELS: Record<DeviceCapability, string> = {
  gps_tracking: "GPS tracking",
  ignition_status: "Ignition detection",
  fuel_level: "Fuel monitoring",
  battery_status: "Battery monitoring",
  gsm_signal: "GSM signal",
  gps_signal: "GPS signal",
  temperature_sensor: "Temperature sensor",
  door_sensor: "Door sensor",
  sos_button: "SOS button",
  canbus_data: "CAN bus data",
  engine_immobilize: "Engine immobilizer (cut)",
  engine_restore: "Engine restore",
  remote_restart: "Remote restart",
  remote_locate: "Remote locate",
  camera_snapshot: "Camera snapshot",
  buzzer: "Buzzer / alarm",
  central_lock: "Central locking",
};

export type DeviceConnectionMode = "live" | "simulated";

export type AlertType =
  | "offline"
  | "speeding"
  | "geofence_enter"
  | "geofence_exit"
  | "geofence_dwell"
  | "route_deviation"
  | "fuel_drop"
  | "fuel_fill"
  | "long_idle"
  | "tamper";

export type AlertSeverity = "info" | "warning" | "critical";

export type SessionContext = {
  userId: string;
  email: string | null;
  name: string | null;
  role: Role;
  realRole: Role;
  companyId: string | null;
  companyName: string | null;
  companyMark: string | null;
  impersonating: boolean;
};

export type LiveVehicle = {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  plate: string;
  make: string | null;
  model: string | null;
  color: string | null;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  ignition: boolean;
  fuelLevel: number | null;
  fuelLitres: number | null;
  address: string | null;
  ts: string;
  movement: MovementState;
  statusSince: string;
  durationMs: number;
  driverName: string | null;
  speedLimit: number;
  odometerKm: number;
  engineHours: number;
  deviceImei: string | null;
  gsmSignal: number | null;
  gpsSignal: number | null;
  openAlerts: number;
};

export type MapCenter = { lat: number; lng: number; label: string };

export type LivePulse = {
  id: string;
  title: string;
  severity: AlertSeverity;
  vehicleId: string | null;
  vehicleName: string | null;
  createdAt: string;
};

export type BehaviorChip = {
  id: string;
  title: string;
  kind: string;
  severity: AlertSeverity;
  vehicleId: string;
  vehicleName: string;
  ts: string;
};

export type AlertRow = {
  id: string;
  companyId: string;
  companyName: string;
  vehicleId: string | null;
  vehicleName: string | null;
  plate: string | null;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  lat: number | null;
  lng: number | null;
  status: "open" | "ack" | "resolved";
  ackComment: string | null;
  createdAt: string;
  escalated: boolean;
};

export type FenceSchedule = {
  days: number[];
  start: string;
  end: string;
};

export type GeofenceRow = {
  id: string;
  companyId: string;
  name: string;
  kind: "circle" | "polygon" | "route";
  groupName: string | null;
  zoneType: "allowed" | "forbidden";
  geometry: CircleGeom | PolygonGeom | RouteGeom;
  schedule: FenceSchedule | null;
  active: boolean;
};

export type CircleGeom = { type: "circle"; lat: number; lng: number; radiusM: number };
export type PolygonGeom = { type: "polygon"; points: [number, number][] };
export type RouteGeom = { type: "route"; path: [number, number][]; widthM: number };

export type PositionRow = {
  id: string;
  vehicleId: string;
  ts: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  ignition: boolean;
  fuelLevel: number | null;
  address: string | null;
  event: string;
};

export type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  billingStatus: string;
  defaultSpeedLimit: number;
  city: string | null;
  vehicleCount: number;
  onlineCount: number;
  openAlerts: number;
  mark: string | null;
};

export type DeviceRow = {
  id: string;
  companyId: string | null;
  companyName: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  imei: string;
  protocol: string;
  decoder: string;
  capabilities: DeviceCapability[];
  capabilitySource: "unverified" | "manual" | "protocol" | "reported";
  capabilitiesVerifiedAt: string | null;
  connectionMode: DeviceConnectionMode;
  lastSeen: string | null;
  gsmSignal: number | null;
  gpsSignal: number | null;
  battery: number | null;
  lastCommandKind: string | null;
  lastCommandStatus: string | null;
  calibrationCount: number;
};

export type DriverRow = {
  id: string;
  companyId: string;
  name: string;
  licenseNo: string | null;
  licenseExpiry: string | null;
  phone: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  harshWeek: number;
  lastBehavior: string | null;
};

export type InvoiceRow = {
  id: string;
  companyId: string;
  companyName: string;
  number: string;
  period: string;
  amountCents: number;
  vehicleCount: number;
  status: string;
  dueDate: string | null;
};

export type AuditRow = {
  id: string;
  companyId: string | null;
  actor: string | null;
  action: string;
  target: string | null;
  createdAt: string;
};

export type MediaRow = {
  id: string;
  vehicleId: string;
  vehicleName: string;
  kind: string;
  path: string;
  caption: string | null;
  eventType: string | null;
  ts: string;
};

export type TripRow = {
  id: string;
  vehicleName: string;
  plate: string;
  startedAt: string;
  endedAt: string | null;
  startAddress: string | null;
  endAddress: string | null;
  distanceKm: number;
  maxSpeed: number;
  idleMinutes: number;
  fuelUsed: number | null;
};

export type MaintenanceRow = {
  id: string;
  vehicleId: string;
  vehicleName: string;
  title: string;
  dueOdometer: number | null;
  dueHours: number | null;
  dueDate: string | null;
  status: string;
  notes: string | null;
  odometerKm: number;
  engineHours: number;
};

export type AlertRuleConfig = {
  minutes?: number;
  graceKmh?: number;
  litres?: number;
  quietStart?: string | null;
  quietEnd?: string | null;
  escalateMin?: number | null;
};

export type AlertRuleRow = {
  id: string;
  companyId: string;
  companyName: string;
  vehicleId: string | null;
  type: AlertType;
  enabled: boolean;
  config: AlertRuleConfig;
};

export type KpiSnapshot = {
  vehicles: number;
  online: number;
  moving: number;
  idle: number;
  offline: number;
  openAlerts: number;
  criticalAlerts: number;
  fuelDrops24h: number;
  distance24h: number;
};

export type FlagRow = {
  key: string;
  label: string;
  detail: string;
  enabled: boolean;
};

export type DeskSession = {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  role: string | null;
  companyName: string | null;
  updatedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  self: boolean;
};

export type ScheduleRow = {
  id: string;
  companyId: string;
  companyName: string;
  kind: string;
  cadence: "daily" | "weekly";
  recipient: string;
  enabled: boolean;
  nextRun: string;
  lastRun: string | null;
};

export type MailRow = {
  id: string;
  companyId: string | null;
  companyName: string | null;
  to: string;
  subject: string;
  body: string;
  kind: string;
  createdAt: string;
};

export type IngestRow = {
  id: string;
  imei: string | null;
  decoder: string | null;
  status: "ok" | "rejected";
  detail: string | null;
  lat: number | null;
  lng: number | null;
  vehicleName: string | null;
  createdAt: string;
};
