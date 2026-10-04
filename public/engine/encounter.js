"use strict";

/*
 * Encounter groups for co-op. Solo never calls these. Two auras overlap when
 * the distance between their centers is within two radii of the 20 by 10 ellipse.
 */

function aurasOverlap(a, b) {
  if (!a || !b || a.dungeon !== b.dungeon || a.slot === b.slot) return false;
  const left = auraCenter(a.x, a.y);
  const right = auraCenter(b.x, b.y);
  const dx = (left.x - right.x) / (AURA_WIDTH / 2);
  const dy = (left.y - right.y) / (AURA_HEIGHT / 2);
  return dx * dx + dy * dy <= 4;
}

function encounterGroups(list) {
  const people = (list || []).slice().sort((a, b) => a.slot - b.slot);
  const parent = people.map((_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor];
    parent[index] = cursor;
    return cursor;
  };
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      if (!aurasOverlap(people[i], people[j])) continue;
      const left = find(i);
      const right = find(j);
      if (left !== right) parent[left] = right;
    }
  }
  const grouped = new Map();
  for (let i = 0; i < people.length; i++) {
    const root = find(i);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(people[i]);
  }
  return [...grouped.values()];
}

var GROUP_TURN = {};

function groupKey(group) {
  return group.map((member) => member.slot).join(",");
}

function actorMayAct(slot, groups) {
  const found = (groups || []).find((group) => group.some((member) => member.slot === slot));
  if (!found || found.length < 2) return true;
  const cursor = GROUP_TURN[groupKey(found)] || 0;
  return found[cursor % found.length].slot === slot;
}

function noteActorMoved(slot, groups) {
  const found = (groups || []).find((group) => group.some((member) => member.slot === slot));
  if (!found || found.length < 2) return;
  const key = groupKey(found);
  const cursor = GROUP_TURN[key] || 0;
  if (found[cursor % found.length].slot !== slot) return;
  GROUP_TURN[key] = cursor + 1;
}

function timedAction(input, startedAt, now, timerSeconds) {
  if (!timerSeconds) return input;
  if (now - startedAt >= timerSeconds * 1000) return ".";
  return input;
}

function resetEncounterTurns() {
  GROUP_TURN = {};
}
