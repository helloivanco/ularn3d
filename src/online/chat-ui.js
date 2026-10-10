import { mountIcons } from '../icons.js';
import { CHAT_EMOJI, QUICK_CHAT, createChatLog, insertChatEmoji } from './chat.js';

const WATCH_QUICK = ['Nice move!', 'Close one!', 'Good luck!'];
const channelName = channel => channel === 'spectators' ? 'Spectators' : 'Party';

/** Compact room chat. Channel permissions here mirror the server's chat rules. */
export const mountChatPanel = ({ root, persist, broadcast } = {}) => {
  const panel = document.createElement('aside');
  panel.id = 'chat-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Room chat');
  panel.innerHTML = `<header><strong>Room chat</strong><button type="button" id="chat-close" aria-label="Minimize chat" title="Minimize chat"><span data-icon="minus"></span></button></header>
    <div class="chat-tabs" role="group" aria-label="Chat channel"><button type="button" data-channel="party" aria-pressed="true">Party</button><button type="button" data-channel="spectators" aria-pressed="false">Spectators <span id="chat-unread" hidden>0</span></button></div>
    <p id="chat-audience"></p>
    <div id="chat-log" role="log" aria-live="polite" aria-label="Party messages"></div>
    <section id="chat-quick-section" aria-labelledby="chat-quick-title"><div class="chat-quick-heading"><strong id="chat-quick-title">Quick send</strong><span>Tap once to send</span></div><div id="chat-quick"></div></section>
    <form id="chat-form"><input id="chat-input" maxlength="280" aria-label="Message" aria-describedby="chat-audience" placeholder="Message your party…" autocomplete="off" /><button type="button" id="chat-emoji" aria-label="Emoji" aria-expanded="false" aria-controls="chat-emoji-picker" aria-haspopup="true">😀</button><button type="submit">Send</button><div id="chat-emoji-picker" role="group" aria-label="Emoji" hidden></div></form>
    <p id="chat-status" role="status" hidden></p><p class="chat-key-hint">Enter to chat · Esc to return to game</p>`;
  const toggle = document.createElement('button');
  toggle.id = 'chat-toggle';
  toggle.type = 'button';
  toggle.hidden = true;
  toggle.setAttribute('aria-label', 'Open chat');
  toggle.setAttribute('aria-controls', 'chat-panel');
  toggle.setAttribute('aria-expanded', 'false');
  root.append(panel, toggle);
  mountIcons(panel);

  const input = panel.querySelector('#chat-input');
  const form = panel.querySelector('#chat-form');
  const send = form.querySelector('button[type=submit]');
  const emoji = panel.querySelector('#chat-emoji');
  const picker = panel.querySelector('#chat-emoji-picker');
  const quick = panel.querySelector('#chat-quick');
  const status = panel.querySelector('#chat-status');
  const log = panel.querySelector('#chat-log');
  const tabs = [...panel.querySelectorAll('[data-channel]')];
  const model = createChatLog({ persist });
  let identity = { name: 'Ada', userId: 'local', role: 'player' };
  let hideSpectatorChat = false;
  let sending = false;
  let closedUnread = 0;
  let renderedMessages = '';
  let quickChannel = '';
  let historyKnown = false;
  let knownMessages = new Set();

  const canSend = () => identity.role === 'host' ||
    (identity.role === 'spectator' ? model.channel() === 'spectators' : model.channel() === 'party');
  const closeEmoji = () => {
    picker.hidden = true;
    emoji.setAttribute('aria-expanded', 'false');
  };
  const note = (text, kind = '') => {
    status.hidden = !text;
    status.textContent = text;
    status.dataset.kind = kind;
  };
  const renderBadges = () => {
    const unread = panel.querySelector('#chat-unread');
    const other = tabs.find(tab => tab.dataset.channel !== model.channel());
    if (other) other.append(unread);
    unread.hidden = model.unread() < 1;
    unread.textContent = String(model.unread());
    toggle.textContent = closedUnread ? `Chat · ${closedUnread} new` : 'Chat';
    toggle.setAttribute('aria-label', closedUnread ? `Open chat, ${closedUnread} new messages` : 'Open chat');
  };
  const syncControls = () => {
    const writable = canSend();
    const channel = model.channel();
    tabs.forEach(tab => {
      const selected = tab.dataset.channel === channel;
      tab.classList.toggle('acting', selected);
      tab.setAttribute('aria-pressed', String(selected));
      tab.disabled = sending;
      tab.hidden = tab.dataset.channel === 'spectators' && identity.role === 'player' && hideSpectatorChat;
    });
    input.disabled = !writable;
    input.placeholder = writable ? channel === 'party' ? 'Message your party…' : 'Message spectators…' : 'Read-only channel';
    emoji.disabled = !writable;
    send.disabled = sending || !writable || !input.value.trim();
    send.textContent = sending ? 'Sending…' : 'Send';
    panel.querySelector('#chat-audience').textContent = !writable
      ? `Read-only. Switch to ${identity.role === 'spectator' ? 'Spectators' : 'Party'} to send.`
      : channel === 'party' ? 'Everyone in the room can read this.' : 'Spectators and the host can reply.';
    panel.querySelector('#chat-quick-section').hidden = !writable;
    const presets = channel === 'party' ? QUICK_CHAT : WATCH_QUICK;
    if (quickChannel !== channel) {
      quickChannel = channel;
      quick.replaceChildren();
      for (const phrase of presets) {
        const action = document.createElement('button');
        action.type = 'button';
        action.textContent = phrase === 'Low HP' ? 'Low health' : phrase;
        action.dataset.message = phrase;
        action.title = `Send “${phrase}” to ${channelName(channel)}`;
        action.setAttribute('aria-label', `Send “${phrase}” to ${channelName(channel)}`);
        action.addEventListener('click', () => post(phrase, true));
        quick.append(action);
      }
    }
    quick.querySelectorAll('button').forEach(action => { action.disabled = sending || !writable; });
    renderBadges();
  };
  const render = (forceScroll = false) => {
    const rows = model.visible();
    const signature = JSON.stringify([model.channel(), identity.userId, rows]);
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 28;
    const scroll = log.scrollTop;
    if (signature !== renderedMessages) {
      renderedMessages = signature;
      log.setAttribute('aria-label', `${channelName(model.channel())} messages`);
      log.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'chat-empty';
        empty.textContent = canSend() ? 'No messages yet. Say hello or use Quick send below.' : 'No messages in this channel yet.';
        log.append(empty);
      }
      for (const message of rows) {
        const row = document.createElement('div');
        const own = message.userId === identity.userId;
        row.className = `chat-message${own ? ' chat-message-self' : ''}`;
        const author = document.createElement('strong');
        author.textContent = own ? 'You' : message.name;
        const body = document.createElement('span');
        body.textContent = message.body;
        row.append(author, body);
        log.append(row);
      }
      log.scrollTop = forceScroll || atBottom ? log.scrollHeight : scroll;
    }
    syncControls();
  };
  const post = async (body, preset = false) => {
    if (sending || !canSend()) return { ok: false };
    const draft = input.value;
    const channel = model.channel();
    const text = String(body || '').trim();
    if (!text) return { ok: false };
    sending = true;
    note(preset ? `Sending “${text}”…` : 'Sending your message…');
    syncControls();
    let result;
    try {
      result = await model.post({ body, name: identity.name, userId: identity.userId });
      if (result.ok) {
        broadcast?.(result.message);
        if (!preset && input.value === draft) input.value = '';
        note(preset ? `Sent to ${channelName(channel)}: ${text}` : `Message sent to ${channelName(channel)}.`, 'success');
      } else {
        const errors = {
          filtered: 'Message not sent. Please choose different wording.',
          rate_limited: 'Please wait a few seconds before sending another message.',
          bad_channel: 'You cannot send to this channel. Choose your own chat channel.',
          not_member: 'Message not sent. You are no longer in this room.',
          length: 'Use a message between 1 and 280 characters.',
        };
        note(errors[result.error] || 'Message not sent. Check your connection and try again.', 'error');
      }
    } catch {
      result = { ok: false, error: 'unavailable' };
      note('Message not sent. Check your connection and try again.', 'error');
    } finally {
      sending = false;
      render(true);
      if (preset && quick.contains(document.activeElement)) document.activeElement.blur();
    }
    return result;
  };
  const open = (focus = false) => {
    panel.hidden = false;
    toggle.hidden = true;
    toggle.setAttribute('aria-expanded', 'true');
    closedUnread = 0;
    render(true);
    if (focus) {
      if (canSend()) input.focus();
      else tabs.find(tab => tab.dataset.channel === model.channel())?.focus();
    }
  };
  const minimize = () => {
    closeEmoji();
    input.blur();
    model.setTyping(false);
    panel.hidden = true;
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', 'false');
    renderBadges();
    toggle.focus();
  };
  panel.querySelector('#chat-close').addEventListener('click', minimize);
  toggle.addEventListener('click', () => open(true));
  input.addEventListener('input', () => {
    if (!sending) note('');
    syncControls();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    closeEmoji();
    post(input.value);
  });
  tabs.forEach(tab => tab.addEventListener('click', () => {
    if (sending) return;
    model.setChannel(tab.dataset.channel);
    closeEmoji();
    note('');
    renderedMessages = '';
    render(true);
  }));

  for (const glyph of CHAT_EMOJI) {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.textContent = glyph;
    choice.dataset.emoji = glyph;
    choice.setAttribute('aria-label', glyph);
    picker.append(choice);
  }
  const typingTarget = node => panel.contains(node) || node === toggle;
  panel.addEventListener('focusin', () => model.setTyping(true));
  panel.addEventListener('focusout', event => {
    if (!typingTarget(event.relatedTarget)) model.setTyping(false);
  });
  emoji.addEventListener('mousedown', event => event.preventDefault());
  picker.addEventListener('mousedown', event => event.preventDefault());
  emoji.addEventListener('click', () => {
    picker.hidden = !picker.hidden;
    emoji.setAttribute('aria-expanded', String(!picker.hidden));
    input.focus();
  });
  picker.addEventListener('click', event => {
    const choice = event.target.closest('[data-emoji]');
    if (!choice) return;
    const placed = insertChatEmoji(input.value, choice.dataset.emoji, input.selectionStart, input.selectionEnd);
    if (placed) {
      input.value = placed.value;
      input.setSelectionRange(placed.cursor, placed.cursor);
      syncControls();
    }
    closeEmoji();
    input.focus();
  });
  panel.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (!picker.hidden) closeEmoji();
    else {
      document.activeElement?.blur();
      model.setTyping(false);
    }
  });
  document.addEventListener('mousedown', event => {
    if (!event.target.closest('#chat-emoji, #chat-emoji-picker')) closeEmoji();
  });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey ||
        event.target.closest('input, textarea, select, button, a') || document.querySelector('dialog[open]') ||
        (panel.hidden && toggle.hidden)) return;
    event.preventDefault();
    event.stopPropagation();
    open(true);
  }, true);
  render();
  return {
    open,
    history: rows => {
      const incoming = rows || [];
      if (historyKnown) {
        for (const row of incoming) {
          if (row.id && !knownMessages.has(row.id) && row.userId !== identity.userId) {
            model.receive(row);
            if (panel.hidden) closedUnread += 1;
          }
        }
      }
      knownMessages = new Set(incoming.map(row => row.id).filter(Boolean));
      historyKnown = true;
      model.history(incoming);
      render();
    },
    receive: message => {
      const accepted = model.receive(message);
      if (accepted && panel.hidden) closedUnread += 1;
      render();
    },
    setIdentity: next => {
      if (identity.userId !== next.userId) { historyKnown = false; knownMessages.clear(); }
      const changed = identity.role !== next.role;
      identity = { ...identity, ...next };
      if (changed) model.setChannel(identity.role === 'spectator' ? 'spectators' : 'party');
      render();
    },
    setRole: (role, hidden = false) => {
      const changed = identity.role !== role;
      identity.role = role;
      hideSpectatorChat = hidden;
      if (changed || (hidden && role === 'player' && model.channel() === 'spectators')) {
        model.setChannel(role === 'spectator' ? 'spectators' : 'party');
      }
      render();
    },
    blocksGameKeys: model.blocksGameKeys,
    pings: model.pings,
    ping: model.ping,
  };
};
