// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Fill in the required billing address fields on checkout step 3 (street and city are pre-populated from the account) and proceed to the payment step.",
  preconditions: {
    url: "https://practicesoftwaretesting.com/checkout",
  },
  args: {
    country: "string — country to select (e.g. 'Austria')",
    state: "string — state or province (e.g. 'Vienna')",
    postalCode: "string — postal/ZIP code (e.g. '1000')",
    houseNumber: "string — house or unit number (e.g. '98')",
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('select[data-test="country"]').selectOption(args.country);
  await page.locator('input[data-test="postal_code"]').fill(args.postalCode);
  await page.locator('input[data-test="house_number"]').fill(args.houseNumber);
  await page.locator('input[data-test="state"]').fill(args.state);
  await page.locator('button[data-test="proceed-3"]').click();
}
