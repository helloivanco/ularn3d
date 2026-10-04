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

export const getSupabase = async () => {
  const config = readOnlineEnv();
  if (!config) return null;
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(config.url, config.key, {
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
