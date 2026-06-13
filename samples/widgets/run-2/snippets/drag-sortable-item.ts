// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Drags a named item in a jQuery UI sortable list to a target position using incremental mouse moves (Playwright dragTo is unreliable on jQuery UI sortable; manual mouse sequence is required).",
  preconditions: {
    url: "demoqa\\.com/sortable",
  },
  args: {
    listSelector: "/* CSS selector matching the list items, e.g. '#demo-tabpane-list .list-group-item' */",
    itemText: "/* visible text of the item to drag */",
    targetIndex: "/* 1-based target position to place the item */",
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  const { listSelector, itemText, targetIndex } = args;

  const items = page.locator(listSelector);
  const count = await items.count();

  // Find the source item by text
  let sourceIndex = -1;
  for (let i = 0; i < count; i++) {
    const text = (await items.nth(i).textContent()).trim();
    if (text === itemText) {
      sourceIndex = i;
      break;
    }
  }

  const sourceBbox = await items.nth(sourceIndex).boundingBox();
  // Target slot: item currently occupying targetIndex (1-based → 0-based: targetIndex - 1)
  const targetBbox = await items.nth(targetIndex - 1).boundingBox();

  const startX = sourceBbox.x + sourceBbox.width / 2;
  const startY = sourceBbox.y + sourceBbox.height / 2;
  const endX = startX;
  const endY = targetBbox.y + targetBbox.height; // bottom edge triggers jQuery UI slot insertion

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    const y = startY + ((endY - startY) * i) / steps;
    await page.mouse.move(endX, y);
    await page.waitForTimeout(30);
  }

  await page.mouse.up();
}
