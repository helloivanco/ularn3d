/** Local cross-run profile. Presentation-only; storage is injected. */
export const PROFILE_KEY = "ularn3d.profile.v1";
const HISTORY_CAP = 30;
const RECORDED_CAP = 30;

const emptyBest = () => ({ score: 0, game: null, depth: 0, kills: 0, moves: 0 });

export const emptyProfile = () => ({
  v: 1, runs: 0, wins: 0, deaths: 0, kills: 0, deepest: 0, best: emptyBest(),
  callings: {}, species: {}, feats: {}, history: [], recorded: [], lastRun: null,
});

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const dict = (value) => (isObject(value) ? value : {});
const list = (value) => (Array.isArray(value) ? value : []);

const normalize = (raw) => {
  if (!isObject(raw) || raw.v !== 1) return emptyProfile();
  return {
    v: 1,
    runs: num(raw.runs), wins: num(raw.wins), deaths: num(raw.deaths),
    kills: num(raw.kills), deepest: num(raw.deepest),
    best: { ...emptyBest(), ...dict(raw.best) },
    callings: dict(raw.callings), species: dict(raw.species), feats: dict(raw.feats),
    history: list(raw.history).filter(isObject).slice(0, HISTORY_CAP),
    recorded: list(raw.recorded).slice(-RECORDED_CAP),
    lastRun: isObject(raw.lastRun) ? raw.lastRun : null,
  };
};

export const loadProfile = (storage) => {
  try {
    const text = storage?.getItem?.(PROFILE_KEY);
    return text ? normalize(JSON.parse(text)) : emptyProfile();
  } catch {
    return emptyProfile();
  }
};

/** Returns true when the write landed. */
export const saveProfile = (storage, profile) => {
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
};

/** Folds one finished run in. Idempotent by gameID; never mutates the input. */
export const recordRun = (profile, ending, extras = {}) => {
  const base = normalize(profile);
  const game = ending?.gameID;
  if (game == null || game === "" || base.recorded.includes(game))
    return { profile, recorded: false, deltas: null };

  const debug = !!ending.debug;
  const score = num(ending.score), kills = num(ending.kills), moves = num(ending.moves);
  const depth = num(ending.depth);
  const deepest = Math.max(depth, num(ending.deepest));
  const winner = !!ending.winner;
  const character = typeof ending.character === "string" && ending.character ? ending.character : null;
  const at = extras.at ?? Date.now();

  const previousBest = { ...base.best };
  const newBest = {
    score: !debug && score > previousBest.score,
    depth: !debug && deepest > previousBest.depth,
    kills: !debug && kills > previousBest.kills,
  };
  const best = { ...previousBest };
  if (newBest.score) Object.assign(best, { score, game, moves });
  if (newBest.depth) best.depth = deepest;
  if (newBest.kills) best.kills = kills;

  const callings = { ...base.callings };
  let callingBest = false;
  if (character) {
    const prior = dict(callings[character]);
    callingBest = !debug && score > num(prior.best);
    callings[character] = {
      runs: num(prior.runs) + 1,
      best: callingBest ? score : num(prior.best),
    };
  }

  const entry = { game, at, character, hardlev: num(ending.hardlev), score,
    what: ending.what ?? "", depth, kills, moves, winner };
  if (debug) entry.debug = true;
  const history = [entry, ...base.history].slice(0, HISTORY_CAP);
  const rank = 1 + history.filter((run) => num(run.score) > score).length;

  const next = {
    ...base,
    runs: base.runs + 1,
    wins: base.wins + (winner ? 1 : 0),
    deaths: base.deaths + (winner ? 0 : 1),
    kills: base.kills + kills,
    deepest: debug ? base.deepest : Math.max(base.deepest, deepest),
    best, callings, history,
    recorded: [...base.recorded, game].slice(-RECORDED_CAP),
    lastRun: {
      name: extras.name ?? ending.who ?? base.lastRun?.name ?? "",
      character: character ?? base.lastRun?.character ?? "",
      difficulty: extras.difficulty ?? num(ending.hardlev),
    },
  };
  return {
    profile: next,
    recorded: true,
    deltas: { newBest, previousBest, rank, of: history.length, callingBest },
  };
};

/** seen is sticky (1 once sighted); killed counts. Same object back when nothing changed. */
export const noteSpecies = (profile, id, { seen = false, killed = false, at } = {}) => {
  if (id == null || (!seen && !killed)) return { profile, firstSeen: false };
  const prior = dict(profile?.species?.[id]);
  const wasSeen = num(prior.seen) > 0;
  if (wasSeen && !killed) return { profile, firstSeen: false };
  const entry = {
    seen: wasSeen ? num(prior.seen) : 1,
    killed: num(prior.killed) + (killed ? 1 : 0),
    first: wasSeen ? prior.first ?? null : at ?? Date.now(),
  };
  return {
    profile: { ...profile, species: { ...dict(profile?.species), [id]: entry } },
    firstSeen: !wasSeen,
  };
};

export const bestiaryCount = (profile) =>
  Object.values(dict(profile?.species)).filter((entry) => num(entry?.seen) > 0).length;

export const rememberLastRun = (profile, { name = "", character = "", difficulty = 0 } = {}) => {
  const last = profile?.lastRun;
  if (last && last.name === name && last.character === character && last.difficulty === difficulty)
    return profile;
  return { ...profile, lastRun: { name, character, difficulty } };
};
