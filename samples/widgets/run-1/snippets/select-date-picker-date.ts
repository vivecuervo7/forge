// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the DemoQA Date Picker page and select a date in the 'Select Date' calendar picker by month name, four-digit year, and day number.",
  args: {
    /** Full month name, e.g. "December" */
    month: 'string',
    /** Four-digit year as a string, e.g. "2026" */
    year: 'string',
    /** Day of the month as a number, e.g. 25 */
    day: 'number',
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://demoqa.com/date-picker');
  await page.locator('#datePickerMonthYearInput').click();
  await page.locator('.react-datepicker__month-select').selectOption(args.month);
  await page.locator('.react-datepicker__year-select').selectOption(String(args.year));
  await page.getByRole('gridcell', { name: new RegExp(`Choose .* ${args.month} ${args.day}`) }).click();
}
