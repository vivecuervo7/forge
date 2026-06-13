// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the shadow DOM demo page and return the text of the first list item inside the shadow root.",
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://the-internet.herokuapp.com/shadowdom');
  return await page.locator('ul li').first().innerText();
}
