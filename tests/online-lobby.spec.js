import { expect, test } from '@playwright/test';
import { onlineRoomFixture } from './lib/online-room-fixture.mjs';

const hostForm = async page => {
  await page.locator('#multiplayer').click();
  await page.getByRole('button', { name: 'Host a room', exact: true }).click();
  await page.locator('#host-name').fill('Ada');
  return page.getByRole('dialog', { name: 'Host', exact: true });
};
const dialogWithTitle = (page, title) => page.locator('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const create = async page => {
  await hostForm(page);
  await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await expect(page.locator('#lobby-ready')).toBeVisible();
};
const join = async (page, role = 'player') => {
  await page.locator('#multiplayer').click();
  await page.getByRole('button', { name: role === 'spectator' ? 'Watch' : 'Join with a code', exact: true }).click();
  const prefix = role === 'spectator' ? 'watch' : 'join';
  await page.locator(`#${prefix}-name`).fill(role === 'spectator' ? 'Cid' : 'Bea');
  await page.locator(`#${prefix}-code`).fill('ABC234');
  await page.getByRole('button', { name: role === 'spectator' ? 'Watch room' : 'Join room', exact: true }).click();
  await expect(dialogWithTitle(page, 'Lobby')).toBeVisible();
};

test('room creation shows progress through connection and retries the same room', async ({ page }) => {
  const service = onlineRoomFixture();
  await service.attach(page, 'ada');
  const release = service.hold('create_room');
  await hostForm(page);
  const host = dialogWithTitle(page, 'Host');
  await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await expect(host).toHaveAttribute('aria-busy', 'true');
  await expect(host.getByRole('button', { name: 'Creating room…', exact: true })).toBeDisabled();
  await expect(host.getByRole('status')).toContainText('Creating your room');
  await expect(page.locator('#host-name')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(host).toBeVisible();
  service.failNext('sync_room');
  const connect = service.hold('sync_room');
  release();
  await expect(host.getByRole('button', { name: 'Connecting…', exact: true })).toBeDisabled();
  await expect(host.getByRole('status')).toContainText('Room created. Connecting');
  connect();
  await expect(host.getByRole('status')).toContainText('connection failed');
  await expect(host.getByRole('button', { name: 'Retry connection', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await expect(host).not.toBeVisible();
  await expect(page.locator('#lobby-ready')).toHaveText('Ready to play');
  expect(service.count('create_room')).toBe(1);
});

test('a failed roster read keeps the host dialog open for retry', async ({ page }) => {
  const service = onlineRoomFixture();
  await service.attach(page, 'ada');
  service.failNext('sync_room');
  await hostForm(page);
  const host = dialogWithTitle(page, 'Host');
  await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await expect(host.getByRole('status')).toContainText('connection failed');
  await expect(host.getByRole('button', { name: 'Retry connection', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await expect(page.locator('#lobby-ready')).toBeVisible();
  expect(service.count('create_room')).toBe(1);
});

test('failed creation and joining show errors and restore the actions', async ({ page }) => {
  const service = onlineRoomFixture();
  await service.attach(page, 'ada');
  service.failNext('create_room');
  await hostForm(page);
  const host = dialogWithTitle(page, 'Host');
  await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await expect(host.getByRole('status')).toContainText('Please try again');
  await expect(host.getByRole('button', { name: 'Create lobby', exact: true })).toBeEnabled();
  await host.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#multiplayer').click();
  await page.getByRole('button', { name: 'Join with a code', exact: true }).click();
  await page.locator('#join-code').fill('WRONG1');
  const joining = dialogWithTitle(page, 'Join');
  const release = service.hold('join_room');
  await joining.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(joining.getByRole('button', { name: 'Joining room…', exact: true })).toBeDisabled();
  await expect(joining.getByRole('status')).toHaveText('Joining the room…');
  release();
  await expect(joining.getByRole('status')).toHaveText('That code does not match a room.');
  await expect(joining.getByRole('button', { name: 'Join room', exact: true })).toBeEnabled();
});

test('two players ready up, spectators do not block, and the host starts both browsers', async ({ page, browser }) => {
  const service = onlineRoomFixture();
  const guestContext = await browser.newContext();
  const spectatorContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    const spectator = await spectatorContext.newPage();
    await service.attach(page, 'ada');
    await service.attach(guest, 'bea');
    await service.attach(spectator, 'cid');
    await create(page);
    await expect(page.locator('#lobby-start')).toBeDisabled();
    await expect(dialogWithTitle(page, 'Lobby').getByRole('status')).toContainText('Select Ready to play');
    await join(guest);
    await join(spectator, 'spectator');
    await expect(spectator.locator('#lobby-ready')).toBeHidden();
    await expect(guest.locator('#lobby-start')).toBeHidden();
    service.throwNext('set_ready');
    await page.locator('#lobby-ready').click();
    await expect(dialogWithTitle(page, 'Lobby').getByRole('status')).toContainText('Connection failed');
    await expect(page.locator('#lobby-ready')).toHaveText('Ready to play');
    await expect(page.locator('#lobby-ready')).toHaveAttribute('aria-pressed', 'false');
    const ready = service.hold('set_ready');
    await page.locator('#lobby-ready').click();
    await expect(page.locator('#lobby-ready')).toHaveText('Updating readiness…');
    await expect(page.locator('#lobby-ready')).toBeDisabled();
    await expect(page.locator('#lobby-start')).toBeDisabled();
    ready();
    await expect(page.locator('#lobby-ready')).toHaveAttribute('aria-pressed', 'true');
    await expect(dialogWithTitle(page, 'Lobby').getByRole('status')).toContainText('Waiting for Bea');
    await guest.locator('#lobby-ready').click();
    await expect(page.locator('#lobby-start')).toBeEnabled();
    await expect(dialogWithTitle(guest, 'Lobby').getByRole('status')).toContainText('Waiting for the host');
    await page.screenshot({ path: 'test-results/multiplayer/ready-lobby.png' });
    service.failNext('start_run');
    await page.locator('#lobby-start').click();
    await expect(dialogWithTitle(page, 'Lobby').getByRole('status')).toContainText('Connection failed');
    await expect(page.locator('#lobby-start')).toBeEnabled();
    const start = service.hold('start_run');
    await page.locator('#lobby-start').click();
    await expect(page.locator('#lobby-start')).toHaveText('Starting expedition…');
    await expect(page.locator('#lobby-start')).toBeDisabled();
    await expect(dialogWithTitle(page, 'Lobby').getByRole('status')).toContainText('Starting the expedition for everyone');
    start();
    for (const client of [page, guest, spectator]) {
      await expect.poll(() => client.evaluate(() => window.ularnOnline.inMatch())).toBe(true);
      await expect(dialogWithTitle(client, 'Lobby')).not.toBeVisible();
      await expect(client.locator('#welcome')).toBeHidden();
      await expect(client.locator('#hud')).not.toHaveAttribute('hidden');
      await expect(client.locator('#pause')).toBeVisible();
    }
    expect(service.count('start_run')).toBe(2);
    await page.screenshot({ path: 'test-results/multiplayer/started.png' });
  } finally {
    await guestContext.close();
    await spectatorContext.close();
  }
});

for (const problem of ['none', 'failure', 'stalled']) {
  test(`leaving the lobby returns to title without rejoining (${problem})`, async ({ page }) => {
    const service = onlineRoomFixture();
    await service.attach(page, 'ada');
    await create(page);
    await page.evaluate(() => history.replaceState(null, '', '/play/?room=ABC234#chat'));
    const lobby = dialogWithTitle(page, 'Lobby');
    await expect(lobby.locator('.room-exit-help')).toContainText('room closes');
    if (problem === 'failure') service.throwNext('leave_room');
    const release = problem === 'stalled' ? service.hold('leave_room') : null;
    const syncCalls = service.count('sync_room');
    const releaseHeartbeat = problem === 'none' ? service.hold('sync_room') : null;
    if (releaseHeartbeat) await expect.poll(() => service.count('sync_room')).toBeGreaterThan(syncCalls);
    const initialOrigin = await page.evaluate(() => performance.timeOrigin);
    try {
      await page.locator('#room-leave').click();
      if (releaseHeartbeat) {
        expect(service.count('leave_room')).toBe(0);
        releaseHeartbeat();
      }
      if (release) {
        await expect(page.locator('#room-leave')).toHaveText('Leaving…');
        await expect(page.locator('#room-leave')).toBeDisabled();
        await expect(lobby.getByRole('status')).toContainText('returning to title');
        await page.evaluate(() => ularnOnline.leave());
      }
      await page.waitForFunction(origin => performance.timeOrigin !== origin && window.ularnOnline, initialOrigin);
      await expect(page.locator('#welcome')).toBeVisible();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('ularn.online.room.v2'))).toBeNull();
      expect(await page.evaluate(() => ularnOnline.inRoom())).toBe(false);
      await expect(page).toHaveURL(/\/play\/$/);
      expect(service.count('leave_room')).toBe(1);
      expect(service.count('resume_room')).toBe(0);
      await page.reload();
      await page.waitForFunction(() => window.ularnOnline);
      await expect(page.locator('#welcome')).toBeVisible();
      await expect(page.locator('#room-exit')).toBeHidden();
      expect(service.count('resume_room')).toBe(0);
    } finally { release?.(); releaseHeartbeat?.(); }
  });
}
