import { test, expect } from '@playwright/test';

test.describe('Phase 3 — Critical User Journeys', () => {
  test('Journey 1: Chat UI and Input Interaction', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Locate the chat input
    const chatInput = page.locator('textarea, input[type="text"]').first();
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    // If disabled because no session is selected, click New Chat button
    const isDisabled = await chatInput.isDisabled();
    if (isDisabled) {
      const newChatBtn = page.locator('button:has-text("New"), button[title*="New"], button:has(.lucide-plus)').first();
      if (await newChatBtn.isVisible()) {
        await newChatBtn.click();
      }
    }

    // Verify input is present in the DOM
    await expect(chatInput).toBeVisible();
  });

  test('Journey 2: Navigation & Modals UI checks', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for buttons to hydrate
    const button = page.locator('button').first();
    await expect(button).toBeVisible({ timeout: 10000 });

    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThan(2);

    // Look for theme toggle / settings button
    const settingsBtn = page.locator('button[title*="Settings"], button:has(.lucide-settings), button:has(.lucide-sliders)').first();
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
    }
  });
});
