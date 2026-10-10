import { mountIcons } from "../icons.js";
import { displayNameError } from "./words.js";
import { getSupabase, readOnlineEnv } from "./config.js";
import { formatBrowseRoom } from "./reliability.js";
import { createSpectatorView } from "./spectator.js";
import { mapChatRows } from "./chat.js";
import { mountChatPanel } from "./chat-ui.js";
import { publicBoard } from "../../supabase/functions/_shared/submit.js";
import { sendChatMessage } from "./rooms.js";
import { beginRun, enterRoom, hostRoom, listPublicRooms, markReady, resumeRoom, leaveRoom, kickMember, transferHost } from "./rooms.js";
import { formatEndScreenBoard } from "./end-board.js";
import { createLiveRoom, fetchPublicScores, loadScores } from "./live.js";

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
const ROOM_SESSION_KEY = "ularn.online.room.v2";
const selectedCharacter = () => document.querySelector('.class-choice[aria-pressed="true"]')?.textContent?.trim() || "Adventurer";

const withPending = async (dialog, action, label, message, work) => {
  if (dialog.getAttribute("aria-busy") === "true") return;
  const controls = [...dialog.querySelectorAll("button, input, select")];
  const disabled = controls.map((control) => control.disabled);
  const original = action.textContent;
  dialog.setAttribute("aria-busy", "true");
  controls.forEach((control) => { control.disabled = true; });
  action.textContent = label;
  statusOf(dialog).textContent = message;
  try {
    await work();
  } catch {
    statusOf(dialog).textContent = "Connection failed. Please try again.";
  } finally {
    dialog.removeAttribute("aria-busy");
    controls.forEach((control, index) => { control.disabled = disabled[index]; });
    action.textContent = original;
  }
};

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
    characterField("join-character"),
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
    characterField("host-character"),
    field("Password (optional)", "host-password", ""),
    field("Max players (2–4)", "host-max", "4"),
  );
  const publicLabel = document.createElement("label");
  publicLabel.innerHTML = `<input id="host-public" type="checkbox" checked /> Public room`;
  const createButton = button("Create lobby");
  hostForm.append(publicLabel, createButton);

  const lobby = panel("Lobby", document.createElement("div"));
  for (const dialog of [hostDialog, joinDialog, watchDialog]) {
    dialog.addEventListener("cancel", (event) => {
      if (dialog.getAttribute("aria-busy") === "true") event.preventDefault();
    });
  }
  const overlay = document.createElement("div");
  overlay.id = "reconnect-overlay";
  overlay.hidden = true;
  overlay.textContent = "Reconnecting…";
  overlay.setAttribute("role", "status");
  const toast = document.createElement("div");
  toast.id = "host-toast";
  toast.hidden = true;
  root.append(overlay, toast);
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
  let connecting = false;
  let leaving = false;
  const knowFor = (name) => (typeof window.ularn?.fog === "function" ? window.ularn.fog(name) : null);
  const chat = mountChatPanel({
    root,
    persist: (message) => (roomId ? sendChatMessage(roomId, message.channel, message.body) : null),
  });
  const roomButton = button("Room");
  roomButton.id = "room-menu";
  roomButton.hidden = true;
  const roomExit = button("Leave room");
  roomExit.id = "room-exit";
  roomExit.hidden = true;
  roomExit.title = "Leave multiplayer and return to title";
  const nav = document.querySelector(".topbar nav");
  nav?.prepend(roomButton);
  nav?.append(roomExit);
  const leave = async () => {
    if (leaving) return;
    leaving = true;
    const id = roomId;
    // Stop all room work before the exit request, including a pending heartbeat.
    const stopped = live?.close();
    localStorage.removeItem(ROOM_SESSION_KEY);
    roomButton.disabled = true;
    for (const action of [roomExit, document.getElementById("room-leave"), document.getElementById("save-exit")]) {
      if (!action) continue;
      action.disabled = true;
      action.textContent = "Leaving…";
    }
    lobby.setAttribute("aria-busy", "true");
    lobby.querySelectorAll("button").forEach(action => { action.disabled = true; });
    statusOf(lobby).textContent = "Leaving the room and returning to title…";
    const pauseStatus = document.getElementById("pause-status");
    if (pauseStatus) pauseStatus.textContent = "Leaving the room and returning to title…";
    overlay.hidden = false;
    overlay.textContent = "Leaving room…";
    let timeout;
    try {
      // An unavailable service must not trap someone in multiplayer.
      await Promise.race([
        (async () => { await stopped; if (id && navigator.onLine) await leaveRoom(id); })(),
        new Promise(resolve => { timeout = setTimeout(resolve, 2500); }),
      ]);
    } catch {
      // The server also releases disconnected members when heartbeats stop.
    } finally {
      clearTimeout(timeout);
      history.replaceState(null, "", location.pathname);
      location.reload();
    }
  };
  roomExit.addEventListener("click", leave);
  const showNotice = (reason) => {
    localStorage.removeItem(ROOM_SESSION_KEY);
    sessionStorage.setItem("ularn.room.notice", reason === "not_member" ? "You were removed from the room." : reason === "expired" ? "Your previous place expired. Join with the room code to start a new character." : "That room has closed.");
    location.reload();
  };
  const updateWatch = () => {
    if (!started) return;
    const party = window.ularn?.party?.() || [];
    const own = party.find(person => person.slot === selfSlot);
    const wasWatching = spectating;
    spectating = selfRole === "spectator" || !!(own && !own.alive);
    if (!spectating) {
      document.getElementById("spectator-badge")?.remove();
      if (wasWatching) live?.follow(selfSlot);
      return;
    }
    const roster = roomMembers.filter(member => !member.banned && member.connected !== false).map(member => ({ ...member, ...party.find(person => person.slot === member.slot), role: member.role }));
    if (!watch) watch = createSpectatorView(roster);
    else watch.setRoster(roster);
    let badge = document.getElementById("spectator-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "spectator-badge";
      root.append(badge);
    }
    badge.textContent = watch.badge();
    if (!wasWatching) {
      const target = watch.followed();
      if (target) live?.follow(target.slot);
    }
  };
  window.addEventListener("ularn:update", updateWatch);

  const paintBrowse = (rooms) => {
    const body = menu.querySelector(".online-body");
    const existing = body.querySelector(".board-list");
    existing?.remove();
    const list = document.createElement("ul");
    list.className = "board-list";
    for (const room of rooms) {
      const item = document.createElement("li");
      item.textContent = formatBrowseRoom(room).label;
      const join = button("Join");
      const watch = button("Watch");
      join.addEventListener("click", () => { joinButton.click(); joinForm.querySelector("#join-code").value = room.join_code; });
      watch.addEventListener("click", () => { watchButton.click(); watchForm.querySelector("#watch-code").value = room.join_code; });
      item.append(join, watch);
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
  let lobbyAction = null;
  let lobbyProblem = "";
  let lobbyCode = "";
  const showLobby = (members, codeText = "K7MQ2P", open = !started) => {
    if (leaving) return;
    lobbyCode = codeText;
    const mine = members.find((member) => member.userId === selfId);
    const isReady = mine?.ready ?? live?.ready?.() ?? false;
    const stamp = `${codeText}|${started}|${isReady}|${selfRole}|${lobbyAction}|${lobbyProblem}|${members.map((member) => `${member.userId || member.name}:${member.name}:${member.ready}:${member.connected}:${member.role}:${member.banned}`).join(",")}`;
    if (stamp === lobbyStamp && lobby.open) return;
    lobbyStamp = stamp;
    const body = lobby.querySelector(".online-body");
    lobby.querySelector("h2").textContent = started ? "Room" : "Lobby";
    body.replaceChildren();
    const code = document.createElement("p");
    code.className = "room-code";
    const strong = document.createElement("strong");
    strong.textContent = codeText;
    code.append("Code ", strong);
    const copy = button("Copy invite link");
    copy.id = "room-copy";
    copy.addEventListener("click", async () => {
      const invite = new URL("/play/", location.origin);
      invite.searchParams.set("room", codeText);
      try { await navigator.clipboard.writeText(invite.href); copy.textContent = "Invite link copied ✓"; }
      catch { statusOf(lobby).textContent = `Share this room code: ${codeText}`; }
    });
    const town = document.createElement("p");
    town.textContent = started ? "Everyone controls their own adventurer. Friends can join this expedition with the code." : "Each player selects Ready to play. Then the host starts the expedition.";
    const list = document.createElement("ul");
    list.className = "lobby-members";
    for (const member of members.filter(member => !member.banned)) {
      const item = document.createElement("li");
      const state = member.connected === false ? "disconnected" : member.role === "spectator" ? "watching" : started ? member.character || "playing" : member.ready ? "ready" : "not ready";
      item.textContent = `${member.name}${member.userId === selfId ? " (you)" : ""} · ${member.role} · ${state}${member.ping != null ? ` · ${member.ping} ms` : ""}`;
      if (selfRole === "host" && member.userId && member.userId !== selfId) {
        const remove = button("Remove");
        remove.setAttribute("aria-label", `Remove ${member.name} from room`);
        remove.addEventListener("click", async () => { remove.disabled = true; const result = await kickMember(roomId, member.userId); if (result.ok) await live.refresh(); else { remove.disabled = false; statusOf(lobby).textContent = "Could not remove this member. Please try again."; } });
        item.append(remove);
        if (member.role === "player" && member.connected) {
          const host = button("Make host");
          host.setAttribute("aria-label", `Make ${member.name} the host`);
          host.addEventListener("click", async () => { host.disabled = true; const result = await transferHost(roomId, member.userId); if (result.ok) await live.refresh(); else { host.disabled = false; statusOf(lobby).textContent = "Could not change the host. Please try again."; } });
          item.append(host);
        }
      }
      list.append(item);
    }
    const ready = button(lobbyAction === "ready" ? "Updating readiness…" : isReady ? "Ready ✓ · Cancel ready" : "Ready to play");
    ready.id = "lobby-ready";
    ready.setAttribute("aria-pressed", String(isReady));
    ready.classList.toggle("primary", !isReady);
    ready.disabled = !!lobbyAction;
    const start = button(lobbyAction === "start" ? "Starting expedition…" : "Start expedition");
    start.id = "lobby-start";
    const players = members.filter((member) => member.connected !== false && member.role !== "spectator" && !member.banned);
    const allReady = players.length >= 2 && players.every((member) => member.ready);
    start.hidden = started || selfRole !== "host";
    start.disabled = !allReady || !!lobbyAction;
    start.classList.toggle("primary", allReady);
    ready.hidden = started || selfRole === "spectator";
    lobby.setAttribute("aria-busy", String(!!lobbyAction));
    const act = async (kind, work) => {
      if (lobbyAction) return;
      lobbyAction = kind;
      lobbyProblem = "";
      showLobby(roomMembers, lobbyCode);
      try {
        const result = await work();
        if (!result?.ok) lobbyProblem = ({ not_host: "The host starts the expedition.", not_ready: "Everyone must be ready before starting.", need_players: "Invite another player before starting.", rate_limited: "Please wait a moment and try again." })[result?.error] || "Connection failed. Please try again.";
      } catch {
        lobbyProblem = "Connection failed. Please try again.";
      } finally {
        lobbyAction = null;
        showLobby(roomMembers, lobbyCode);
      }
    };
    ready.addEventListener("click", async () => {
      if (!live) {
        ready.setAttribute("aria-pressed", "true");
        ready.textContent = "Ready";
        return;
      }
      await act("ready", () => live.toggleReady());
    });
    start.addEventListener("click", async () => {
      if (!live) {
        statusOf(lobby).textContent = "Starting when everyone is ready.";
        return;
      }
      await act("start", () => live.start());
    });
    const exit = button("Leave room");
    exit.id = "room-leave";
    exit.addEventListener("click", leave);
    const exitHelp = document.createElement("small");
    exitHelp.className = "room-exit-help";
    exitHelp.textContent = selfRole === "host"
      ? players.some(member => member.userId !== selfId)
        ? "Return to title. Another player takes over as host."
        : "Return to title. The room closes when no players remain."
      : "Return to title. The others can stay in the room.";
    body.append(code, copy, town, list, ready, start, exit, exitHelp);
    const waiting = players.filter((member) => !member.ready && member.userId !== selfId).map((member) => member.name);
    statusOf(lobby).textContent = lobbyProblem || (started ? "Room progress syncs automatically. A disconnected place is held for 2 minutes." : lobbyAction === "start"
      ? "Starting the expedition for everyone…"
      : lobbyAction === "ready"
        ? "Updating your ready status…"
        : selfRole === "spectator"
      ? "You are watching. You cannot take a turn."
      : !isReady
        ? "Select Ready to play when you are ready."
        : players.length < 2
          ? "You are ready. Share the code with another player to join."
          : allReady
            ? selfRole === "host" ? "Everyone is ready. Select Start expedition." : "Everyone is ready. Waiting for the host to start."
            : `You are ready. Waiting for ${waiting.join(", ")} to get ready.`);
    if (open && !connecting && !lobby.open) lobby.showModal();
  };
  roomButton.addEventListener("click", () => { lobbyStamp = ""; showLobby(roomMembers, lobbyCode, true); });

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
    if (result?.pending) { scoreBanner.hidden = false; scoreBanner.textContent = "Expedition ended. Checking the party’s score…"; return; }
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
    if (replace && Array.isArray(payload)) chat.history(mapChatRows(payload));
    else if (payload && !Array.isArray(payload)) chat.receive(mapChatRows([payload])[0]);
  };

  const connectLive = async ({ id, code, role, slot, name }) => {
    roomId = id;
    displayName = name;
    selfRole = role || "player";
    selfSlot = Number.isInteger(slot) ? slot : 0;
    spectating = selfRole === "spectator";
    started = false;
    lobbyProblem = "";
    lobbyAction = null;
    lobbyStamp = "";
    const supabase = await getSupabase();
    const session = supabase ? await supabase.auth.getSession() : null;
    selfId = session?.data?.session?.user?.id || null;
    if (!selfId) {
      return { ok: false, error: "unavailable" };
    }
    chat.setIdentity({ name: displayName, userId: selfId, role: selfRole });
    live?.close();
    live = createLiveRoom({
      self: { userId: selfId, role: selfRole, slot: selfSlot, name: displayName },
      roomId,
      onRoster: (members, room) => {
        roomMembers = members;
        const mine = members.find((member) => member.userId === selfId);
        if (mine?.role) selfRole = mine.role;
        chat.setRole(selfRole, !!room?.hide_spectator_chat);
        document.body.classList.add("in-room");
        roomButton.hidden = false;
        roomExit.hidden = false;
        roomButton.replaceChildren("Room");
        const roomCode = document.createElement("span");
        roomCode.className = "room-menu-code";
        roomCode.textContent = ` · ${room?.join_code || code}`;
        roomButton.append(roomCode);
        updateWatch();
        showLobby(members, room?.join_code || code, false);
      },
      onChat: (payload, replace) => ingestChat(payload, replace),
      onStatus: (text) => {
        if (leaving) return;
        overlay.hidden = !text;
        overlay.textContent = text;
      },
      onStarted: () => {
        started = true;
        for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
        const welcome = document.getElementById("welcome");
        const hud = document.getElementById("hud");
        const pause = document.getElementById("pause");
        if (welcome) welcome.hidden = true;
        if (hud) hud.hidden = false;
        if (pause) pause.hidden = false;
        document.body.classList.add("playing");
        showLobby(roomMembers, code, false);
        updateWatch();
        document.getElementById("save-exit").textContent = "Leave room";
        const pauseDialog = document.getElementById("pause-dialog");
        if (pauseDialog) {
          pauseDialog.querySelector("h2").textContent = "Multiplayer room";
          pauseDialog.querySelector("p").textContent = "Your party can keep playing while this menu is open. Leave room to return to title.";
        }
        const save = document.getElementById("save");
        if (save) { save.disabled = true; save.title = "Room progress syncs automatically."; }
        chat.open();
        window.ularnGraphics?.beginExpeditionCamera?.();
        window.dispatchEvent(new Event("ularn:update"));
      },
      onScore: (result) => showScore(result),
      onClaimed: () => {
        selfRole = "host";
        chat.setRole("host");
        toast.hidden = false;
        toast.textContent = "You are the host now.";
      },
      onEnded: showNotice,
    });
    let opened;
    connecting = true;
    try {
      opened = await live.open();
    } catch {
      opened = { ok: false, error: "unavailable" };
    }
    connecting = false;
    if (!opened?.ok) {
      live.close();
      live = null;
      lobby.close();
      return opened;
    }
    showLobby(roomMembers, code, !started);
    try { localStorage.setItem(ROOM_SESSION_KEY, JSON.stringify({ id, code, name })); } catch {}
    chat.open();
    return opened;
  };

  hostButton.addEventListener("click", () => {
    menu.close();
    hostForm.querySelector("#host-character").value = selectedCharacter();
    hostDialog.showModal();
  });
  const rememberChat = (rows) => {
    chat.history(mapChatRows(rows));
    chat.open();
  };

  const joinProblem = (error) => {
    if (error === "unavailable" || error === "unauthenticated") return "Online unavailable";
    if (error === "room_not_found") return "That code does not match a room.";
    if (error === "bad_password") return "That password is wrong.";
    if (error === "room_full") return "That room is already full.";
    if (error === "run_over") return "That expedition has ended. Ask the host for a new room, or join as a spectator.";
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
    const submit = role === "spectator" ? watchSubmit : joinSubmit;
    await withPending(dialog, submit, "Joining room…", "Joining the room…", async () => {
      const joined = await enterRoom({
        code: form.querySelector(`#${prefix}-code`).value,
        password: form.querySelector(`#${prefix}-password`).value,
        role,
        displayName: name,
        character: form.querySelector(`#${prefix}-character`)?.value || selectedCharacter(),
      });
      if (!joined?.ok) {
        statusOf(dialog).textContent = joinProblem(joined?.error);
        return;
      }
      submit.textContent = "Connecting…";
      statusOf(dialog).textContent = "Joined the room. Connecting to the lobby…";
      const opened = await connectLive({
        id: joined.room_id,
        code: form.querySelector(`#${prefix}-code`).value.trim().toUpperCase(),
        role: joined.role || role,
        slot: joined.slot,
        name,
      });
      if (!opened?.ok) {
        statusOf(dialog).textContent = opened?.error === "old_room" ? "This room uses an older game version. Ask the host to create a new room." : "Could not connect to the lobby. Please try again.";
        return;
      }
      dialog.close();
      rememberChat(joined.chat);
    });
  };

  joinButton.addEventListener("click", () => {
    if (unavailable) {
      statusOf(menu).textContent = "Online unavailable";
      menu.showModal();
      return;
    }
    menu.close();
    joinForm.querySelector("#join-character").value = selectedCharacter();
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
  let hostedRoom = null;
  createButton.addEventListener("click", async (event) => {
    event.preventDefault();
    if (hostDialog.getAttribute("aria-busy") === "true") return;
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
    const max = Number(hostForm.querySelector("#host-max").value);
    if (!Number.isInteger(max) || max < 2 || max > 4) { statusOf(hostDialog).textContent = "Choose between 2 and 4 players."; return; }
    await withPending(hostDialog, createButton, hostedRoom ? "Connecting…" : "Creating room…", hostedRoom ? "Connecting to your lobby…" : "Creating your room. This may take a few seconds…", async () => {
      if (!hostedRoom) {
        const created = await hostRoom({
          displayName: name,
          password: hostForm.querySelector("#host-password").value,
          isPublic: hostForm.querySelector("#host-public").checked,
          maxPlayers: Number(hostForm.querySelector("#host-max").value),
          turnTimer: 0,
          character: hostForm.querySelector("#host-character").value,
        });
        if (!created?.ok) {
          statusOf(hostDialog).textContent = created?.error === "unavailable" ? "Online unavailable. Please try again." : "Could not create the room. Please try again.";
          return;
        }
        hostedRoom = { ...created, name };
      }
      createButton.textContent = "Connecting…";
      statusOf(hostDialog).textContent = "Room created. Connecting to the lobby…";
      const opened = await connectLive({
        id: hostedRoom.room_id,
        code: hostedRoom.join_code,
        role: "host",
        slot: 0,
        name: hostedRoom.name,
      });
      if (!opened?.ok) {
        statusOf(hostDialog).textContent = "Room created, but the connection failed. Select Retry connection.";
        return;
      }
      hostedRoom = null;
      hostDialog.close();
    });
    createButton.textContent = hostedRoom ? "Retry connection" : "Create lobby";
    hostForm.querySelectorAll("input, select").forEach((input) => { input.disabled = !!hostedRoom; });
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
      chat.open();
      chat.setRole("player");
      chat.history([
        { channel: "party", name: "Bea", body: "Follow me", userId: "bea" },
        { channel: "party", name: "Ada", body: "Wait", userId: "ada" },
      ]);
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
      document.getElementById("spectator-badge")?.remove();
      const badge = document.createElement("div");
      badge.id = "spectator-badge";
      badge.textContent = watch.badge();
      badge.title = watch.badge();
      const nav = document.querySelector(".topbar nav");
      if (nav) nav.prepend(badge);
      else root.append(badge);
      chat.open();
      chat.setRole("spectator");
      chat.history([{ channel: "spectators", name: "Cid", body: "The stairs are east.", userId: "cid" }]);
    }
    if (kind === "menu") menu.showModal();
  };

  document.getElementById("multiplayer")?.addEventListener("click", () => {
    if (live) { lobbyStamp = ""; showLobby(roomMembers, lobbyCode, true); return; }
    menu.showModal();
  });

  const refreshBadge = () => {
    const badge = document.getElementById("spectator-badge");
    if (badge && watch) {
      badge.textContent = watch.badge();
      badge.title = watch.badge();
    }
  };
  const reconnect = button("Reconnect to your room");
  reconnect.hidden = true;
  menuBody.prepend(reconnect);
  const restore = async () => {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(ROOM_SESSION_KEY)); } catch {}
    if (!saved?.id || live) return;
    if (!menu.open) menu.showModal();
    await withPending(menu, reconnect, "Reconnecting…", "Restoring your room and character…", async () => {
      const resumed = await resumeRoom(saved.id);
      if (!resumed?.ok) {
        if (resumed?.error === "unavailable") {
          reconnect.hidden = false;
          statusOf(menu).textContent = "Could not reconnect. Please try again.";
        } else {
          localStorage.removeItem(ROOM_SESSION_KEY);
          statusOf(menu).textContent = resumed?.error === "expired" ? "Your previous place expired. Join with the code to start a new character." : "Your previous room is no longer available.";
        }
        return;
      }
      const opened = await connectLive({ id: saved.id, code: resumed.join_code, role: resumed.role, slot: resumed.slot, name: saved.name });
      if (opened.ok) { reconnect.hidden = true; menu.close(); }
      else { reconnect.hidden = false; statusOf(menu).textContent = "Could not reconnect. Please try again."; }
    });
  };
  reconnect.addEventListener("click", restore);
  setTimeout(() => {
    const notice = sessionStorage.getItem("ularn.room.notice");
    if (notice) { sessionStorage.removeItem("ularn.room.notice"); statusOf(menu).textContent = notice; menu.showModal(); }
    else if (localStorage.getItem(ROOM_SESSION_KEY)) restore();
    else {
      const invited = new URL(location.href).searchParams.get("room")?.toUpperCase();
      if (/^[A-Z2-9]{6}$/.test(invited || "")) { joinForm.querySelector("#join-code").value = invited; joinDialog.showModal(); }
    }
  }, 0);

  return {
    preview,
    showChat: () => { chat.open(); },
    paintBrowse,
    enterRoom,
    beginRun,
    markReady,
    spectating: () => spectating,
    cycleFollow: () => {
      const who = watch?.next();
      if (who) live?.follow(who.slot);
      refreshBadge();
      return who;
    },
    follow: (name) => {
      if (!spectating) return null;
      const who = watch?.follow(name);
      if (who) live?.follow(who.slot);
      refreshBadge();
      return who;
    },
    followMember: (slot) => {
      if (!spectating) return null;
      const who = watch?.followSlot(slot);
      if (who) live?.follow(who.slot);
      refreshBadge();
      return who;
    },
    followed: () => watch?.followed() ?? null,
    fogMask: () => {
      if (!spectating) return null;
      const who = watch?.followed();
      if (!who) return null;
      const cells = live ? window.ularn?.fogActor?.(who.slot) : knowFor(who.name);
      if (!cells) return null;
      return new Set(cells);
    },
    inRoom: () => !!live,
    openRoom: () => { lobbyStamp = ""; showLobby(roomMembers, lobbyCode, true); },
    leave,
    diagnostics: () => live?.diagnostics(),
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
    acceptsInput: () => live?.started() ? live.canAct() : !spectating,
    blocksGameKeys: () => chat.blocksGameKeys(),
    mapPings: () => chat.pings(),
    dropPing: (point) => {
      chat.ping(point);
    },
    loadPublicBoard: async (gameName) => {
      try {
        return formatEndScreenBoard(await fetchPublicScores(), gameName || "Ularn");
      } catch {
        return formatEndScreenBoard({ ok: false }, gameName || "Ularn");
      }
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
  if (id.endsWith("-password")) { input.type = "password"; input.maxLength = 64; }
  if (id.endsWith("-name")) { input.maxLength = 16; input.autocomplete = "nickname"; }
  if (id.endsWith("-max")) { input.type = "number"; input.min = "2"; input.max = "4"; input.step = "1"; }
  if (id.endsWith("-code")) {
    input.maxLength = 6;
    input.autocapitalize = "characters";
    input.addEventListener("input", () => { input.value = input.value.toUpperCase(); });
    input.addEventListener("paste", event => {
      let text = event.clipboardData.getData("text").trim();
      try { text = new URL(text).searchParams.get("room") || text; } catch {}
      if (/^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}$/i.test(text)) { event.preventDefault(); input.value = text.toUpperCase(); }
    });
  }
  wrap.append(input);
  return wrap;
};

const characterField = id => {
  const label = document.createElement("label");
  label.textContent = "Calling";
  const select = document.createElement("select");
  select.id = id;
  for (const name of ["Adventurer", "Wizard", "Rogue", "Elf", "Dwarf", "Ogre", "Klingon", "Rambo"]) {
    const option = document.createElement("option");
    option.value = name; option.textContent = name; select.append(option);
  }
  label.append(select);
  return label;
};
