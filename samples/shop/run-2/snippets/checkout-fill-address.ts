// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Fill the required billing address fields on the checkout address step and proceed to the payment step.",
  preconditions: {
    url: /practicesoftwaretesting\.com\/checkout/,
  },
  args: {
    country: "string",     // country name as it appears in the select options, e.g. "Austria"
    postalCode: "string",  // postal/zip code, e.g. "1010"
    houseNumber: "string", // house/building number, e.g. "98"
    state: "string",       // state or province, e.g. "Vienna"
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('[data-test="country"]').selectOption(args.country);
  await page.locator('[data-test="postal_code"]').fill(args.postalCode);
  await page.locator('[data-test="house_number"]').fill(args.houseNumber);
  await page.locator('[data-test="state"]').fill(args.state);
  await page.locator('[data-test="proceed-3"]').click();
}
