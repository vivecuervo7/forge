// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "On the Billing Address step, selects the country, fills postal code and house number, then advances to the Payment step via proceed-3. Street and city are expected to be pre-populated from the customer profile.",
  preconditions: {
    url: /practicesoftwaretesting\.com\/checkout/,
  },
  args: {
    country: "string",     // visible label as shown in the dropdown, e.g. 'Austria'
    postalCode: "string",  // e.g. '1010'
    houseNumber: "string", // e.g. '42'
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('select[data-test="country"]').selectOption(args.country);
  await page.locator('input[data-test="postal_code"]').fill(args.postalCode);
  await page.locator('input[data-test="house_number"]').fill(args.houseNumber);
  await page.locator('[data-test="proceed-3"]').click();
}
