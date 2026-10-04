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
  psqlAdmin(["-d", "postgres", "-v", "ON_ERROR_STOP=1"], `drop database if exists ${database};`);
  psqlAdmin(["-d", "postgres", "-v", "ON_ERROR_STOP=1"], `create database ${database};`);
  apply("tests/sql/harness.sql");
  apply("supabase/migrations/20261004184500_online_rooms.sql");
  apply("supabase/migrations/20261004184500_online_rooms.sql");
  apply("supabase/migrations/20261004193000_claim_host.sql");
  apply("supabase/migrations/20261004201000_scores.sql");
  apply("supabase/migrations/20261004201000_scores.sql");
  const output = applyAndCapture("tests/sql/online-rls.sql");
  assert.match(output, /online rls ok/);
  const scores = applyAndCapture("tests/sql/scores-rls.sql");
  assert.match(scores, /scores rls ok/);
});

const applyAndCapture = (file) =>
  execFileSync(
    "sudo",
    ["-u", "postgres", "psql", "-d", database, "-v", "ON_ERROR_STOP=1", "-f", join(root, file)],
    { encoding: "utf8" }
  );
