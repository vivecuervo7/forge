// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to demoqa modal-dialogs, open the small modal, capture its title and body text, close the modal, and return the captured content.",
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://demoqa.com/modal-dialogs');
  await page.locator('button#showSmallModal').click();
  await page.locator('[role=dialog]').waitFor({ state: 'visible' });
  const title = await page.locator('.modal-title').textContent();
  const body = await page.locator('.modal-body').textContent();
  await page.locator('#closeSmallModal').click();
  await page.locator('[role=dialog]').waitFor({ state: 'hidden' });
  return { title: title?.trim(), body: body?.trim() };
}
