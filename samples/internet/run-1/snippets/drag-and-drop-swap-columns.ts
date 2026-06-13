// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigates to the drag-and-drop demo page and swaps column A into column B's position using Playwright's native dragTo.",
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://the-internet.herokuapp.com/drag_and_drop');
  await page.locator('#column-a').dragTo(page.locator('#column-b'));
}
