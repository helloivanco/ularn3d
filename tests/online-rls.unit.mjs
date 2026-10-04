/**
 * Schema, RPC, and RLS checks against local Postgres.
 * Run: node --test tests/online-rls.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const database = "ularn_online_test";

const psqlAdmin = (args, sql) =>
  execFileSync("sudo", ["-u", "postgres", "psql", ...args], {
    input: sql,
    encoding: "utf8",
  });

const apply = (file) => {
  execFileSync(
    "sudo",
    ["-u", "postgres", "psql", "-d", database, "-v", "ON_ERROR_STOP=1", "-f", join(root, file)],
    { encoding: "utf8" }
  );
};

test("online rooms migration enforces auth, passwords, chat, and realtime RLS", () => {
  psqlAdmin(["-d", "postgres", "-v", "ON_ERROR_STOP=1"], `
    select pg_terminate_backend(pid) from pg_stat_activity
    where datname = '${database}' and pid <> pg_backend_pid();
    drop database if exists ${database};
  `);
  psqlAdmin(["-d", "postgres", "-v", "ON_ERROR_STOP=1"], `create database ${database};`);
  apply("tests/sql/harness.sql");
  apply("supabase/migrations/20261004184500_online_rooms.sql");
  apply("supabase/migrations/20261004184500_online_rooms.sql");
  apply("supabase/migrations/20261004193000_claim_host.sql");
  apply("supabase/migrations/20261004201000_scores.sql");
  apply("supabase/migrations/20261004201000_scores.sql");
  apply("supabase/migrations/20261004223000_pg_cron.sql");
  apply("supabase/migrations/20261004223000_pg_cron.sql");
  psqlAdmin(["-d", database, "-v", "ON_ERROR_STOP=1"], `
    create or replace function public.rls_auto_enable()
    returns event_trigger
    language plpgsql
    as $fn$ begin end $fn$;
    grant execute on function public.rls_auto_enable() to public, anon, authenticated;
  `);
  apply("supabase/migrations/20261004233000_revoke_rls_auto_enable.sql");
  apply("supabase/migrations/20261004233000_revoke_rls_auto_enable.sql");
  apply("supabase/migrations/20261005093000_current_member_chat.sql");
  apply("supabase/migrations/20261005093000_current_member_chat.sql");
  const output = applyAndCapture("tests/sql/online-rls.sql");
  assert.match(output, /online rls ok/);
  const scores = applyAndCapture("tests/sql/scores-rls.sql");
  assert.match(scores, /scores rls ok/);
  const history = applyAndCapture("tests/sql/recent-chat.sql");
  assert.match(history, /recent chat ok/);
  const cron = applyAndCapture("tests/sql/pg-cron.sql");
  assert.match(cron, /pg cron ok/);
  const guards = applyAndCapture("tests/sql/submit-guards.sql");
  assert.match(guards, /submit guards ok/);
});

const applyAndCapture = (file) =>
  execFileSync(
    "sudo",
    ["-u", "postgres", "psql", "-d", database, "-v", "ON_ERROR_STOP=1", "-f", join(root, file)],
    { encoding: "utf8" }
  );
