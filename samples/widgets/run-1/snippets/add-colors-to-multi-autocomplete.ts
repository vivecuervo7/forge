// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigates to demoqa.com/auto-complete and adds a list of colors to the multi-color autocomplete, returning the final chip label texts.",
  args: {
    colors: "string[] — color names to add (e.g. ['Red', 'Blue', 'Green'])",
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://demoqa.com/auto-complete');
  for (const color of args.colors) {
    await page.locator('#autoCompleteMultipleInput').fill(color);
    await page.waitForTimeout(500);
    await page.locator('.auto-complete__option').first().click();
  }
  const chips = await page.locator('.auto-complete__multi-value__label').allInnerTexts();
  return chips;
}
