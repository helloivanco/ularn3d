/**
 * The 20×10 aura is multiplayer only. Solo uses level-wide monster turns.
 * The host's on/off state is what players and spectators draw.
 *
 * Run: node --test tests/aura-toggle.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bootEngine } from "./lib/engine-session.mjs";
import { auraControl, tileInAura } from "../src/cooperation-aura.js";
import { createHostSession, createReplica } from "../src/online/protocol.js";

const place = (api, x, y, id) => {
  const monster = api.createMonster(13);
  monster.id = id;
  monster.moved = false;
  monster.awake = true;
  api.setMonster(x, y, monster);
  return monster;
};

const idsMoved = (api, monsters) => monsters.filter((monster) => monster.moved).map((monster) => monster.id);

test("solo has no aura control and a monster outside the ellipse still acts", () => {
  const api = bootEngine({ seed: 2, name: "Ada" });
  api.newcavelevel(1);
  api.player.x = 10;
  api.player.y = 8;
  for (let x = 0; x < api.MAXX; x++) {
    for (let y = 0; y < api.MAXY; y++) api.setMonster(x, y, null);
  }
  const here = place(api, 11, 8, "here");
  const away = place(api, 40, 8, "away");
  const bystander = place(api, 50, 8, "bystander");
  assert.equal(tileInAura(10, 8, 40, 8), false);
  assert.equal(api.partySize(), 1);
  assert.equal(api.cooperationAuraOn(), false);
  const state = api.captureGameState();
  assert.equal(auraControl(state).control, false);
  assert.equal(auraControl(state).overlay, false);
  assert.equal(auraControl({ ...state, aura: true }).overlay, false);
  api.lasthx = 40;
  api.lasthy = 8;
  api.movemonst();
  assert.equal(here.moved, true);
  assert.equal(away.moved, true);
  assert.equal(bystander.moved, false);
});

test("multiplayer defaults the aura on, and off skips monster turns without scanning the level", () => {
  const api = bootEngine({ seed: 2, name: "Ada" });
  api.newcavelevel(1);
  api.enablePartyOfOne();
  api.addAdventurer("Bea");
  api.activateAdventurer(0);
  api.level = 1;
  api.player.x = 10;
  api.player.y = 8;
  for (let x = 0; x < api.MAXX; x++) {
    for (let y = 0; y < api.MAXY; y++) api.setMonster(x, y, null);
  }
  const here = place(api, 10, 8, "here");
  const away = place(api, 40, 8, "away");
  assert.equal(api.partySize() > 1, true);
  assert.equal(api.cooperationAuraOn(), true);
  let state = api.captureGameState();
  assert.deepEqual(auraControl(state), { control: true, overlay: true, label: "AURA: ON" });
  api.movemonst();
  assert.deepEqual(idsMoved(api, [here, away]), ["here"]);

  here.moved = false;
  away.moved = false;
  const refused = api.hostSetCooperationAura(false, { role: "spectator" });
  assert.equal(refused.ok, false);
  assert.equal(api.cooperationAuraOn(), true);

  const off = api.hostSetCooperationAura(false, { role: "player" });
  assert.equal(off.ok, true);
  state = api.captureGameState();
  assert.deepEqual(auraControl(state), { control: true, overlay: false, label: "AURA: OFF" });
  assert.equal(auraControl({ ...state, aura: true }).label, "AURA: ON");
  assert.equal(auraControl(state).overlay, false);
  api.movemonst();
  assert.deepEqual(idsMoved(api, [here, away]), []);

  api.disbandParty();
  assert.equal(api.partySize(), 1);
  assert.equal(api.cooperationAuraOn(), false);
  state = api.captureGameState();
  assert.equal(auraControl(state).control, false);
  assert.equal(auraControl(state).overlay, false);
  here.moved = false;
  away.moved = false;
  api.lasthx = 40;
  api.lasthy = 8;
  api.movemonst();
  assert.equal(here.moved, true);
  assert.equal(away.moved, true);
  api.enablePartyOfOne();
  api.addAdventurer("Bea");
  assert.equal(api.cooperationAuraOn(), true);
});

test("the host broadcast keeps a player and a spectator on the same aura state", () => {
  const api = bootEngine({ seed: 2, name: "Ada" });
  api.newcavelevel(1);
  api.enablePartyOfOne();
  api.addAdventurer("Bea");
  const session = createHostSession({
    userId: "ada",
    applyInput: (input, from) => {
      if (input === "aura:on" || input === "aura:off") api.hostSetCooperationAura(input === "aura:on", from);
    },
    capture: () => api.captureGameState(),
    diff: (before, after) => api.diffState(before, after),
    checksum: (state) => api.checksumGameState(state),
  });
  const player = createReplica({
    checksum: (state) => api.checksumGameState(state),
    apply: (base, diff) => api.applyDiff(base, diff),
  });
  const spectator = createReplica({
    checksum: (state) => api.checksumGameState(state),
    apply: (base, diff) => api.applyDiff(base, diff),
  });
  session.snapshot();
  const [full] = session.takeOutbound();
  player.receive(full.event, full.payload);
  spectator.receive(full.event, full.payload);
  assert.equal(auraControl(player.state()).label, "AURA: ON");
  assert.equal(auraControl(spectator.state()).label, "AURA: ON");

  session.receive({ userId: "bea", role: "player" }, "action", { seq: 1, input: "aura:off" });
  const turned = session.takeOutbound().filter((message) => message.event === "state");
  for (const message of turned) {
    player.receive(message.event, message.payload);
    spectator.receive(message.event, message.payload);
  }
  assert.equal(player.state().aura, false);
  assert.equal(spectator.state().aura, false);
  assert.equal(auraControl(player.state()).label, auraControl(spectator.state()).label);
  assert.equal(auraControl(spectator.state()).overlay, false);

  session.receive({ userId: "cid", role: "spectator" }, "action", { seq: 1, input: "aura:on" });
  assert.equal(api.cooperationAuraOn(), false);
  assert.equal(auraControl(player.state()).label, "AURA: OFF");
});
