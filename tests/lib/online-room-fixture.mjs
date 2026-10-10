/** Service boundary fixture. Browsers run the real UI, log follower and engine. */
export const onlineRoomFixture = () => {
  const room = { id: 'test-room', join_code: 'ABC234', status: 'lobby', seed: 2, action_seq: 0, hide_spectator_chat: false };
  const members = [], messages = [], actions = [], clients = [];
  const calls = new Map(), failures = new Set(), rejections = new Set(), gates = new Map();
  const hold = name => {
    let release;
    gates.set(name, new Promise(resolve => { release = resolve; }));
    return () => { gates.delete(name); release(); };
  };
  const notify = (table, row = {}) => {
    for (const client of clients) {
      if (!client.page.isClosed()) client.page.evaluate(event => window.__roomNotify?.(event), { table, row }).catch(() => {});
    }
  };
  const append = async (member, kind, input = null, requestId = null) => {
    const row = { room_id: room.id, seq: ++room.action_seq, user_id: member.user_id, actor: member.slot, kind, input, name: member.display_name, character_class: member.character || 'Adventurer', request_id: requestId };
    actions.push(row);
    await notify('room_actions', row);
    return row;
  };
  const attach = async (page, userId) => {
    clients.push({ page, userId });
    let name = 'Ada';
    await page.exposeFunction('__onlineCall', async (raw, args = {}) => {
      const operation = ({ create_room_as: 'create_room', join_room_as: 'join_room', start_room: 'start_run' })[raw] || raw;
      calls.set(operation, (calls.get(operation) || 0) + 1);
      await gates.get(operation);
      if (rejections.delete(operation)) throw new Error('Connection lost');
      if (failures.delete(operation)) return operation === 'subscribe' ? false : { data: null, error: { message: 'Connection failed' } };
      const mine = () => members.find(member => member.user_id === userId);
      let data = { ok: true };
      switch (operation) {
        case 'set_display_name': name = args.p_display_name; break;
        case 'create_room':
          name = args.p_display_name;
          room.host_user_id = userId;
          members.push({ user_id: userId, display_name: name, role: 'host', slot: 0, connected: true, ready: false, character: args.p_character_class || 'Adventurer' });
          data = { ok: true, room_id: room.id, join_code: room.join_code };
          break;
        case 'join_room':
          if (args.p_code !== room.join_code) data = { ok: false, error: 'room_not_found' };
          else {
            if (!mine()) {
              const slot = args.p_role === 'spectator' ? null : members.filter(member => member.role !== 'spectator').length;
              const member = { user_id: userId, display_name: name, role: args.p_role, slot, connected: true, ready: false, character: args.p_character_class || 'Adventurer' };
              members.push(member);
              if (room.status === 'playing' && slot != null) await append(member, 'join');
            }
            data = { ok: true, room_id: room.id, role: mine().role, slot: mine().slot };
            await notify('room_members');
          }
          break;
        case 'resume_room':
          data = !mine() || mine().banned ? { ok: false, error: 'not_member' } : { ok: true, room_id: room.id, join_code: room.join_code, role: mine().role, slot: mine().slot };
          break;
        case 'set_ready':
          if (mine()?.role === 'spectator' || room.status !== 'lobby') data = { ok: false, error: 'not_player' };
          else { mine().ready = args.p_ready; data = { ok: true, ready: mine().ready }; await notify('room_members'); }
          break;
        case 'start_run':
          if (mine()?.role !== 'host') data = { ok: false, error: 'not_host' };
          else if (!members.filter(member => member.role !== 'spectator').every(member => member.ready)) data = { ok: false, error: 'not_ready' };
          else {
            room.status = 'playing'; room.run_id = 'test-run';
            room.game_config = { version: 2, difficulty: args.p_difficulty || 0, players: members.filter(member => member.role !== 'spectator').map(member => ({ userId: member.user_id, name: member.display_name, slot: member.slot, character: member.character })) };
            data = { ok: true, run_id: room.run_id, seed: 2 };
          }
          break;
        case 'sync_room':
          if (!mine() || mine().banned) data = { ok: false, error: 'not_member' };
          else data = { ok: true, room: { ...room }, members: members.map(member => ({ ...member, userId: member.user_id, name: member.display_name })), actions: actions.filter(row => row.seq > args.p_after), chat: messages.filter(message => !room.hide_spectator_chat || mine().role !== 'player' || message.channel === 'party') };
          break;
        case 'send_room_action':
          if (!mine() || mine().banned || !mine().connected) data = { ok: false, error: 'not_member' };
          else if (mine().role === 'spectator') data = { ok: false, error: 'spectator' };
          else {
            const old = actions.find(row => row.user_id === userId && row.request_id === args.p_request_id);
            data = { ok: true, action: old || await append(mine(), 'key', args.p_input, args.p_request_id) };
          }
          break;
        case 'post_chat':
          if (!mine() || (args.p_channel === 'party' && mine().role === 'spectator') || (args.p_channel === 'spectators' && mine().role === 'player')) data = { ok: false, error: 'bad_channel' };
          else {
            const id = `chat-${messages.length + 1}`;
            messages.push({ id, channel: args.p_channel, body: args.p_body, user_id: userId, name: mine().display_name });
            data = { ok: true, id }; await notify('chat_messages');
          }
          break;
        case 'recent_chat': data = messages.slice(-50); break;
        case 'kick_member':
          if (mine()?.role !== 'host') data = { ok: false, error: 'not_host' };
          else {
            const target = members.find(member => member.user_id === args.p_user_id);
            target.banned = true; target.connected = false;
            if (target.slot != null) await append(target, 'leave');
            await notify('room_members');
          }
          break;
        case 'transfer_host':
          if (mine()?.role !== 'host') data = { ok: false, error: 'not_host' };
          else { mine().role = 'player'; members.find(member => member.user_id === args.p_user_id).role = 'host'; room.host_user_id = args.p_user_id; await notify('room_members'); }
          break;
        case 'leave_room':
          if (mine()) {
            if (mine().slot != null) await append(mine(), 'leave');
            mine().connected = false;
            if (mine().role === 'host') { const heir = members.find(member => member.role === 'player' && member.connected); if (heir) { mine().role = 'player'; heir.role = 'host'; room.host_user_id = heir.user_id; } }
            await notify('room_members');
          }
          break;
        case 'subscribe': return true;
      }
      return { data, error: null };
    });
    await page.addInitScript(({ userId }) => {
      const handlers = [];
      window.__roomNotify = ({ table, row }) => { for (const entry of handlers) if (entry.table === table) entry.handler({ new: row }); };
      window.__onlineClient = {
        auth: { getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: userId } } } }) },
        rpc: (name, args) => window.__onlineCall(name, args),
        channel: () => {
          const channel = {
            on(type, options, handler) { if (type === 'postgres_changes') handlers.push({ table: options.table, handler }); return channel; },
            subscribe(callback) { window.__onlineCall('subscribe').then(ok => callback(ok ? 'SUBSCRIBED' : 'CHANNEL_ERROR')); return channel; },
          };
          return channel;
        },
        removeChannel: () => { handlers.length = 0; },
      };
    }, { userId });
    await page.route('**/src/online/config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'export const readOnlineEnv = () => ({ url: "https://online.test", key: "test-key" }); export const getSupabase = async () => window.__onlineClient;' }));
    await page.goto('/play/');
    await page.waitForFunction(() => window.ularnOnline);
  };
  return { attach, hold, failNext: name => failures.add(name), throwNext: name => rejections.add(name), count: name => calls.get(name) || 0, members, actions };
};
