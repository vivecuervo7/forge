// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the JavaScript Alerts page, accept the JS Confirm dialog, and return the result text.",
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://the-internet.herokuapp.com/javascript_alerts');
  page.once('dialog', async dialog => { await dialog.accept(); });
  await page.locator('button:has-text("Click for JS Confirm")').click();
  return await page.locator('#result').textContent();
}
