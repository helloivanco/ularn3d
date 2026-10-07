// Shared browser/desktop score storage. Only the publishable API key reaches clients.
(() => {
  const config = window.ULARN_SCORE_CONFIG || {};
  const QUEUE_PREFIX = 'ularn.global.pending.v1.';
  const TABLE = 'ularn_scores';
  const columns = 'game_id,edition,ularn,winner,player_name,character,difficulty,score,time_used,moves,fate,level_name,created_at';
  let flushing = null;
  let retryTimer = null;
  let retryDelay = 30000;
  let state = 'idle';
  let syncError = '';
  let latestSyncedGame = '';

  function configured() {
    return typeof config.url === 'string' && /^https:\/\//.test(config.url) &&
      typeof config.publishableKey === 'string' && !!config.publishableKey;
  }

  function pending() {
    const entries = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(QUEUE_PREFIX)) continue;
        try {
          const row = JSON.parse(localStorage.getItem(key));
          if (row?.game_id && row?.edition) entries.push({ key, row });
        } catch { /* A damaged queue entry must not stop other scores syncing. */ }
      }
    } catch { /* Local score handling already reports unavailable storage. */ }
    return entries;
  }

  function status() {
    return { configured: configured(), pending: pending().length, state, error: syncError, latestSyncedGame };
  }

  function notify(next, error = '') {
    state = next;
    syncError = error;
    window.dispatchEvent(new Event('ularn:update'));
  }

  async function request(query, options = {}) {
    if (!configured()) throw new Error('Global scores are not configured.');
    const url = new URL(`/rest/v1/${TABLE}`, config.url);
    url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(8000),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { apikey: config.publishableKey, ...options.headers },
    });
    if (!response.ok) {
      const error = new Error(`Global score request failed (${response.status}).`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return response;
  }

  function queueRow(score, edition) {
    if (score.debug) return null;
    const playerState = typeof score.player === 'string' ? JSON.parse(score.player) : score.player;
    const row = {
      game_id: score.gameID,
      edition,
      ularn: !!score.ularn,
      winner: !!score.winner,
      player_name: String(score.who || 'Adventurer').slice(0, 60),
      character: score.character || 'Adventurer',
      difficulty: Number(score.hardlev),
      score: Number(score.score),
      time_used: Number(score.timeused),
      moves: Number(score.moves ?? playerState?.MOVESMADE ?? 0),
      fate: String(score.what || '').slice(0, 200),
      level_name: String(score.level || 'H').slice(0, 30),
      details: {
        player: playerState,
        gamelog: (score.gamelog || []).slice(-30).map(line => String(line).slice(0, 500)),
        extra: score.extra,
        explored: score.explored,
        gender: score.gender,
      },
    };
    if (!/^[\w+-]{1,100}$/.test(row.game_id) ||
      !['3d', 'classic'].includes(edition) ||
      ![row.difficulty, row.score, row.time_used, row.moves].every(value => Number.isSafeInteger(value) && value >= 0) ||
      row.difficulty > 1000 || row.time_used > 1000000 || row.moves > 2147483647 ||
      !['Adventurer', 'Wizard', 'Rogue', 'Elf', 'Dwarf', 'Ogre', 'Klingon', 'Rambo'].includes(row.character) ||
      JSON.stringify(row.details).length > 100000)
      throw new Error('This score could not be prepared for global storage.');
    return row;
  }

  async function upload(row) {
    await request({ on_conflict: 'edition,game_id' }, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    latestSyncedGame = row.game_id;
  }

  function flush() {
    if (flushing) return flushing;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (!pending().length) return Promise.resolve(true);
    if (!configured() || !navigator.onLine) {
      notify('queued');
      return Promise.resolve(false);
    }
    flushing = (async () => {
      notify('syncing');
      try {
        // Separate keys make concurrent tabs' additions/removals independent.
        while (pending().length) {
          for (const entry of pending()) {
            await upload(entry.row);
            localStorage.removeItem(entry.key);
          }
        }
        retryDelay = 30000;
        notify(pending().length ? 'queued' : 'synced');
        return true;
      } catch (error) {
        notify('queued', error.message);
        if (error.retryable !== false) {
          retryTimer = setTimeout(flush, retryDelay);
          retryDelay = Math.min(300000, retryDelay * 2);
        }
        return false;
      } finally { flushing = null; }
    })();
    return flushing;
  }

  async function submit(score, edition = '3d') {
    try {
      const row = queueRow(score, edition);
      if (!row) return false;
      const key = `${QUEUE_PREFIX}${edition}.${row.game_id}`;
      try { localStorage.setItem(key, JSON.stringify(row)); }
      catch {
        // Still attempt an immediate upload if only queue storage is exhausted.
        if (configured() && navigator.onLine) { await upload(row); notify('synced'); return true; }
        throw new Error('The score is local, but its upload could not be queued.');
      }
      notify('queued');
      return await flush();
    } catch (error) { notify('error', error.message); return false; }
  }

  function fromRow(row) {
    return {
      ...row.details,
      gameID: row.game_id, ularn: row.ularn, winner: row.winner,
      who: row.player_name, character: row.character, hardlev: row.difficulty,
      score: row.score, timeused: row.time_used, moves: row.moves,
      what: row.fate, level: row.level_name, createdAt: Date.parse(row.created_at),
    };
  }

  async function highscores(ularn = true, edition = '3d') {
    try {
      await flush();
      const [winners, visitors] = await Promise.all([true, false].map(async winner => {
        const response = await request({
          select: columns, edition: `eq.${edition}`, ularn: `eq.${ularn}`, winner: `eq.${winner}`,
          order: winner ? 'difficulty.desc,time_used.asc,score.desc,game_id.asc' : 'difficulty.desc,score.desc,time_used.desc,game_id.asc',
          limit: '72',
        });
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error('Invalid global scoreboard response.');
        return rows.map(fromRow);
      }));
      return { winners, visitors };
    } catch { return null; }
  }

  async function details(gameID, edition = '3d') {
    try {
      const response = await request({ select: '*', edition: `eq.${edition}`, game_id: `eq.${gameID}`, limit: '1' });
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid score details response.');
      return rows[0] ? fromRow(rows[0]) : null;
    } catch { return null; }
  }

  window.ularnScoreService = Object.freeze({ submit, flush, highscores, details, status });
  window.addEventListener('online', flush);
  // A reload retries persisted uploads without requiring another expedition.
  if (pending().length) setTimeout(flush, 0);
})();
