import type { Sql } from "@/lib/db";

/**
 * Demo fleet seeding is intentionally disabled. The 13 demo vehicles,
 * their related records, and their two demo companies were removed by
 * migration 0008_remove_demo_fleet.sql. Keep this function as a no-op
 * because existing bootstrap paths still call it.
 */
export function seedIfNeeded(_sql: Sql, _actorId: string): Promise<void> {
  return Promise.resolve();
}
