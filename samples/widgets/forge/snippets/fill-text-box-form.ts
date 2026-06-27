// Authored by forge:curator on 2026-06-15.
export const meta = {
  description: "Navigate to the demoqa text-box page and fill all four form fields.",
  args: {
    fullName: { type: 'string', description: 'name for the Full Name field' },
    email: { type: 'string', description: 'address for the Email field' },
    currentAddress: { type: 'string', description: 'text for the Current Address field' },
    permanentAddress: { type: 'string', description: 'text for the Permanent Address field' },
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
