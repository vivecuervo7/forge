// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to demoqa.com/auto-complete and add one or more colors to the multi-color autocomplete input.",
  args: {
    colors: "string[]", // array of color names to add, e.g. ['Red', 'Blue', 'Green']
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://demoqa.com/auto-complete');
  await page.locator('#autoCompleteMultipleContainer').scrollIntoViewIfNeeded();
  for (const color of args.colors) {
    await page.locator('#autoCompleteMultipleContainer input').click();
    await page.locator('#autoCompleteMultipleContainer input').fill(color);
    await page.waitForTimeout(500);
    await page.locator('.auto-complete__option').first().click();
    await page.waitForTimeout(300);
  }
}
