// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Read the rendered output panel on demoqa.com/text-box after form submission; returns one string per field.",
  preconditions: {
    url: /demoqa\.com\/text-box/,
  },
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  return await page.locator('#output').locator('p').allInnerTexts();
}
