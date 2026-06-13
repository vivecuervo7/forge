// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to a product page by URL and add the product to the cart, waiting for the success toast before returning.",
  args: {
    productUrl: "string — full URL of the product page (e.g. https://practicesoftwaretesting.com/product/<id>)",
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto(args.productUrl);
  await page.locator('button[data-test="add-to-cart"]').click();
  await page.getByRole('alert', { name: /Product added to shopping cart/i }).waitFor();
}
