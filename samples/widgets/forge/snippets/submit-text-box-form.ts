// Authored by forge:snippet-author on 2026-06-15.
export const meta = {
  description: "Click the Submit button on the demoqa text-box page and return the output panel text.",
  preconditions: {
    url: /demoqa\.com\/text-box/,
  },
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('button:has-text("Submit")').click()
  await page.locator('#output').waitFor({ state: 'visible' })
  return await page.locator('#output').innerText()
}
