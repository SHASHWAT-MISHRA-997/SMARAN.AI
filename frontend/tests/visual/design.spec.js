import { test, expect } from '@playwright/test';

test('example selection fills its prompt without sending the previous draft', async ({ page }) => {
  const sent = [];
  await page.route('**/api/chat', route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ body: JSON.stringify({ token: 'Generated example' }) + '\n' });
  });
  await page.goto('/tests/visual/design.html');
  const prompt = page.getByPlaceholder('Describe what you want to create', { exact: false });
  await prompt.fill('Previous unrelated draft');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Use example' }).first().click();
  await expect(prompt).toHaveValue('Mobile crypto wallet and real-time transaction graphs with neon theme.');
  expect(sent).toHaveLength(0);
  await page.getByTitle('Generate Design (Ctrl+Enter)').click();
  await expect(page.getByText('Generated example', { exact: true })).toBeVisible();
  expect(sent[0].prompt).toContain('System=Cyberpunk Neon');
  expect(sent[0].prompt).not.toContain('Previous unrelated draft');
});

test('generation stays in Studio and renders the final unterminated stream record', async ({ page }) => {
  await page.route('**/api/chat', route => route.fulfill({
    contentType: 'application/x-ndjson',
    body: JSON.stringify({ token: '```html\n<h1>Verified design</h1>\n```' }),
  }));
  await page.goto('/tests/visual/design.html');
  await page.getByPlaceholder('Describe what you want to create', { exact: false }).fill('Create a heading');
  await page.getByTitle('Generate Design (Ctrl+Enter)').click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Verified design' })).toBeVisible();
  await expect(page).toHaveURL(/design.html$/);
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
});

test('specific provider error survives an otherwise empty response', async ({ page }) => {
  await page.route('**/api/chat', route => route.fulfill({
    body: JSON.stringify({ error: 'Model is unavailable for this account' }) + '\n',
  }));
  await page.goto('/tests/visual/design.html');
  await page.getByPlaceholder('Describe what you want to create', { exact: false }).fill('Create a heading');
  await page.getByTitle('Generate Design (Ctrl+Enter)').click();
  await expect(page.getByRole('alert')).toHaveText('Model is unavailable for this account');
});

test('closing an in-flight result keeps late output closed', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/chat', async route => {
    await gate;
    await route.fulfill({ body: JSON.stringify({ token: 'Late result' }) + '\n' }).catch(() => {});
  });
  await page.goto('/tests/visual/design.html');
  await page.getByPlaceholder('Describe what you want to create', { exact: false }).fill('Create a heading');
  await page.getByTitle('Generate Design (Ctrl+Enter)').click();
  await page.getByRole('button', { name: 'Close result' }).click();
  release();
  await expect(page.getByRole('button', { name: 'Close result' })).toHaveCount(0);
  await expect(page.getByTitle('Generate Design (Ctrl+Enter)')).toBeEnabled();
  await expect(page.getByText('Late result', { exact: true })).toHaveCount(0);
});
