// Authored by forge:snippet-author on 2026-06-15.
export const meta = {
  description: "Clicks the add-to-cart button on a product detail page and waits for the confirmation toast.",
  preconditions: {
    url: /\/product\//,
  },
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('button[data-test="add-to-cart"]').click()
  await page.locator('[role="alert"]').waitFor({ state: 'visible' })
}
