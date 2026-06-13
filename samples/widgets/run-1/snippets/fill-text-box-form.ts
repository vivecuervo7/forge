// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the DemoQA Text Box page and fill all four fields (full name, email, current address, permanent address).",
  args: {
    /** Full name to enter, e.g. "Jane Smith" */
    fullName: 'string',
    /** Email address to enter, e.g. "jane.smith@example.com" */
    email: 'string',
    /** Current address text, e.g. "123 Main Street, Springfield, IL 62701" */
    currentAddress: 'string',
    /** Permanent address text, e.g. "456 Oak Avenue, Chicago, IL 60601" */
    permanentAddress: 'string',
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://demoqa.com/text-box');
  await page.locator('#userName').fill(args.fullName);
  await page.locator('#userEmail').fill(args.email);
  await page.locator('#currentAddress').fill(args.currentAddress);
  await page.locator('#permanentAddress').fill(args.permanentAddress);
}
