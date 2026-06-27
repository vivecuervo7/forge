// Authored by forge:curator on 2026-06-15.
export const meta = {
  description: "Click the Submit button on the demoqa text-box page and return the output panel text.",
  args: {},
  tags: ['form', 'read'],
  flow: 'widgets-text-box',
  phase: 'submit→read',
  requires: 'demoqa text-box page with form fields filled',
  enters: 'demoqa text-box page with output panel visible',
}

export async function run(page, args) {
  await page.locator('button:has-text("Submit")').click()
  await page.locator('#output').waitFor({ state: 'visible' })
  return await page.locator('#output').innerText()
}
