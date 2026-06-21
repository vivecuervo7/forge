// Authored by forge:snippet-author on 2026-06-15.
export const meta = {
  description: "Navigate to the demoqa text-box page and fill all four form fields.",
  args: {
    /** Full name to enter in the Full Name field */
    fullName: "string",
    /** Email address to enter in the Email field */
    email: "string",
    /** Current address to enter in the Current Address field */
    currentAddress: "string",
    /** Permanent address to enter in the Permanent Address field */
    permanentAddress: "string",
  },
  tags: ['form', 'fill'],
  flow: 'widgets-text-box',
  phase: 'fill',
  enters: 'demoqa text-box page with all fields populated',
}

export async function run(page, args) {
  const { fullName, email, currentAddress, permanentAddress } = args
  if (!fullName) throw new Error('fullName arg is required')
  if (!email) throw new Error('email arg is required')
  if (!currentAddress) throw new Error('currentAddress arg is required')
  if (!permanentAddress) throw new Error('permanentAddress arg is required')

  await page.goto('https://demoqa.com/text-box')
  await page.locator('#userName').fill(fullName)
  await page.locator('#userEmail').fill(email)
  await page.locator('#currentAddress').fill(currentAddress)
  await page.locator('#permanentAddress').fill(permanentAddress)
}
