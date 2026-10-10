export const readOnlineEnv = (env = import.meta.env ?? {}) => {
  const url = env.VITE_SUPABASE_URL || "";
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (!url || !key) return null;
  return {
    url,
    key,
    captcha: env.VITE_SUPABASE_CAPTCHA === "true",
    turnstileSiteKey: env.VITE_TURNSTILE_SITE_KEY || "",
  };
};

let clientPromise = null;
const boundedFetch = async (input, options = {}) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 12000);
  try { return await fetch(input, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
};

export const getSupabase = async () => {
  const config = readOnlineEnv();
  if (!config) return null;
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(config.url, config.key, {
        global: { fetch: boundedFetch },
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    );
  }
  return clientPromise;
};

export const resetSupabaseForTests = () => {
  clientPromise = null;
};
