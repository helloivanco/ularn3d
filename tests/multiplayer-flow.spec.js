import { expect, test } from '@playwright/test';
import { onlineRoomFixture } from './lib/online-room-fixture.mjs';

const join = async (page, role, name) => {
  await page.locator('#multiplayer').click();
  await page.getByRole('button', { name: role === 'spectator' ? 'Watch' : 'Join with a code', exact: true }).click();
  const prefix = role === 'spectator' ? 'watch' : 'join';
  await page.locator(`#${prefix}-code`).fill('ABC234');
  await page.locator(`#${prefix}-name`).fill(name);
  await page.getByRole('button', { name: role === 'spectator' ? 'Watch room' : 'Join room', exact: true }).click();
};
const startTwo = async (page, browser) => {
  const service = onlineRoomFixture();
  const guest = await browser.newPage();
  await service.attach(page, 'ada'); await service.attach(guest, 'bea');
  await page.locator('#multiplayer').click();
  await page.getByRole('button', { name: 'Host a room', exact: true }).click();
  await page.locator('#host-name').fill('Ada');
  await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await expect(page.locator('#lobby-ready')).toBeVisible();
  await join(guest, 'player', 'Bea'); await expect(guest.locator('#lobby-ready')).toBeVisible();
  await page.locator('#lobby-ready').click(); await guest.locator('#lobby-ready').click();
  await expect(page.locator('#lobby-start')).toBeEnabled(); await page.locator('#lobby-start').click();
  for (const client of [page, guest]) await expect.poll(() => client.evaluate(() => ularnOnline.inMatch())).toBe(true);
  return { service, guest };
};
const checksum = page => page.evaluate(() => ularnOnline.diagnostics().checksum);
const send = (page, input) => page.evaluate(input => ularnOnline.sendInput(input), input);

test('each player controls their own hero, late joiners catch up, and reload restores the expedition', async ({ page, browser }) => {
  const { service, guest } = await startTwo(page, browser);
  const late = await browser.newPage();
  try {
    const before = await page.evaluate(() => ularn.party());
    await send(page, 'right'); await send(guest, 'right');
    await expect.poll(() => guest.evaluate(() => ularnOnline.diagnostics().seq)).toBe(2);
    const after = await page.evaluate(() => ularn.party());
    expect(after[0].x).toBe(before[0].x + 1);
    expect(after[1].x).toBe(before[1].x + 1);
    await expect.poll(async () => [await checksum(page), await checksum(guest)]).toEqual([await checksum(page), await checksum(page)]);
    await expect(guest.locator('#hero-name')).toBeHidden();
    expect(await guest.evaluate(() => ularn.snapshot().name)).toBe('Bea');
    await service.attach(late, 'cid'); await join(late, 'player', 'Cid');
    await expect.poll(() => late.evaluate(() => ularnOnline.inMatch())).toBe(true);
    expect(await late.evaluate(() => ularn.snapshot().name)).toBe('Cid');
    await expect.poll(() => page.evaluate(() => ularn.party().length)).toBe(3);
    await expect.poll(() => checksum(late)).toBe(await checksum(page));
    await guest.reload();
    await expect.poll(() => guest.evaluate(() => window.ularnOnline?.inMatch())).toBe(true);
    expect(await guest.evaluate(() => ularn.snapshot().name)).toBe('Bea');
    await expect.poll(() => checksum(guest)).toBe(await checksum(page));
    await page.screenshot({ path: 'test-results/multiplayer/three-own-characters.png' });
  } finally { await guest.close(); await late.close(); }
});

test('room management transfers the host, removes members, and leaves cleanly', async ({ page, browser }) => {
  const { service, guest } = await startTwo(page, browser);
  const watcher = await browser.newPage();
  try {
    await service.attach(watcher, 'cid'); await join(watcher, 'spectator', 'Cid');
    await expect.poll(() => watcher.evaluate(() => ularnOnline.inMatch())).toBe(true);
    await page.locator('#room-menu').click();
    await page.getByRole('button', { name: 'Make Bea the host', exact: true }).click();
    await expect.poll(() => guest.evaluate(() => ularnOnline.diagnostics().role)).toBe('host');
    await page.locator('dialog[open] .dialog-x').click();
    await guest.locator('#room-menu').click();
    await guest.getByRole('button', { name: 'Remove Cid from room', exact: true }).click();
    await expect(watcher.locator('dialog[open] .online-status')).toContainText('removed', { timeout: 15000 });
    await guest.locator('#room-leave').click();
    await expect(guest.locator('#welcome')).toBeVisible();
    await expect.poll(() => page.evaluate(() => ularnOnline.diagnostics().role)).toBe('host');
    expect(await guest.evaluate(() => localStorage.getItem('ularn.online.room.v2'))).toBeNull();
  } finally { await guest.close(); await watcher.close(); }
});

test('a player cannot interrupt another player’s choice', async ({ page, browser }) => {
  const { guest } = await startTwo(page, browser);
  try {
    await send(page, 'q');
    await expect.poll(() => guest.evaluate(() => ularnOnline.acceptsInput())).toBe(false);
    const before = await guest.evaluate(() => ularn.snapshot().x);
    const denied = await send(guest, 'right');
    expect(denied.ok).toBe(false);
    expect(await guest.evaluate(() => ularn.snapshot().x)).toBe(before);
    await send(page, 'escape');
    await expect.poll(() => guest.evaluate(() => ularnOnline.acceptsInput())).toBe(true);
    await send(guest, 'right');
    await expect.poll(() => guest.evaluate(() => ularn.snapshot().x)).toBe(before + 1);
  } finally { await guest.close(); }
});

test('a visible exit works for the host, spectators, and the game menu on compact screens', async ({ page, browser }) => {
  const { service, guest } = await startTwo(page, browser);
  const watcher = await browser.newPage();
  try {
    await service.attach(watcher, 'cid'); await join(watcher, 'spectator', 'Cid');
    await expect.poll(() => watcher.evaluate(() => ularnOnline.inMatch())).toBe(true);
    for (const [width, height] of [[1440, 1000], [390, 844], [320, 568], [568, 320]]) {
      await page.setViewportSize({ width, height });
      const exit = page.getByRole('button', { name: 'Leave room', exact: true });
      await expect(exit).toBeVisible();
      expect(await exit.evaluate(element => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight &&
          element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      })).toBe(true);
      if (width === 390) await page.screenshot({ path: 'test-results/multiplayer/visible-exit-phone.png' });
    }
    await page.locator('#room-exit').click();
    await expect(page.locator('#welcome')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('ularn.online.room.v2'))).toBeNull();
    await expect.poll(() => guest.evaluate(() => ularnOnline.diagnostics().role)).toBe('host');
    expect(service.members.find(member => member.user_id === 'ada').connected).toBe(false);
    await watcher.setViewportSize({ width: 390, height: 844 });
    await expect(watcher.locator('#room-exit')).toBeVisible();
    await watcher.locator('#room-exit').click();
    await expect(watcher.locator('#welcome')).toBeVisible();
    expect(service.members.find(member => member.user_id === 'cid').connected).toBe(false);
    await guest.locator('#pause').click();
    await expect(guest.locator('#pause-dialog')).toContainText('Your party can keep playing');
    const release = service.hold('leave_room');
    await guest.locator('#save-exit').click();
    await expect(guest.locator('#save-exit')).toHaveText('Leaving…');
    await expect(guest.locator('#save-exit')).toBeDisabled();
    await expect(guest.locator('#pause-status')).toContainText('returning to title');
    release();
    await expect(guest.locator('#welcome')).toBeVisible();
  } finally { await guest.close(); await watcher.close(); }
});
