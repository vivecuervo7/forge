// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Return all chip label texts currently shown in the multi-color autocomplete on demoqa.com/auto-complete.",
  preconditions: {
    url: /demoqa\.com\/auto-complete/,
  },
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  return await page.locator('#autoCompleteMultipleContainer .auto-complete__multi-value__label').allTextContents();
}
