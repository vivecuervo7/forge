// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to demoqa.com/date-picker, open the calendar popup, select a target month/year/day, and confirm the input is set.",
  args: {
    month: "string",  // full month name, e.g. 'December'
    year: "string",   // four-digit year as string, e.g. '2026'
    day: "number",    // day of month as a number, e.g. 25
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://demoqa.com/date-picker');
  await page.locator('#datePickerMonthYearInput').click();
  await page.getByRole('combobox').first().selectOption([args.month]);
  await page.getByRole('combobox').nth(1).selectOption([args.year]);
  await page.getByRole('gridcell', { name: new RegExp(`Choose.*${args.month}\\s+${args.day}`) }).click();
}
