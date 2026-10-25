import test from "node:test";
import assert from "node:assert/strict";
import { lineKind, plainLine } from "../src/journal.js";

const expect = (kind, lines) => {
  for (const line of lines) assert.equal(lineKind(line), kind, line);
};

test("tags and entities strip to plain text", () => {
  assert.equal(plainLine("&nbsp;&nbsp;<b>The</b> <font color='red'>gnome</font> died!"), "The gnome died!");
  assert.equal(plainLine("Tom &amp; Jerry&#39;s"), "Tom & Jerry's");
  assert.equal(plainLine(null), "");
});

test("kills", () => expect("kill", [
  "  The gnome died!",
  "<b>The hobgoblin died!</b>",
  "&nbsp;&nbsp;The <font color='lightgrey'>red dragon</font> died!",
  "The troll is destroyed by the sphere of annihilation!",
  "The arrow hits and kills the jackal.",
  "  The Vorpal Blade beheads the ogre!",
]));

test("blows taken", () => expect("combat-in", [
  "  The hobgoblin hit you.",
  "  The kobold missed.",
  "The giant ant bit you!",
  "The snake bites you!",
  "The soldier ant stung you! You feel weaker.",
  "The leprechaun hit you -- your purse feels lighter.",
  "The red dragon breathes fire at you!",
  "The vampire drains you of your life energy!",
  "The orc misses wildly.",
  "<font color='red'>You have been slain!</font>",
]));

test("blows struck", () => expect("combat-out", [
  "You hit the gnome.",
  "<b>You missed the</b> monster.",
  "  Your lance of death tickles the demon prince",
]));

test("loot", () => expect("loot", [
  "You find a potion of healing. [<b>t</b> to take, <b>q</b> to quaff]",
  "You have found 250 gold pieces.",
  "You find some gold!",
  "  You pick up:",
  "You have found a staircase down. [<b>></b> to climb down]",
]));

test("warnings", () => expect("warn", [
  "  You feel a sickness coming on.",
  "You spring a dart trap!",
  "You fall through a trap door! You lose 6 hit points.",
  "You fell into a pit! You suffer 4 hit points damage.",
  "  You suddenly feel weaker.",
  "You are hit by an arrow!",
  "  You went down to level 3!",
  "Only 50 mobuls left!",
]));

test("system", () => expect("system", [
  "Welcome to Ularn, Ivan -- Press <b>O</b> for options <b>?</b> for help",
  "Welcome to level 4.",
  "Game saved. 12,345 bytes written.",
  "Saving...",
  "Exploring...",
  "  Stopped exploring (monster nearby)",
  "Auto-loot: on",
  "Travelling to stairs",
]));

test("everything else is plain", () => expect("plain", [
  "",
  "There is an open door here.",
  "  The door opens.",
  "Spell '<b>mle</b>': magic missile",
  "  Nothing happens.",
  "The Talisman of the Sphere protects you from annihilation!",
]));
