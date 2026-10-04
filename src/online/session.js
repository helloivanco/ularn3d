import { getSupabase, readOnlineEnv } from "./config.js";
import { displayNameError } from "./words.js";

export const ensureOnlineSession = async ({ displayName, captchaToken } = {}) => {
  const config = readOnlineEnv();
  if (!config) return { ok: false, error: "unavailable" };
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: "unavailable" };
  const existing = await supabase.auth.getSession();
  if (!existing.data.session) {
    const options = {};
    if (config.captcha) {
      if (!captchaToken) return { ok: false, error: "captcha_required" };
      options.captchaToken = captchaToken;
    }
    const signed = await supabase.auth.signInAnonymously({ options });
    if (signed.error) return { ok: false, error: "unavailable" };
  }
  if (!displayName) return { ok: true };
  const problem = displayNameError(displayName);
  if (problem) return { ok: false, error: problem };
  const named = await supabase.rpc("set_display_name", { p_display_name: displayName.trim() });
  if (named.error) return { ok: false, error: "unavailable" };
  return named.data ?? { ok: false, error: "unavailable" };
};
