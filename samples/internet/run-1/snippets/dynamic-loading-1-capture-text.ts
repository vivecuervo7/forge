// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the dynamic loading example 1 page, click Start, wait for the hidden element to be revealed, and return the text it contains.",
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://the-internet.herokuapp.com/dynamic_loading/1');
  await page.locator('button:has-text("Start")').click();
  await page.locator('#finish').waitFor({ state: 'visible' });
  return await page.locator('#finish h4').textContent();
}
