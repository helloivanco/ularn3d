import { bootEngine, playInputs } from "../../supabase/functions/_shared/engine-boot.js";

export { bootEngine, playInputs };

export const scriptedRun = async ({ seed, inputs, character, partyOfOne = false }) => {
  const api = bootEngine({ seed, character, skipPaint: true });
  if (partyOfOne) api.enablePartyOfOne();
  const log = await playInputs(api, inputs);
  const state = api.captureGameState();
  state.party = null;
  return {
    checksum: api.checksumGameState(state),
    state,
    log,
    gtime: api.gtime,
    x: api.player.x,
    y: api.player.y,
    hp: api.player.HP,
    level: api.level,
    api,
  };
};

/** 500 waits. Fixed, and long enough to pass monster spawns and regen. */
export const SOLO_LOCK_TURNS = 500;
export const SOLO_LOCK_SEED = 0x0c001a33;
export const soloLockInputs = () => Array.from({ length: SOLO_LOCK_TURNS }, () => ".");
