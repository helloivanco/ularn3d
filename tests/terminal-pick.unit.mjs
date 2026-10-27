import test from "node:test";
import assert from "node:assert/strict";
import { lineChoices, choiceAt } from "../src/terminal-pick.js";

const store = "c) ring mail                      400   d) chain mail                     850   ";

test("a store line holds two choices, each running to its price", () => {
  assert.deepEqual(lineChoices(store).map(({ key, start, end }) => [key, start, end]), [["c", 0, 37], ["d", 40, 77]]);
  assert.equal(store.slice(0, 37), "c) ring mail                      400");
});

test("pointing at a name or a price picks it; the gap between columns does not", () => {
  assert.equal(choiceAt(store, 5).key, "c");
  assert.equal(choiceAt(store, 35).key, "c");
  assert.equal(choiceAt(store, 38), null);
  assert.equal(choiceAt(store, 45).key, "d");
  assert.equal(choiceAt(store, 79), null);
});

test("prose with a parenthesis is not a choice", () => {
  assert.deepEqual(lineChoices("Welcome to the Ularn Thrift Shoppe.  We stock many items"), []);
  assert.deepEqual(lineChoices("Enter your transaction [space for next page, escape to leave]"), []);
  assert.deepEqual(lineChoices("You have 2,500 gold pieces (a fortune)"), []);
  assert.equal(choiceAt("   a) deposit gold", 6).key, "a");
});
