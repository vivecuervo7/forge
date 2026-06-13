// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Swaps two HTML5-draggable elements by dispatching a synthetic DragEvent sequence — use this instead of Playwright's dragTo, which is unreliable for native HTML5 DnD.",
  args: {
    sourceId: "string — the id attribute of the drag source element (without '#'), e.g. 'column-a'",
    targetId: "string — the id attribute of the drop target element (without '#'), e.g. 'column-b'",
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  const { sourceId, targetId } = args;
  await page.goto('https://the-internet.herokuapp.com/drag_and_drop');
  await page.evaluate(({ sourceId, targetId }) => {
    const source = document.getElementById(sourceId);
    const target = document.getElementById(targetId);
    const dt = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragover',  { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop',      { bubbles: true, cancelable: true, dataTransfer: dt }));
    source.dispatchEvent(new DragEvent('dragend',   { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { sourceId, targetId });
}
