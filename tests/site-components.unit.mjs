import assert from "node:assert/strict";
import test from "node:test";
import { expandSiteComponents } from "../scripts/site-components.mjs";

test("header and footer expand once per page", () => {
  const home = expandSiteComponents(
    '<site-header variant="hero"></site-header><site-footer page="home"></site-footer>',
  );
  assert.match(home, /class="site-header site-header--hero"/);
  assert.match(home, /class="brand"/);
  assert.match(home, /class="nav-cta"/);
  assert.match(home, /Play free/);
  assert.match(home, /What’s New/);
  assert.doesNotMatch(home, /aria-current/);
  assert.match(home, /class="text-link web-only"/);
  assert.match(home, /download="__DOWNLOAD_FILENAME__"/);
  assert.match(home, /aria-label="Footer"/);

  const about = expandSiteComponents('<site-header current="about"></site-header><site-footer page="about"></site-footer>');
  assert.match(about, /class="site-header"/);
  assert.doesNotMatch(about, /site-header--hero/);
  assert.match(about, /href="\/about\/" aria-current="page"/);
  assert.match(about, /href="#history"/);
  assert.match(about, /Top ↑/);

  const notes = expandSiteComponents(
    '<site-header current="changelog"></site-header><site-footer page="changelog"></site-footer>',
  );
  assert.match(notes, /href="\/changelog\/" aria-current="page"/);
  assert.match(notes, /Releases/);
});

test("unknown footer page fails closed", () => {
  assert.throws(() => expandSiteComponents("<site-footer page=\"nope\"></site-footer>"), /Unknown site footer page/);
});
