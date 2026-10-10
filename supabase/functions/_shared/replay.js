import { bootEngine, ensureEngineSource, ensureVm } from "./engine-boot.js";

/**
 * Free-plan Edge Functions get about 2 seconds of CPU. A short finished run
 * replays inside that. A log past this many turns is refused up front so one
 * huge submission cannot take the isolate down with it.
 */
export const MAX_REPLAY_TURNS = 1200;
export const REPLAY_CPU_BUDGET_MS = 1500;

const actionOf = (row) => {
  if (typeof row === "string") return row;
  if (row && typeof row.action === "string") return row.action;
  return null;
};

/**
 * Replay one finished run. Solo boots the seed and plays the log.
 * Co-op follows the node co-op run: party of one, then adventurer Bea.
 * The score is the engine's own LocalScore. The caller does not supply it.
 */
export const replayFinishedRun = async ({
  seed,
  log,
  mode,
  config = null,
  clock = Date.now,
  budgetMs = REPLAY_CPU_BUDGET_MS,
  onBoot = null,
}) => {
  if (!Array.isArray(log)) return { ok: false, reason: "bad_log" };
  if (log.length > MAX_REPLAY_TURNS) return { ok: false, reason: "replay_cpu_cap" };
  let api;
  try {
    await ensureVm();
    await ensureEngineSource();
  } catch (error) {
    console.error("replay source failed", error instanceof Error ? error.message : "error");
    return { ok: false, reason: "unavailable" };
  }
  try {
    if (typeof onBoot === "function") onBoot();
    const first = config?.version === 2 ? config.players?.[0] : null;
    api = bootEngine({ seed: Number(seed), skipPaint: true, name: first?.name, character: first?.character, difficulty: config?.difficulty || 0 });
    if (mode === "coop" && first) {
      api.beginRoomParty(config.players);
    } else if (mode === "coop") {
      api.enablePartyOfOne();
      api.addAdventurer("Bea");
    }
  } catch (error) {
    console.error("replay boot failed", error instanceof Error ? error.message : "error");
    return { ok: false, reason: "replay_failed" };
  }
  const started = clock();
  const overBudget = () => clock() - started > budgetMs;
  for (let seq = 0; seq < log.length; seq++) {
    if (overBudget()) return { ok: false, reason: "replay_cpu_cap" };
    const row = log[seq];
    if (mode === "coop" && config?.version === 2) {
      if (!row || !Number.isInteger(row.actor) || !['key', 'join', 'leave', 'resume', 'remove'].includes(row.kind) ||
          (row.kind === 'key' && (typeof row.input !== 'string' || row.input.length > 32))) return { ok: false, reason: 'bad_log' };
      try { api.applyRoomAction(row); }
      catch { return { ok: false, reason: 'replay_failed' }; }
      continue;
    }
    const action = actionOf(row);
    if (!action || action.length > 32) return { ok: false, reason: "bad_log" };
    const actor = mode === "coop" && row && Number.isInteger(row.actor) ? row.actor : 0;
    if (mode === "coop" && typeof api.activateAdventurer === "function" && !api.activateAdventurer(actor)) {
      return { ok: false, reason: "bad_log" };
    }
    try {
      if (typeof api.pushInput === "function") {
        api.pushInput({ actor, turn: api.gtime, action, seq });
      }
      api.mainloop(null, action);
    } catch (error) {
      console.error("replay turn failed", error instanceof Error ? error.message : "error");
      return { ok: false, reason: "replay_failed" };
    }
  }
  if (overBudget()) return { ok: false, reason: "replay_cpu_cap" };
  try {
    const state = api.captureGameState();
    state.party = null;
    const card = typeof api.__replayScore === "function"
      ? api.__replayScore()
      : { score: (api.player?.GOLD || 0) + (api.player?.BANKACCOUNT || 0), won: false, killedBy: "" };
    let killedBy = card.killedBy || "";
    if (!card.won && (api.lastmonst === "" || api.lastmonst == null)) killedBy = "";
    return {
      ok: true,
      score: card.score,
      depth: api.level,
      turns: api.gtime,
      won: !!card.won,
      killedBy,
      checksum: api.checksumGameState(state),
      engineVersion: api.ENGINE_VERSION || "",
    };
  } catch (error) {
    console.error("replay score failed", error instanceof Error ? error.message : "error");
    return { ok: false, reason: "replay_failed" };
  }
};
