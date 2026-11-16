import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("registration and ownership migration is additive, repeatable, and preserves accounts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table profiles (
        user_id text primary key,
        role text not null,
        created_at timestamptz not null default now()
      );
      create table companies (id text primary key);
      insert into profiles (user_id, role) values
        ('existing-admin', 'company_admin'),
        ('waiting-user', 'pending');
      insert into companies (id) values ('company-a');
    `);
    const migration = await readFile(new URL("../migrations/0009_registration_ownership.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);

    const profiles = await db.query("select user_id, role, approval_status from profiles order by user_id");
    assert.equal(profiles.rows.length, 2, "existing profile rows must not be deleted");
    assert.deepEqual(profiles.rows[0], { user_id: "existing-admin", role: "company_admin", approval_status: "approved" });
    assert.deepEqual(profiles.rows[1], { user_id: "waiting-user", role: "pending", approval_status: "pending" });

    const company = await db.query("select owner_user_id from companies where id = 'company-a'");
    assert.equal(company.rows[0].owner_user_id, null, "existing companies remain unassigned until an explicit handover");

    await db.exec(`
      insert into company_ownership_transfers
        (id, company_id, to_email, created_by, status, expires_at)
      values ('transfer-a', 'company-a', 'owner@example.com', 'platform-owner', 'pending', now() + interval '14 days');
    `);
    await assert.rejects(
      db.exec(`
        insert into company_ownership_transfers
          (id, company_id, to_email, created_by, status, expires_at)
        values ('transfer-b', 'company-a', 'other@example.com', 'platform-owner', 'pending', now() + interval '14 days');
      `),
      /unique|duplicate/i,
      "a company must not have two simultaneous pending ownership invitations",
    );
  } finally {
    await db.close();
  }
});
