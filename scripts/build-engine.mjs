import { readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "vite";

const mode = process.argv.includes("--production") ? "production" : "development";
const env = loadEnv(mode, process.cwd(), "VITE_");
const defaultScoreConfig = JSON.parse(readFileSync("scoreboard.config.json", "utf8"));
const scoreConfig = {
  url: env.VITE_SUPABASE_URL ?? defaultScoreConfig.url,
  publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? defaultScoreConfig.publishableKey,
};
if (scoreConfig.url || scoreConfig.publishableKey) {
  const url = new URL(scoreConfig.url);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("VITE_SUPABASE_URL must be an HTTPS project origin.");
  const key = scoreConfig.publishableKey;
  const legacyRole = key.startsWith("eyJ") ? JSON.parse(Buffer.from(key.split(".")[1], "base64url")).role : null;
  if (!key.startsWith("sb_publishable_") && legacyRole !== "anon")
    throw new Error("Score clients require a Supabase publishable key, never a secret or service_role key.");
  scoreConfig.url = url.origin;
}
writeFileSync("public/engine/score-config.js", `window.ULARN_SCORE_CONFIG = Object.freeze(${JSON.stringify(scoreConfig)});\n`);
writeFileSync("public/engine/score-config.json", `${JSON.stringify(scoreConfig)}\n`);
const files = [
  "common/util",
  "common/larn_config",
  "common/frame",
  "common/patch",
  "common/roll",
  "common/cloudflare",
  "common/score-service",
  "common/movie",
  "common/live",
  "config",
  "larn",
  "main",
  "object",
  "options",
  "global",
  "monster",
  "monsterdata",
  "player",
  "mazes",
  "level",
  "create",
  "data",
  "parse",
  "buttons",
  "scores",
  "inventory",
  "aura",
  "movem",
  "action",
  "io",
  "display",
  "storedata",
  "store",
  "mcdopes",
  "savelev",
  "spells",
  "spellsinfo",
  "regen",
  "spheres",
  "help",
  "state",
  "bill",
  "altar",
  "fountain",
  "potion",
  "scroll",
  "stairs",
  "throne",
  "devmode",
  "gotw",
  "explore",
  "determinism",
  "party",
  "encounter",
];
const source = files
  .map(
    (file) =>
      `\n// Source: ${file}.js\n${readFileSync(`public/engine/${file}.js`, "utf8")}\n`,
  )
  .join("\n");
writeFileSync(
  "public/engine/game.js",
  `/* Ularn engine: Copyright (c) 2015-Present Jason Primeau. MIT; see /engine/LICENSE. */\n${source}\n${readFileSync("src/bridge.js", "utf8")}`,
);
console.log(
  `Assembled ${files.length} original engine modules plus the 3D bridge.`,
);
