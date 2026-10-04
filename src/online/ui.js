import { mountIcons } from "../icons.js";
import { displayNameError } from "./words.js";
import { getSupabase, readOnlineEnv } from "./config.js";
import { ensureOnlineSession } from "./session.js";
import { chooseHeir, formatBrowseRoom, showReconnecting } from "./reliability.js";
import { createSpectatorView } from "./spectator.js";
import { createChatLog, mapChatRows } from "./chat.js";
import { publicBoard } from "../../supabase/functions/_shared/submit.js";
import { sendChatMessage } from "./rooms.js";
import { beginRun, claimAbandonedHost, enterRoom, hostRoom, listPublicRooms, markReady } from "./rooms.js";
import { createLiveRoom, loadScores } from "./live.js";

const QUICK = ["Help!", "Follow me", "Wait", "Going down", "Low HP"];

const panel = (title, body) => {
  const dialog = document.createElement("dialog");
  dialog.className = "panel dialog online-dialog";
  dialog.innerHTML = `<form method="dialog"><header><h2></h2><button type="submit" class="dialog-x" value="close" aria-label="Close"><span data-icon="close"></span></button></header><div class="online-body"></div><p class="online-status" role="status"></p></form>`;
  dialog.querySelector("h2").textContent = title;
  mountIcons(dialog);
  const slot = dialog.querySelector(".online-body");
  if (typeof body === "string") slot.innerHTML = body;
  else slot.append(body);
  document.body.append(dialog);
  return dialog;
};

const statusOf = (dialog) => dialog.querySelector(".online-status");

export const mountOnlineUi = () => {
  const root = document.createElement("div");
  root.id = "online-root";
  document.body.append(root);

  const menu = panel("Multiplayer", document.createElement("div"));
  const menuBody = menu.querySelector(".online-body");
  const unavailable = !readOnlineEnv();
  const menuNote = document.createElement("p");
  menuNote.textContent = unavailable
    ? "Online unavailable"
    : "Host a room, join with a code, or watch a public game.";
  const hostButton = button("Host a room");
  const joinButton = button("Join with a code");
  const joinDialog = panel("Join", document.createElement("form"));
  const joinForm = joinDialog.querySelector(".online-body");
  joinForm.classList.add("online-form");
  joinForm.append(
    field("Code", "join-code", ""),
    field("Password (optional)", "join-password", ""),
    field("Display name", "join-name", "Ada"),
  );
  const joinSubmit = button("Join room");
  joinForm.append(joinSubmit);
  const watchDialog = panel("Watch", document.createElement("form"));
  const watchForm = watchDialog.querySelector(".online-body");
  watchForm.classList.add("online-form");
  watchForm.append(
    field("Code", "watch-code", ""),
    field("Password (optional)", "watch-password", ""),
    field("Display name", "watch-name", "Cid"),
  );
  const watchSubmit = button("Watch room");
  watchForm.append(watchSubmit);
  const scoreBanner = document.createElement("p");
  scoreBanner.id = "score-banner";
  scoreBanner.hidden = true;
  root.append(scoreBanner);
  const browseButton = button("Browse public rooms");
  const watchButton = button("Watch");
  const boardButton = button("Leaderboard");
  menuBody.append(menuNote, hostButton, joinButton, browseButton, watchButton, boardButton);

  const hostDialog = panel("Host", document.createElement("form"));
  const hostForm = hostDialog.querySelector(".online-body");
  hostForm.classList.add("online-form");
  hostForm.append(
    field("Display name", "host-name", "Ada"),
    field("Password (optional)", "host-password", ""),
    field("Max players (2–4)", "host-max", "4"),
    field("Turn timer seconds (0 is off)", "host-timer", "20"),
  );
  const publicLabel = document.createElement("label");
  publicLabel.innerHTML = `<input id="host-public" type="checkbox" checked /> Public room`;
  const createButton = button("Create lobby");
  hostForm.append(publicLabel, createButton);

  const lobby = panel("Lobby", document.createElement("div"));
  const chat = document.createElement("aside");
  chat.id = "chat-panel";
  chat.hidden = true;
  chat.innerHTML = `<header><span>Chat</span><button type="button" id="chat-close" aria-label="Close chat">×</button></header><div class="chat-tabs"><button type="button" data-channel="party" class="acting">Party</button><button type="button" data-channel="spectators">Spectators</button><em id="chat-unread" hidden>0</em></div><div id="chat-log" aria-live="polite"></div><div id="chat-quick"></div><form id="chat-form"><input id="chat-input" maxlength="280" aria-label="Message" autocomplete="off" /><button type="submit">Send</button></form>`;
  root.append(chat);
  const overlay = document.createElement("div");
  overlay.id = "reconnect-overlay";
  overlay.hidden = true;
  overlay.textContent = "Reconnecting…";
  const toast = document.createElement("div");
  toast.id = "host-toast";
  toast.hidden = true;
  root.append(overlay, toast);
  for (const phrase of QUICK) {
    const quick = document.createElement("button");
    quick.type = "button";
    quick.textContent = phrase;
    quick.addEventListener("click", () => sendChat(phrase));
    chat.querySelector("#chat-quick").append(quick);
  }

  const board = panel("Leaderboard", document.createElement("div"));
  let spectating = false;
  let watch = null;
  let roomId = null;
  let roomMembers = [];
  let live = null;
  let displayName = "Ada";
  let selfId = null;
  let selfRole = "player";
  let selfSlot = 0;
  let started = false;
  const knowFor = (name) => (typeof window.ularn?.fog === "function" ? window.ularn.fog(name) : null);
  const chatLog = createChatLog({
    persist: (message) => (roomId ? sendChatMessage(roomId, message.channel, message.body) : null),
  });

  const renderChat = () => {
    const log = chat.querySelector("#chat-log");
    log.replaceChildren();
    for (const message of chatLog.visible()) {
      const row = document.createElement("p");
      row.textContent = `${message.name}: ${message.body}`;
      log.append(row);
    }
    const badge = chat.querySelector("#chat-unread");
    badge.hidden = chatLog.unread() < 1;
    badge.textContent = String(chatLog.unread());
  };

  const sendChat = async (body) => {
    const sent = await chatLog.post({ body, name: displayName, userId: selfId || "local" });
    if (!sent.ok && sent.error === "filtered") statusOf(menu).textContent = "That message is not allowed.";
    if (sent.ok) live?.say(sent.message);
    renderChat();
  };

  chat.querySelector("#chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = chat.querySelector("#chat-input");
    sendChat(input.value);
    input.value = "";
  });
  chat.querySelectorAll(".chat-tabs button").forEach((tab) => {
    tab.addEventListener("click", () => {
      chatLog.setChannel(tab.dataset.channel);
      chat.querySelectorAll(".chat-tabs button").forEach((other) => other.classList.toggle("acting", other === tab));
      renderChat();
    });
  });
  chat.querySelector("#chat-close").addEventListener("click", () => {
    chat.hidden = true;
  });

  const chatInput = chat.querySelector("#chat-input");
  chatInput.addEventListener("focus", () => chatLog.setTyping(true));
  chatInput.addEventListener("blur", () => chatLog.setTyping(false));
  chatInput.addEventListener("keydown", (event) => event.stopPropagation());

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || chat.hidden) return;
    if (event.target.matches("input, textarea")) return;
    event.preventDefault();
    event.stopPropagation();
    chatInput.focus();
  }, true);

  const paintBrowse = (rooms) => {
    const body = menu.querySelector(".online-body");
    const existing = body.querySelector(".board-list");
    existing?.remove();
    const list = document.createElement("ul");
    list.className = "board-list";
    for (const room of rooms) {
      const item = document.createElement("li");
      item.textContent = formatBrowseRoom(room).label;
      list.append(item);
    }
    if (!rooms.length) {
      const item = document.createElement("li");
      item.textContent = "No public rooms yet.";
      list.append(item);
    }
    body.append(list);
  };

  let lobbyStamp = "";
  const showLobby = (members, codeText = "K7MQ2P") => {
    if (started) return;
    const stamp = `${codeText}|${live?.ready?.() ? 1 : 0}|${selfRole}|${members.map((member) => `${member.userId || member.name}:${member.ready}:${member.connected}:${member.role}`).join(",")}`;
    if (stamp === lobbyStamp && lobby.open) return;
    lobbyStamp = stamp;
    const body = lobby.querySelector(".online-body");
    body.replaceChildren();
    const code = document.createElement("p");
    code.className = "room-code";
    const strong = document.createElement("strong");
    strong.textContent = codeText;
    code.append("Code ", strong);
    const town = document.createElement("p");
    town.textContent = "Joining a game in progress starts a fresh character in town.";
    const list = document.createElement("ul");
    for (const member of members) {
      const item = document.createElement("li");
      item.textContent = `${member.name} · ${member.role}${member.ready ? " · ready" : ""}${member.ping != null ? ` · ${member.ping} ms` : ""}`;
      list.append(item);
    }
    const ready = button(live?.ready?.() ? "Ready" : "Not ready");
    ready.id = "lobby-ready";
    const start = button("Start");
    start.id = "lobby-start";
    const players = members.filter((member) => member.connected !== false && member.role !== "spectator" && !member.banned);
    const allReady = players.length >= 2 && players.every((member) => member.ready);
    start.hidden = selfRole !== "host";
    start.disabled = !allReady;
    ready.hidden = selfRole === "spectator";
    ready.addEventListener("click", async () => {
      if (!live) {
        ready.setAttribute("aria-pressed", "true");
        ready.textContent = "Ready";
        return;
      }
      const result = await live.toggleReady();
      if (!result?.ok) statusOf(lobby).textContent = "Online unavailable";
    });
    start.addEventListener("click", async () => {
      if (!live) {
        statusOf(lobby).textContent = "Starting when everyone is ready.";
        return;
      }
      const result = await live.start();
      if (!result?.ok) {
        statusOf(lobby).textContent = result?.error === "not_host"
          ? "The host starts the game."
          : "Online unavailable";
      }
    });
    body.append(code, town, list, ready, start);
    statusOf(lobby).textContent = selfRole === "spectator"
      ? "You are watching. You cannot take a turn."
      : players.length < 2
        ? "Waiting for another player to join."
        : allReady
          ? "Everyone is ready."
          : "Waiting for everyone to be ready.";
    if (!started && !lobby.open) lobby.show();
  };

  const showBoard = (rows) => {
    const body = board.querySelector(".online-body");
    body.replaceChildren();
    const tabs = document.createElement("div");
    tabs.className = "chat-tabs";
    for (const label of ["Solo", "Co-op", "All time", "This week", "Today"]) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.textContent = label;
      tab.className = label === "Solo" || label === "All time" ? "acting" : "";
      tabs.append(tab);
    }
    const table = document.createElement("ol");
    table.className = "board-list";
    publicBoard(rows).forEach((row, index) => {
      const item = document.createElement("li");
      if (row.yours) item.className = "yours";
      item.textContent = `${index + 1}. ${row.name} · ${row.score}${row.verified ? " · verified" : ""}`;
      table.append(item);
    });
    if (!publicBoard(rows).length) {
      const empty = document.createElement("p");
      empty.textContent = "No verified scores yet.";
      body.append(empty);
    }
    body.append(tabs, table);
    board.showModal();
  };

  const showScore = (result) => {
    const verified = result?.verified === true;
    const reason = result?.reason || result?.error;
    const text = verified
      ? `Verified score: ${result.score}`
      : reason === "too_fast"
        ? "Score rejected: that run finished too quickly to count."
        : reason === "unavailable"
          ? "Score rejected: online unavailable."
          : reason === "replay_failed" || reason === "replay_cpu_cap"
            ? "Score rejected: the run could not be replayed."
            : `Score rejected: ${reason || "the run was not accepted."}`;
    scoreBanner.hidden = false;
    scoreBanner.textContent = text;
  };

  const ingestChat = (payload, replace) => {
    if (replace && Array.isArray(payload)) chatLog.history(mapChatRows(payload));
    else if (payload && !Array.isArray(payload)) chatLog.receive(mapChatRows([payload])[0]);
    renderChat();
  };

  const connectLive = async ({ id, code, role, slot, name }) => {
    roomId = id;
    displayName = name;
    selfRole = role || "player";
    selfSlot = Number.isInteger(slot) ? slot : 0;
    spectating = selfRole === "spectator";
    started = false;
    const supabase = await getSupabase();
    const session = supabase ? await supabase.auth.getSession() : null;
    selfId = session?.data?.session?.user?.id || null;
    if (!selfId) {
      statusOf(menu).textContent = "Online unavailable";
      return { ok: false, error: "unavailable" };
    }
    live?.close();
    live = createLiveRoom({
      self: { userId: selfId, role: selfRole, slot: selfSlot, name: displayName },
      roomId,
      onRoster: (members, room) => {
        roomMembers = members;
        const mine = members.find((member) => member.userId === selfId);
        if (mine?.role) selfRole = mine.role;
        spectating = selfRole === "spectator";
        if (live?.started()) return;
        showLobby(members, room?.join_code || code);
      },
      onChat: (payload, replace) => ingestChat(payload, replace),
      onStatus: (text) => {
        const dialog = lobby.open ? lobby : menu;
        statusOf(dialog).textContent = text;
      },
      onStarted: () => {
        started = true;
        for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
        const welcome = document.getElementById("welcome");
        const caption = document.getElementById("scene-caption");
        const hud = document.getElementById("hud");
        const pause = document.getElementById("pause");
        if (welcome) welcome.hidden = true;
        if (caption) caption.hidden = true;
        if (hud) hud.hidden = false;
        if (pause) pause.hidden = false;
        document.body.classList.add("playing");
        chat.hidden = false;
        window.ularnGraphics?.beginExpeditionCamera?.();
        window.dispatchEvent(new Event("ularn:update"));
      },
      onScore: (result) => showScore(result),
      onClaimed: () => {
        selfRole = "host";
        toast.hidden = false;
        toast.textContent = "You are the host now.";
      },
    });
    const opened = await live.open();
    if (!opened?.ok) {
      statusOf(menu).textContent = "Online unavailable";
      return opened;
    }
    chat.hidden = false;
    return opened;
  };

  hostButton.addEventListener("click", () => {
    menu.close();
    hostDialog.showModal();
  });
  const rememberChat = (rows) => {
    chatLog.history(mapChatRows(rows));
    chat.hidden = false;
    renderChat();
  };

  const joinProblem = (error) => {
    if (error === "unavailable" || error === "unauthenticated") return "Online unavailable";
    if (error === "room_not_found") return "That code does not match a room.";
    if (error === "bad_password") return "That password is wrong.";
    if (error === "room_full") return "That room is already full.";
    return "Could not join that room.";
  };

  const enter = async (form, role) => {
    const prefix = role === "spectator" ? "watch" : "join";
    const dialog = role === "spectator" ? watchDialog : joinDialog;
    const name = form.querySelector(`#${prefix}-name`).value;
    const problem = displayNameError(name);
    if (problem) {
      statusOf(dialog).textContent = problem === "filtered" ? "That name is not allowed." : "Use 3–16 letters.";
      return;
    }
    const joined = await enterRoom({
      code: form.querySelector(`#${prefix}-code`).value,
      password: form.querySelector(`#${prefix}-password`).value,
      role,
      displayName: name,
    });
    if (!joined?.ok) {
      statusOf(dialog).textContent = joinProblem(joined?.error);
      return;
    }
    dialog.close();
    rememberChat(joined.chat);
    await connectLive({
      id: joined.room_id,
      code: form.querySelector(`#${prefix}-code`).value.trim().toUpperCase(),
      role: joined.role || role,
      slot: joined.slot,
      name,
    });
  };

  joinButton.addEventListener("click", () => {
    if (unavailable) {
      statusOf(menu).textContent = "Online unavailable";
      menu.showModal();
      return;
    }
    menu.close();
    joinDialog.showModal();
  });
  joinSubmit.addEventListener("click", (event) => {
    event.preventDefault();
    enter(joinForm, "player");
  });
  watchSubmit.addEventListener("click", (event) => {
    event.preventDefault();
    enter(watchForm, "spectator");
  });
  browseButton.addEventListener("click", async () => {
    if (unavailable) {
      statusOf(menu).textContent = "Online unavailable";
      return;
    }
    paintBrowse(await listPublicRooms());
  });
  watchButton.addEventListener("click", () => {
    if (unavailable) {
      statusOf(menu).textContent = "Online unavailable";
      return;
    }
    menu.close();
    watchDialog.showModal();
  });
  boardButton.addEventListener("click", async () => {
    if (unavailable) {
      statusOf(menu).textContent = "Online unavailable";
      return;
    }
    const supabase = await getSupabase();
    const session = supabase ? await supabase.auth.getSession() : null;
    showBoard(await loadScores(session?.data?.session?.user?.id));
  });
  createButton.addEventListener("click", async (event) => {
    event.preventDefault();
    const name = hostForm.querySelector("#host-name").value;
    const problem = displayNameError(name);
    if (problem) {
      statusOf(hostDialog).textContent = problem === "filtered" ? "That name is not allowed." : "Use 3–16 letters.";
      return;
    }
    if (unavailable) {
      statusOf(hostDialog).textContent = "Online unavailable";
      return;
    }
    const created = await hostRoom({
      displayName: name,
      password: hostForm.querySelector("#host-password").value,
      isPublic: hostForm.querySelector("#host-public").checked,
      maxPlayers: Number(hostForm.querySelector("#host-max").value),
      turnTimer: Number(hostForm.querySelector("#host-timer").value),
    });
    if (!created.ok) {
      statusOf(hostDialog).textContent = created.error === "unavailable" ? "Online unavailable" : "Could not create the room.";
      return;
    }
    hostDialog.close();
    await connectLive({
      id: created.room_id,
      code: created.join_code,
      role: "host",
      slot: 0,
      name,
    });
  });

  const preview = (kind) => {
    if (kind === "lobby") {
      showLobby([
        { name: "Ada", role: "host", ready: true, ping: 22 },
        { name: "Bea", role: "player", ready: true, ping: 140 },
        { name: "Cid", role: "spectator", ready: false, ping: 180 },
      ]);
    }
    if (kind === "chat") {
      chat.hidden = false;
      chatLog.setChannel("party");
      chatLog.history([
        { channel: "party", name: "Bea", body: "Follow me", userId: "bea" },
        { channel: "party", name: "Ada", body: "Wait", userId: "ada" },
      ]);
      renderChat();
    }
    if (kind === "leaderboard") {
      showBoard([
        { name: "Ada", score: 4820, verified: true, yours: true },
        { name: "Bea", score: 3510, verified: true },
      ]);
    }
    if (kind === "spectator") {
      watch = createSpectatorView([
        { name: "Ada", role: "player", dungeon: 1 },
        { name: "Bea", role: "player", dungeon: 1 },
        { name: "Cid", role: "spectator", dungeon: 1 },
      ]);
      spectating = true;
      const badge = document.createElement("div");
      badge.id = "spectator-badge";
      badge.textContent = watch.badge(3);
      root.append(badge);
      chat.hidden = false;
      chatLog.setChannel("spectators");
      chatLog.history([{ channel: "spectators", name: "Cid", body: "The stairs are east.", userId: "cid" }]);
      renderChat();
    }
    if (kind === "menu") menu.showModal();
  };

  document.getElementById("multiplayer")?.addEventListener("click", () => {
    menu.showModal();
  });

  const noteConnection = (since, now = Date.now()) => {
    overlay.hidden = !showReconnecting(since, now);
  };

  const considerHost = async (members, now, roomId, selfId) => {
    const heir = chooseHeir(members, now);
    if (!heir || heir.userId !== selfId) return null;
    const claimed = await claimAbandonedHost(roomId);
    if (!claimed.ok) return claimed;
    toast.hidden = false;
    toast.textContent = "You are the host now.";
    return claimed;
  };

  const refreshBadge = () => {
    const badge = root.querySelector("#spectator-badge");
    if (badge && watch) badge.textContent = watch.badge(root.querySelectorAll("#spectator-badge").length ? 3 : 0);
  };

  return {
    preview,
    showChat: () => { chat.hidden = false; },
    noteConnection,
    considerHost,
    paintBrowse,
    enterRoom,
    beginRun,
    markReady,
    spectating: () => spectating,
    cycleFollow: () => {
      const who = watch?.next();
      refreshBadge();
      return who;
    },
    follow: (name) => {
      const who = watch?.follow(name);
      refreshBadge();
      return who;
    },
    followed: () => watch?.followed() ?? null,
    fogMask: () => {
      if (!spectating) return null;
      const who = watch?.followed();
      if (!who) return null;
      const cells = knowFor(who.name);
      if (!cells) return null;
      return new Set(cells);
    },
    hostBeat: () => live?.beat?.() || [],
    inMatch: () => !!live?.started?.(),
    sendInput: (input) => live?.sendInput?.(input),
    requestAura: (on) => {
      if (spectating) return;
      if (live?.started?.()) {
        live.sendInput(on ? "aura:on" : "aura:off");
        return;
      }
      window.ularn?.setAura?.(!!on, { role: "host" });
    },
    acceptsInput: () => !spectating,
    blocksGameKeys: () => chatLog.blocksGameKeys(),
    mapPings: () => chatLog.pings(),
    dropPing: (point) => {
      chatLog.ping(point);
    },
  };
};

const button = (label) => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "secondary";
  element.textContent = label;
  return element;
};

const field = (label, id, value) => {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const input = document.createElement("input");
  input.id = id;
  input.value = value;
  wrap.append(input);
  return wrap;
};
