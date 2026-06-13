// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the practicesoftwaretesting.com home page and search for a product by query term.",
  args: {
    query: "string", // the search term to enter
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://practicesoftwaretesting.com/');
  await page.locator('input[data-test="search-query"]').fill(args.query);
  await page.locator('button[data-test="search-submit"]').click();
}
