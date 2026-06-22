# Snippet-author — spec mode addendum

This addendum is inlined into the snippet-author's spawn prompt **only** when the lead spawns it with `MODE: spec` (`SPEC_WRITER_PRESENT: yes`). Drive/teach mode spawns don't include it, keeping their prompts lean.

The base snippet-author behavior (claim task, process driver narrations, write snippets, refresh INDEX, completion ping) is in `agents/snippet-author.md` and applies as written. The notes below describe what spec mode adds on top.

## What spec mode adds

In spec mode the team includes a `spec-writer` teammate that composes a `.spec.ts` once both the drive and the library are settled. Spec-writer waits on a signal from you before composing — without it, they may start writing as soon as the driver's final-state arrives, and any snippets you author after won't make it into the spec.

## Signal spec-writer before pinging the lead (step 7 override)

Once you've received the driver's `drive complete` signal AND authored everything AND clarifying questions are resolved, **SendMessage spec-writer FIRST** so they know the library is complete:

```
SendMessage(
  to="spec-writer",
  summary="snippets ready",
  message="Authored N snippet(s) for the drive: <name1>, <name2>, ... All fresh-drive steps from the drive's narration are covered. Compose freely — the library won't grow further."
)
```

Then SendMessage `team-lead` with your completion ping as described in the base step 7.
