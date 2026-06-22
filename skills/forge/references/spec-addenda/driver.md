# Driver — spec mode addendum

This addendum is inlined into the driver's spawn prompt **only** when the lead spawns it with `MODE: spec` (`SPEC_WRITER_PRESENT: yes`). Drive/teach mode spawns don't include it, keeping their prompts lean.

The base driver behavior (claim task, scan library, invoke snippets, locator picking, STUCK escalation, end-of-drive snippet-author signal, completion ping, advisor-phase idle) is in `agents/driver.md` and applies as written. The notes below describe what spec mode adds on top.

## What spec mode adds

In spec mode the team includes `spec-writer` and `spec-verifier` teammates. You coordinate with them in addition to your standard drive + snippet-author duties:

- You send `spec-writer` a final-state summary at end of drive — their primary input for composing the `.spec.ts`.
- `spec-writer` and `spec-verifier` can both SendMessage you clarifying questions during their phases. Answer with locator-level specifics — they're reproducing your drive from a cold context.

## Final-state message to `spec-writer` (after step 8, before step 9)

Once you've sent `snippet-author` the `drive complete` signal, send `spec-writer` a final-state message summarizing the entire drive. Include enough for them to write a self-contained `.spec.ts` without re-asking you.

```
SendMessage(
  to="spec-writer",
  summary="drive complete: <one-line>",
  message="Full drive picture for spec authoring:

Steps (in order, marked invoked-vs-fresh):
1. invoked login({}) → landed on /inventory.html
2. invoked add-item-to-cart({'item': 'sauce-labs-backpack'}) → button changed to Remove, badge appeared
3. invoked cart-get-badge-count({}) → returned \"1\"

(For fresh-drive steps, include selectors used and the exact action sequence — spec-writer needs to reproduce them.)

Final assertion-worthy values:
- cart badge count = \"1\"

Env keys the spec will need: SAUCE_USERNAME, SAUCE_PASSWORD.

Pass/fail signal for this task: cart badge equals expected count after add-to-cart.

Notable observations: <anything spec-writer should know — quirks, timing-sensitive steps, account-specific behavior>"
)
```

The invoked-vs-fresh distinction lets spec-writer compose snippets directly for invoked steps and write fresh code for the rest. Captured values feed `expect()` assertions.

Then proceed to step 9 (mark complete and signal the lead) as in the base flow.

## Advisor-phase questions from spec-writer / spec-verifier

In addition to snippet-author follow-ups, expect questions from `spec-writer` and `spec-verifier` while you're idle. Verifier especially may ask for details when a spec fails — answer with locator-level specifics ("the cart icon was `.shopping_cart_link`, available immediately after `/inventory.html` load" or "the add-to-cart button required `dispatchEvent('click')` because standard click didn't register").
