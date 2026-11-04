import type { Page } from '@playwright/test';
import { expect, gotoScreen } from './fixtures';

/** Opens the Live screen, taps "Start camera" and waits until the video plays. */
export async function startLiveCamera(page: Page): Promise<void> {
  await gotoScreen(page, 'live');
  await page.getByTestId('start-camera').click();
  const video = page.getByTestId('live-video');
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2 && v.videoWidth > 0), {
      message: 'the camera video should be playing',
      timeout: 10_000,
    })
    .toBe(true);
}

/** A number shown in the HUD (0 if the element shows something else). */
export async function hudNumber(page: Page, testId: string): Promise<number> {
  const text = (await page.getByTestId(testId).textContent()) ?? '';
  const n = Number(text.trim());
  return Number.isFinite(n) ? n : 0;
}
