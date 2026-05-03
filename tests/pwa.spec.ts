import { expect, test } from '@playwright/test';

test('loads the mobile app shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByText('Podora').first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('RSS feed URL')).toBeVisible();
});
