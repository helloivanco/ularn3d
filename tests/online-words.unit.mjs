import test from "node:test";
import assert from "node:assert/strict";
import { containsBlockedWord, displayNameError } from "../src/online/words.js";
import { readOnlineEnv } from "../src/online/config.js";

test("display names accept a short adventurer name and reject the filter", () => {
  assert.equal(displayNameError("Ada"), "");
  assert.equal(displayNameError("A"), "bad_name");
  assert.equal(displayNameError("this name is far too long"), "bad_name");
  assert.equal(displayNameError("ShitHead"), "filtered");
  assert.equal(containsBlockedWord("sh1t"), true);
  assert.equal(containsBlockedWord("Ada"), false);
});

test("online config is absent until both public env values are set", () => {
  assert.equal(readOnlineEnv({}), null);
  assert.equal(readOnlineEnv({ VITE_SUPABASE_URL: "https://example.supabase.co" }), null);
  const config = readOnlineEnv({
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  });
  assert.equal(config.captcha, false);
  assert.equal(config.key, "sb_publishable_example");
});
