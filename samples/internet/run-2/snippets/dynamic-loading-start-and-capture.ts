// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the-internet /dynamic_loading/:variant, click Start, wait for the loading bar to finish, and return the revealed text.",
  args: {
    variant: "string — dynamic loading example variant, '1' (hidden element) or '2' (dynamically rendered element); defaults to '1'",
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  const variant = args.variant ?? '1';
  await page.goto(`https://the-internet.herokuapp.com/dynamic_loading/${variant}`);
  await page.locator("button:has-text('Start')").click();
  await page.locator('#finish').waitFor({ state: 'visible', timeout: 15000 });
  return await page.locator('#finish').innerText();
}
