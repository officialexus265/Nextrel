import type { Sql } from "@/lib/db";
import { nid } from "@/lib/utils";
import { companyMarkFromName } from "./control";
import { seedIfNeeded } from "./seed";
import type { Role, SessionContext } from "./types";

const ROLES: Role[] = [
  "super_admin",
  "field_admin",
  "company_admin",
  "tracker",
  "accounts",
  "pending",
];

function asRole(v: string | null | undefined): Role {
  return ROLES.includes(v as Role) ? (v as Role) : "pending";
}

export async function bootstrapSession(sql: Sql, userId: string): Promise<SessionContext> {
  const authUsers = await sql<{ id: string; name: string | null; email: string | null }>`
    select id, name, email from "user" where id = ${userId}
  `;
  const auth = authUsers[0] ?? { id: userId, name: null, email: null };

  let profile = (
    await sql<{ role: string; company_id: string | null; name: string | null; email: string | null; active: boolean }>`
      select role, company_id, name, email, active, approval_status from profiles where user_id = ${userId}
    `
  )[0];

  if (profile && !profile.active) throw new Error("This account has been deactivated. Contact your platform administrator.");

  if (!profile) {
    const superCount = await sql<{ n: number }>`select count(*)::int as n from profiles where role = 'super_admin'`;
    const invite = auth.email
      ? (
          await sql<{ role: string; company_id: string | null }>`
            select role, company_id from invites where lower(email) = ${auth.email.toLowerCase()} order by created_at desc limit 1
          `
        )[0]
      : undefined;
    const role: Role = invite ? asRole(invite.role) : superCount[0]?.n ? "pending" : "super_admin";
    const approvalStatus = role === "pending" ? "pending" : "approved";
    const companyId = invite?.company_id ?? null;
    await sql`
      insert into profiles (user_id, role, company_id, name, email, approval_status)
      values (${userId}, ${role}, ${companyId}, ${auth.name}, ${auth.email}, ${approvalStatus})
      on conflict (user_id) do nothing
    `;
    if (role === "super_admin") {
      await seedIfNeeded(sql, userId);
    }
    if (role === "field_admin") {
      const companies = await sql<{ id: string }>`select id from companies`;
      for (const c of companies) {
        await sql`
          insert into field_assignments (user_id, company_id)
          values (${userId}, ${c.id})
          on conflict do nothing
        `;
      }
    }
    await sql`
      insert into audit_logs (id, company_id, actor_id, action, target)
      values (${nid("aud")}, ${companyId}, ${userId}, 'user.joined', ${role})
    `;
    profile = { role, company_id: companyId, name: auth.name, email: auth.email, active: true, approval_status: approvalStatus };
  }

  if (profile.role === "super_admin") {
    await seedIfNeeded(sql, userId);
  }

  const override = (
    await sql<{ role: string; company_id: string | null }>`
      select role, company_id from view_overrides where user_id = ${userId}
    `
  )[0];

  const realRole = asRole(profile.role);
  const ownerRow = await sql<{ id: string }>`select id from companies where owner_user_id = ${userId} limit 1`;
  const role = override ? asRole(override.role) : realRole;
  const companyId = override ? override.company_id : profile.company_id;
  let companyName: string | null = null;
  let companyMark: string | null = null;
  if (companyId) {
    const c = await sql<{ name: string; mark: string | null }>`
      select name, mark from companies where id = ${companyId}
    `;
    companyName = c[0]?.name ?? null;
    companyMark = c[0]?.mark ?? null;
    if (c[0] && !companyMark) {
      companyMark = companyMarkFromName(c[0].name);
      await sql`update companies set mark = ${companyMark} where id = ${companyId} and mark is null`;
    }
  }

  return {
    userId,
    email: profile.email ?? auth.email,
    name: profile.name ?? auth.name,
    role,
    realRole,
    companyId,
    companyName,
    companyMark,
    impersonating: Boolean(override),
    approvalStatus: profile.approval_status ?? (realRole === "pending" ? "pending" : "approved"),
    isCompanyOwner: ownerRow.length > 0,
  };
}

export function canManageOps(role: Role) {
  return role === "super_admin" || role === "company_admin";
}

export function canSeeMap(role: Role) {
  return role === "super_admin" || role === "company_admin" || role === "tracker" || role === "field_admin";
}

export function canSeeBilling(role: Role) {
  return role === "super_admin" || role === "company_admin" || role === "accounts";
}

export async function companyScope(sql: Sql, session: SessionContext): Promise<string[] | null> {
  if (session.role === "super_admin" && !session.impersonating) return null;
  if (session.role === "field_admin") {
    const rows = await sql<{ company_id: string }>`
      select company_id from field_assignments where user_id = ${session.userId}
    `;
    return rows.map((r) => r.company_id);
  }
  return session.companyId ? [session.companyId] : [];
}

export function inScope(scope: string[] | null, companyId: string | null) {
  if (scope === null) return true;
  if (!companyId) return false;
  return scope.includes(companyId);
}

export function parseGeom<T>(raw: unknown): T {
  if (typeof raw === "string") return JSON.parse(raw) as T;
  return raw as T;
}
