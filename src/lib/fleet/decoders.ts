export const DECODER_NAMES = ["generic_http", "teltonika", "concox", "gt06"] as const;

export type DecoderName = (typeof DECODER_NAMES)[number];

export type NormalizedFix = {
  imei: string;
  timestamp: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  altitude: number | null;
  ignition: boolean;
  fuelLevel: number | null;
  event: string;
  satellites: number | null;
  decoder: DecoderName;
};

const IMEIS = {
  shuttle: "356938035643805",
  prime: "356938035643801",
  van: "356938035643803",
  box: "356938035643804",
} as const;

export function isDecoderName(value: string): value is DecoderName {
  return (DECODER_NAMES as readonly string[]).includes(value);
}

export function samplePacket(decoder: DecoderName, at = new Date()): string {
  if (decoder === "generic_http") {
    return JSON.stringify(
      {
        imei: IMEIS.shuttle,
        timestamp: at.toISOString(),
        lat: -1.2673,
        lng: 36.811,
        speed: 0,
        heading: 12,
        ignition: false,
        fuel_level: 61,
        event: "location",
      },
      null,
      2,
    );
  }
  if (decoder === "teltonika") {
    return JSON.stringify(
      {
        imei: IMEIS.prime,
        records: [
          {
            timestamp: at.getTime(),
            gps: {
              latitude: -1.3194,
              longitude: 36.9275,
              altitude: 1620,
              angle: 270,
              speed: 48,
              satellites: 14,
            },
            io: { "239": 1, "270": 71 },
          },
        ],
      },
      null,
      2,
    );
  }
  if (decoder === "concox") {
    return JSON.stringify(
      {
        imei: IMEIS.van,
        gpstime: nairobiStamp(at),
        lat: -1.279,
        lng: 36.817,
        speed: 0,
        course: 40,
        acc: 1,
        fuel: 48,
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      imei: IMEIS.box,
      hex: encodeGt06Location({
        lat: -1.3185,
        lng: 36.8448,
        speed: 36,
        heading: 10,
        at,
        satellites: 11,
      }),
    },
    null,
    2,
  );
}

export function sniffDecoder(raw: string): DecoderName {
  const text = raw.trim();
  if (text.startsWith("{")) {
    const obj = parseJson(text);
    if (typeof obj.decoder === "string" && isDecoderName(obj.decoder)) return obj.decoder;
    if (Array.isArray(obj.records) || obj.avl_io) return "teltonika";
    if (typeof obj.hex === "string" || typeof obj.frame === "string") return "gt06";
    if (obj.deviceid != null || obj.terminal_id != null || obj.gpstime != null || obj.acc != null) return "concox";
    return "generic_http";
  }
  const hex = text.replace(/[^0-9a-fA-F]/g, "");
  if (hex.toLowerCase().startsWith("7878") || hex.toLowerCase().startsWith("7979")) return "gt06";
  throw new Error("Unrecognised packet. Pick a decoder or send JSON.");
}

export function decode(decoder: DecoderName, raw: string): NormalizedFix[] {
  const text = raw.trim();
  if (!text) throw new Error("Paste a packet first");
  if (decoder === "generic_http") return [decodeGeneric(parseJson(text))];
  if (decoder === "teltonika") return decodeTeltonika(parseJson(text));
  if (decoder === "concox") return decodeConcox(text);
  return decodeGt06(text);
}

export function encodeGt06Location(fix: {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  at: Date;
  satellites?: number;
}): string {
  const sats = Math.min(15, Math.max(0, fix.satellites ?? 12));
  const latAbs = Math.round(Math.abs(fix.lat) * 1_800_000);
  const lngAbs = Math.round(Math.abs(fix.lng) * 1_800_000);
  let flags = Math.round(fix.heading) & 0x3ff;
  flags |= 1 << 12;
  if (fix.lat >= 0) flags |= 1 << 10;
  if (fix.lng < 0) flags |= 1 << 11;
  const body = [
    0x12,
    fix.at.getUTCFullYear() - 2000,
    fix.at.getUTCMonth() + 1,
    fix.at.getUTCDate(),
    fix.at.getUTCHours(),
    fix.at.getUTCMinutes(),
    fix.at.getUTCSeconds(),
    (0xc << 4) | sats,
    ...u32(latAbs),
    ...u32(lngAbs),
    Math.max(0, Math.min(255, Math.round(fix.speed))),
    (flags >> 8) & 0xff,
    flags & 0xff,
    0x02,
    0x7f,
    0x01,
    0x1a,
    0x2b,
    0x00,
    0x12,
    0x34,
    0x00,
    0x01,
  ];
  const crc = crc16(Uint8Array.from([body.length, ...body]));
  const packet = [0x78, 0x78, body.length, ...body, (crc >> 8) & 0xff, crc & 0xff, 0x0d, 0x0a];
  return packet.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeGeneric(obj: Record<string, unknown>): NormalizedFix {
  const imei = readImei(obj);
  const lat = num(obj.lat ?? obj.latitude);
  const lng = num(obj.lng ?? obj.lon ?? obj.longitude);
  if (lat == null || lng == null) throw new Error("Generic JSON needs lat and lng.");
  return finish("generic_http", {
    imei,
    timestamp: parseClock(obj.timestamp ?? obj.time) ?? new Date().toISOString(),
    lat,
    lng,
    speed: num(obj.speed) ?? 0,
    heading: num(obj.heading ?? obj.angle ?? obj.course) ?? 0,
    altitude: num(obj.altitude ?? obj.alt),
    ignition: bool(obj.ignition ?? obj.acc),
    fuelLevel: num(obj.fuel_level ?? obj.fuel),
    event: eventName(obj.event),
    satellites: num(obj.satellites),
  });
}

function decodeTeltonika(obj: Record<string, unknown>): NormalizedFix[] {
  const imei = readImei(obj);
  const records = Array.isArray(obj.records) ? obj.records : [obj];
  if (records.length === 0) throw new Error("Teltonika payload has no records.");
  if (records.length > 20) throw new Error("Teltonika batch is capped at 20 records.");
  return records.map((row) => {
    if (!row || typeof row !== "object") throw new Error("Teltonika record is not an object.");
    const rec = row as Record<string, unknown>;
    const gps = (rec.gps && typeof rec.gps === "object" ? rec.gps : rec) as Record<string, unknown>;
    const lat = num(gps.lat ?? gps.latitude);
    const lng = num(gps.lng ?? gps.lon ?? gps.longitude);
    if (lat == null || lng == null) throw new Error("Teltonika record needs gps latitude and longitude.");
    const io = (rec.io ?? rec.avl_io ?? {}) as Record<string, unknown>;
    const ignition = bool(rec.ignition ?? io["239"] ?? io["240"]);
    const fuel = num(rec.fuel_level ?? rec.fuel ?? percentOrNull(io["270"]));
    return finish("teltonika", {
      imei,
      timestamp: parseClock(rec.timestamp ?? rec.recorded_at ?? obj.recorded_at) ?? new Date().toISOString(),
      lat,
      lng,
      speed: num(gps.speed) ?? 0,
      heading: num(gps.angle ?? gps.heading ?? gps.course) ?? 0,
      altitude: num(gps.altitude ?? gps.alt),
      ignition,
      fuelLevel: fuel,
      event: eventName(rec.event),
      satellites: num(gps.satellites),
    });
  });
}

function decodeConcox(raw: string): NormalizedFix[] {
  const text = raw.trim();
  if (!text.startsWith("{")) return decodeGt06(text, "concox");
  const obj = parseJson(text);
  const frame = typeof obj.hex === "string" ? obj.hex : typeof obj.frame === "string" ? obj.frame : null;
  if (frame) {
    const imei = typeof obj.imei === "string" ? obj.imei : typeof obj.deviceid === "string" ? obj.deviceid : "";
    if (!imei.trim()) throw new Error("Concox hex needs an imei next to the frame.");
    return [finish("concox", { ...decodeGt06Frame(frame), imei: imei.trim() })];
  }
  const imei = readImei(obj);
  const lat = num(obj.lat ?? obj.latitude);
  const lng = num(obj.lng ?? obj.lon ?? obj.longitude);
  if (lat == null || lng == null) throw new Error("Concox JSON needs lat and lng.");
  return [
    finish("concox", {
      imei,
      timestamp: parseClock(obj.gpstime ?? obj.time ?? obj.timestamp) ?? new Date().toISOString(),
      lat,
      lng,
      speed: num(obj.speed) ?? 0,
      heading: num(obj.course ?? obj.heading ?? obj.direction) ?? 0,
      altitude: num(obj.altitude),
      ignition: bool(obj.acc ?? obj.ignition),
      fuelLevel: num(obj.fuel ?? obj.oil ?? obj.fuel_level),
      event: eventName(obj.event),
      satellites: num(obj.satellites),
    }),
  ];
}

function decodeGt06(raw: string, decoder: DecoderName = "gt06"): NormalizedFix[] {
  const text = raw.trim();
  if (text.startsWith("{")) {
    const obj = parseJson(text);
    const frame = typeof obj.hex === "string" ? obj.hex : typeof obj.frame === "string" ? obj.frame : null;
    if (!frame) throw new Error("GT06 JSON needs a hex field.");
    return [finish(decoder, { ...decodeGt06Frame(frame), imei: readImei(obj) })];
  }
  throw new Error('GT06 location frames omit the IMEI. Wrap as {"imei":"...","hex":"7878..."}.');
}

function decodeGt06Frame(hexRaw: string): Omit<NormalizedFix, "decoder"> {
  const hex = hexRaw.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.startsWith("7979")) throw new Error("Extended 7979 frames are not location packets.");
  if (!hex.startsWith("7878")) throw new Error("GT06 frame should start with 7878.");
  const bytes = hexToBytes(hex);
  if (bytes.length < 10) throw new Error("GT06 frame is too short.");
  const length = bytes[2];
  const body = bytes.slice(3, 3 + length);
  if (body.length < length) throw new Error("GT06 frame is shorter than its length byte.");
  const crcBytes = bytes.slice(3 + length, 3 + length + 2);
  if (crcBytes.length < 2) throw new Error("GT06 frame is missing its CRC.");
  const expected = crc16(bytes.slice(2, 3 + length));
  const actual = (crcBytes[0] << 8) | crcBytes[1];
  if (expected !== actual) throw new Error("CRC mismatch — the frame was cut or altered.");
  const proto = body[0];
  if (proto === 0x01) throw new Error("Protocol 0x01 is a login, not a location.");
  if (proto !== 0x12 && proto !== 0x22) {
    throw new Error(`Protocol 0x${proto.toString(16).padStart(2, "0")} is not a location frame.`);
  }
  if (body.length < 19) throw new Error("GT06 frame is too short for a location packet.");
  const year = 2000 + body[1];
  const timestamp = new Date(Date.UTC(year, body[2] - 1, body[3], body[4], body[5], body[6])).toISOString();
  const satellites = body[7] & 0x0f;
  let lat = readU32(body, 8) / 1_800_000;
  let lng = readU32(body, 12) / 1_800_000;
  const speed = body[16];
  const flags = (body[17] << 8) | body[18];
  if ((flags & (1 << 10)) === 0) lat = -lat;
  if ((flags & (1 << 11)) !== 0) lng = -lng;
  if ((flags & (1 << 12)) === 0) throw new Error("GPS not fixed in this GT06 frame.");
  return {
    imei: "",
    timestamp,
    lat,
    lng,
    speed,
    heading: flags & 0x3ff,
    altitude: null,
    ignition: false,
    fuelLevel: null,
    event: "location",
    satellites,
  };
}

function finish(
  decoder: DecoderName,
  fix: Omit<NormalizedFix, "decoder">,
): NormalizedFix {
  if (!/^\d{14,16}$/.test(fix.imei)) throw new Error("IMEI should be 14–16 digits.");
  if (fix.lat < -90 || fix.lat > 90 || fix.lng < -180 || fix.lng > 180) throw new Error("Coordinates are out of range.");
  const heading = ((fix.heading % 360) + 360) % 360;
  const fuel = fix.fuelLevel == null ? null : Math.max(0, Math.min(100, fix.fuelLevel));
  return {
    ...fix,
    decoder,
    heading,
    speed: Math.max(0, Math.min(250, fix.speed)),
    fuelLevel: fuel,
    altitude: fix.altitude,
    satellites: fix.satellites == null ? null : Math.max(0, Math.min(32, Math.round(fix.satellites))),
  };
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Packet JSON must be an object.");
    return value as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error("Packet is not valid JSON.");
    throw err;
  }
}

function readImei(obj: Record<string, unknown>): string {
  const raw = obj.imei ?? obj.deviceid ?? obj.terminal_id ?? obj.id;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  if (typeof raw !== "string" || !raw.trim()) throw new Error("Packet needs an IMEI.");
  return raw.trim();
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["1", "true", "on", "yes"].includes(value.toLowerCase());
  return false;
}

function percentOrNull(value: unknown): number | null {
  const n = num(value);
  if (n == null || n < 0 || n > 100) return null;
  return n;
}

function eventName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "location";
  return value.trim().slice(0, 32);
}

function parseClock(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text)) {
    return new Date(text.replace(" ", "T") + "+03:00").toISOString();
  }
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) throw new Error("Could not read the packet time.");
  return new Date(ms).toISOString();
}

function nairobiStamp(at: Date): string {
  const t = new Date(at.getTime() + 3 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Hex frame has an odd number of digits.");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}
