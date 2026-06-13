// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the shadow DOM demo page and return the text of a list item by index (defaults to the first).",
  args: {
    /** Zero-based index of the list item to capture. Defaults to 0 (first item). */
    index: { type: 'number', default: 0 },
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://the-internet.herokuapp.com/shadowdom');
  const index = args.index ?? 0;
  return await page.locator('li').nth(index).textContent();
}
