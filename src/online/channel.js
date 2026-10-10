/** Notifications come from protected database rows, never from peer broadcasts. */
export const openRoomChannel = (supabase, { roomId, onAction, onChange, onStatus }) => {
  const channel = supabase.channel(`room:${roomId}`, { config: { private: true } });
  channel.on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'room_actions', filter: `room_id=eq.${roomId}`,
  }, payload => onAction?.(payload.new));
  for (const table of ['room_members', 'chat_messages']) {
    channel.on('postgres_changes', {
      event: '*', schema: 'public', table, filter: `room_id=eq.${roomId}`,
    }, () => onChange?.());
  }
  channel.subscribe(onStatus);
  return { close: () => supabase.removeChannel(channel) };
};
