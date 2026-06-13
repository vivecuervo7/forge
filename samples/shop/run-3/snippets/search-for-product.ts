// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigates to the catalog home page, types a query into the search box, and submits — leaving the result list visible.",
  args: {
    query: "string", // search term, e.g. 'hammer'
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://practicesoftwaretesting.com/');
  await page.locator('input[data-test="search-query"]').fill(args.query);
  await page.locator('button[data-test="search-submit"]').click();
}
