import test from 'node:test';
import assert from 'node:assert/strict';
import { bootEngine } from './lib/engine-session.mjs';

const people = [
  { slot: 0, name: 'Ada', character: 'Adventurer' },
  { slot: 1, name: 'Bea', character: 'Wizard' },
  { slot: 2, name: 'Cid', character: 'Rogue' },
  { slot: 3, name: 'Dee', character: 'Dwarf' },
];
const boot = (players = people) => {
  const engine = bootEngine({ seed: 2, name: players[0].name, character: players[0].character });
  engine.beginRoomParty(players);
  return engine;
};
const apply = (engine, actor, input) => engine.applyRoomAction({ kind: 'key', actor, input });

test('four players keep their own stats, positions and inventories', () => {
  const engine = boot();
  const before = engine.adventurerSummaries();
  assert.equal(before.length, 4);
  apply(engine, 0, 'right');
  for (let actor = 1; actor < 4; actor++) apply(engine, actor, '.');
  const after = engine.adventurerSummaries();
  assert.deepEqual(Array.from(after, member => member.name), ['Ada', 'Bea', 'Cid', 'Dee']);
  assert.equal(after[0].x, before[0].x + 1);
  assert.equal(after[1].x, before[1].x);
  assert.notEqual(engine.ADVENTURERS[0].player, engine.ADVENTURERS[1].player);
  assert.notEqual(engine.ADVENTURERS[0].player.inventory, engine.ADVENTURERS[1].player.inventory);
});

test('an unfinished action belongs to its player and leaving releases the prompt', () => {
  const engine = boot(people.slice(0, 2));
  apply(engine, 0, 'q');
  assert.equal(engine.ROOM_PROMPT_ACTOR, 0);
  const before = engine.adventurerSummaries()[1];
  assert.equal(apply(engine, 1, 'right'), false);
  assert.equal(engine.adventurerSummaries()[1].x, before.x);
  engine.applyRoomAction({ kind: 'leave', actor: 0 });
  assert.equal(engine.ROOM_PROMPT_ACTOR, null);
  assert.equal(apply(engine, 1, 'right'), true);
});

test('late joining and replacing an expired seat are replayable', () => {
  const left = boot(people.slice(0, 2)), right = boot(people.slice(0, 2));
  const rows = [
    { kind: 'key', actor: 0, input: 'right' },
    { kind: 'join', actor: 2, name: 'Cid', character_class: 'Rogue' },
    { kind: 'key', actor: 2, input: 'right' },
    { kind: 'leave', actor: 1 },
    { kind: 'join', actor: 1, name: 'Nova', character_class: 'Dwarf' },
    { kind: 'key', actor: 1, input: 'down' },
  ];
  for (const row of rows) { left.applyRoomAction(row); right.applyRoomAction(row); }
  assert.equal(left.checksumGameState(), right.checksumGameState());
  assert.equal(left.ADVENTURERS[1].name, 'Nova');
  assert.equal(left.partySize(), 3);
  assert.equal(left.ADVENTURERS[1].connected, true);
});

test('two engines follow the same 500 interleaved actions', () => {
  const left = boot(), right = boot();
  for (let turn = 0; turn < 500; turn++) {
    const actor = turn % 4;
    apply(left, actor, '.'); apply(right, actor, '.');
  }
  assert.equal(left.checksumGameState(), right.checksumGameState());
  assert.equal(left.adventurerSummaries().length, 4);
});

test('auto-loot is personal and removed players do not keep an expedition alive', () => {
  const engine = boot(people.slice(0, 2));
  apply(engine, 1, 'loot:on');
  assert.equal(engine.ROOM_AUTO_LOOT[1], true);
  assert.equal(engine.ROOM_AUTO_LOOT[0], false);
  apply(engine, 0, '@');
  assert.equal(engine.ROOM_AUTO_LOOT[0], true);
  engine.applyRoomAction({ kind: 'remove', actor: 0 });
  engine.applyRoomAction({ kind: 'remove', actor: 1 });
  assert.equal(engine.GAMEOVER, true);
});

test('the new room replay also works in the edge script sandbox', () => {
  const left = boot();
  const right = bootEngine({ seed: 2, name: people[0].name, character: people[0].character, context: 'script' });
  right.beginRoomParty(people);
  for (let turn = 0; turn < 40; turn++) {
    const row = { kind: 'key', actor: turn % 4, input: '.' };
    left.applyRoomAction(row); right.applyRoomAction(row);
  }
  assert.equal(left.checksumGameState(), right.checksumGameState());
});
