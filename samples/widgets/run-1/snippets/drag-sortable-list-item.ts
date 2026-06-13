// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigates to demoqa.com/sortable (List tab) and drags a named item so it lands immediately after another named item, returning the resulting list order.",
  preconditions: {},
  args: {
    /** Text of the item to drag, e.g. "One" */
    item: 'string',
    /** Text of the item to place the dragged item after, e.g. "Three" */
    afterItem: 'string',
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://demoqa.com/sortable');

  const listItems = page.locator('#demo-tabpane-list .list-group-item');

  // Resolve source and target by text content
  const allTexts = await listItems.allTextContents();
  const srcIndex = allTexts.findIndex(t => t.trim() === args.item);
  const tgtIndex = allTexts.findIndex(t => t.trim() === args.afterItem);

  const srcItem = listItems.nth(srcIndex);
  const tgtItem = listItems.nth(tgtIndex);

  const srcBox = await srcItem.boundingBox();
  const tgtBox = await tgtItem.boundingBox();

  const srcX = srcBox.x + srcBox.width / 2;
  const srcY = srcBox.y + srcBox.height / 2;
  const tgtX = tgtBox.x + tgtBox.width / 2;
  const tgtY = tgtBox.y + tgtBox.height - 2; // near bottom edge of target

  await page.mouse.move(srcX, srcY);
  await page.mouse.down();
  await page.waitForTimeout(300);
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(
      srcX + (tgtX - srcX) * (i / 20),
      srcY + (tgtY - srcY) * (i / 20)
    );
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(300);
  await page.mouse.up();

  const finalOrder = await listItems.allTextContents();
  return finalOrder.map(t => t.trim());
}
