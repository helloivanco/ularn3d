import { expect, test } from '@playwright/test';
import { onlineRoomFixture } from './lib/online-room-fixture.mjs';

const activeRoom = async (page, browser, includeSpectator = false) => {
  const service = onlineRoomFixture();
  const guest = await browser.newPage();
  const watcher = includeSpectator ? await browser.newPage() : null;
  await service.attach(page, 'ada');
  await service.attach(guest, 'bea');
  if (watcher) await service.attach(watcher, 'cid');
  await page.locator('#multiplayer').click();
  await page.getByRole('button', { name: 'Host a room', exact: true }).click();
  await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await expect(page.locator('#lobby-ready')).toBeVisible();
  for (const [client, role] of [[guest, 'player'], ...(watcher ? [[watcher, 'spectator']] : [])]) {
    await client.locator('#multiplayer').click();
    await client.getByRole('button', { name: role === 'player' ? 'Join with a code' : 'Watch', exact: true }).click();
    await client.locator(role === 'player' ? '#join-code' : '#watch-code').fill('ABC234');
    await client.getByRole('button', { name: role === 'player' ? 'Join room' : 'Watch room', exact: true }).click();
    await expect(client.locator('.room-code')).toBeVisible();
  }
  await page.locator('#lobby-ready').click();
  await guest.locator('#lobby-ready').click();
  await expect(page.locator('#lobby-start')).toBeEnabled();
  await page.locator('#lobby-start').click();
  for (const client of [page, guest, ...(watcher ? [watcher] : [])]) {
    await expect.poll(() => client.evaluate(() => window.ularnOnline.inMatch())).toBe(true);
  }
  return { service, guest, watcher };
};

test('quick sends preserve the draft, show progress, and minimized chat can be reopened', async ({ page, browser }) => {
  const { service, guest } = await activeRoom(page, browser);
  try {
    const draft = page.locator('#chat-input');
    await draft.fill('A longer message I am writing');
    const release = service.hold('post_chat');
    await page.locator('#chat-quick button[data-message="Follow me"]').click();
    await expect(page.locator('#chat-status')).toHaveText('Sending “Follow me”…');
    await expect(page.locator('#chat-quick button').first()).toBeDisabled();
    await expect(page.locator('#chat-form button[type=submit]')).toBeDisabled();
    await expect(draft).toHaveValue('A longer message I am writing');
    release();
    await expect(page.locator('#chat-status')).toHaveText('Sent to Party: Follow me');
    await expect(guest.locator('#chat-log')).toContainText('Follow me');
    await expect(draft).toHaveValue('A longer message I am writing');
    expect(service.count('post_chat')).toBe(1);
    await expect.poll(() => page.evaluate(() => ularnOnline.blocksGameKeys())).toBe(false);
    await guest.locator('#chat-close').click();
    await expect(guest.locator('#chat-panel')).toBeHidden();
    await expect(guest.locator('#chat-toggle')).toBeVisible();
    await page.locator('#chat-quick button[data-message="Wait"]').click();
    await expect(guest.locator('#chat-toggle')).toContainText('1 new');
    await guest.locator('#chat-toggle').click();
    await expect(guest.locator('#chat-input')).toBeFocused();
    await expect(guest.locator('#chat-log')).toContainText('Wait');
    await guest.locator('#chat-input').press('Escape');
    await expect.poll(() => guest.evaluate(() => ularnOnline.blocksGameKeys())).toBe(false);
    await guest.keyboard.press('Enter');
    await expect(guest.locator('#chat-input')).toBeFocused();
    await page.locator('#chat-panel').screenshot({ path: 'test-results/multiplayer/chat-desktop.png' });
    await page.setViewportSize({ width: 375, height: 740 });
    const mobile = await page.locator('#chat-panel').boundingBox();
    expect(mobile.x).toBeGreaterThanOrEqual(0);
    expect(mobile.y).toBeGreaterThanOrEqual(0);
    expect(mobile.x + mobile.width).toBeLessThanOrEqual(375);
    expect(mobile.y + mobile.height).toBeLessThanOrEqual(740);
    await page.locator('#chat-panel').screenshot({ path: 'test-results/multiplayer/chat-mobile.png' });
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('#chat-form')).toBeInViewport();
    await page.locator('#chat-panel').screenshot({ path: 'test-results/multiplayer/chat-landscape.png' });
  } finally { await guest.close(); }
});

test('failed messages keep their draft and edits made during a send survive', async ({ page, browser }) => {
  const { service, guest } = await activeRoom(page, browser);
  try {
    const input = page.locator('#chat-input');
    await input.fill('Meet me at the entrance');
    service.failNext('post_chat');
    await input.press('Enter');
    await expect(page.locator('#chat-status')).toContainText('Message not sent');
    await expect(input).toHaveValue('Meet me at the entrance');
    await expect(guest.locator('#chat-log')).not.toContainText('Meet me at the entrance');
    const release = service.hold('post_chat');
    await input.press('Enter');
    await expect(page.locator('#chat-status')).toHaveText('Sending your message…');
    await input.fill('And bring a potion');
    release();
    await expect(page.locator('#chat-status')).toHaveText('Message sent to Party.');
    await expect(input).toHaveValue('And bring a potion');
    await expect(guest.locator('#chat-log')).toContainText('Meet me at the entrance');
  } finally { await guest.close(); }
});

test('spectators start in their own chat and disallowed channels are read-only', async ({ page, browser }) => {
  const { guest, watcher } = await activeRoom(page, browser, true);
  try {
    await expect(watcher.locator('[data-channel="spectators"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(watcher.locator('#chat-input')).toHaveAttribute('placeholder', 'Message spectators…');
    await watcher.locator('#chat-quick button[data-message="Nice move!"]').click();
    await expect(watcher.locator('#chat-status')).toHaveText('Sent to Spectators: Nice move!');
    await expect(page.locator('#chat-unread')).toBeVisible();
    await page.locator('[data-channel="spectators"]').click();
    await expect(page.locator('#chat-log')).toContainText('Nice move!');
    await watcher.locator('[data-channel="party"]').click();
    await expect(watcher.locator('#chat-input')).toBeDisabled();
    await expect(watcher.locator('#chat-audience')).toContainText('Switch to Spectators to send');
    await expect(watcher.locator('#chat-quick-section')).toBeHidden();
    await guest.locator('[data-channel="spectators"]').click();
    await expect(guest.locator('#chat-input')).toBeDisabled();
    await expect(guest.locator('#chat-audience')).toContainText('Switch to Party to send');
    await guest.locator('[data-channel="party"]').click();
    await expect(guest.locator('#chat-input')).toBeEnabled();
  } finally { await guest.close(); await watcher.close(); }
});
