import assert from "node:assert/strict";
import test from "node:test";
import { decode, encodeGt06Location, samplePacket, sniffDecoder } from "./decoders.ts";

const at = new Date("2026-11-07T03:58:00.000Z");

test("generic sample decodes to the parked shuttle", () => {
  const raw = samplePacket("generic_http", at);
  const [fix] = decode("generic_http", raw);
  assert.equal(fix.imei, "356938035643805");
  assert.equal(fix.lat, -1.2673);
  assert.equal(fix.lng, 36.811);
  assert.equal(fix.ignition, false);
  assert.equal(fix.fuelLevel, 61);
  assert.equal(fix.timestamp, at.toISOString());
});

test("teltonika IO 239 is ignition and 270 is fuel", () => {
  const [fix] = decode("teltonika", samplePacket("teltonika", at));
  assert.equal(fix.imei, "356938035643801");
  assert.equal(fix.lat, -1.3194);
  assert.equal(fix.lng, 36.9275);
  assert.equal(fix.speed, 48);
  assert.equal(fix.heading, 270);
  assert.equal(fix.altitude, 1620);
  assert.equal(fix.ignition, true);
  assert.equal(fix.fuelLevel, 71);
  assert.equal(fix.satellites, 14);
  assert.equal(sniffDecoder(samplePacket("teltonika", at)), "teltonika");
});

test("concox gpstime is Nairobi local", () => {
  const [fix] = decode("concox", samplePacket("concox", at));
  assert.equal(fix.imei, "356938035643803");
  assert.equal(fix.timestamp, at.toISOString());
  assert.equal(fix.lat, -1.279);
  assert.equal(fix.ignition, true);
  assert.equal(fix.fuelLevel, 48);
  assert.equal(fix.heading, 40);
});

test("gt06 location frame round-trips", () => {
  const hex = encodeGt06Location({ lat: -1.2673, lng: 36.811, speed: 36, heading: 10, at, satellites: 11 });
  const [fix] = decode("gt06", JSON.stringify({ imei: "356938035643804", hex }));
  assert.equal(fix.lat, -1.2673);
  assert.equal(fix.lng, 36.811);
  assert.equal(fix.speed, 36);
  assert.equal(fix.heading, 10);
  assert.equal(fix.satellites, 11);
  assert.equal(fix.timestamp, at.toISOString());
  assert.equal(fix.ignition, false);
});

test("gt06 rejects a flipped CRC", () => {
  const hex = encodeGt06Location({ lat: -1.2673, lng: 36.811, speed: 10, heading: 90, at, satellites: 8 });
  const broken = hex.slice(0, -6) + "ffff" + hex.slice(-4);
  assert.throws(() => decode("gt06", JSON.stringify({ imei: "356938035643804", hex: broken })), /CRC mismatch/);
});

test("sample gt06 packet decodes", () => {
  const [fix] = decode("gt06", samplePacket("gt06", at));
  assert.equal(fix.imei, "356938035643804");
  assert.equal(fix.lat, -1.3185);
  assert.equal(fix.lng, 36.8448);
});
