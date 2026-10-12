# Key prompts

Prompts that shaped the design or the code, saved verbatim with the date and what they produced.

## Assumption stress-test (Step 1)

Not run in Claude Code yet: the build used AS1–AS16 exactly as written in the guide.

<!-- Paste the prompts you used to stress-test AS1–AS16 here. -->

## Step prompts

The standard step prompt is `/step N` (see `.claude/commands/step.md`). Record any prompt that deviated from it, and why.

### Build prompt (8 Oct 2026)

Sent to Claude Code with `docs/implementation-guide.md` attached, before the repository existed:

> Please read through the attached file to understand the requirement and step to do and start building accordingly. Please strictly follow to code structure in the document.

How it deviated from `/step N`: one prompt drove Steps 0–13 in a single session, so there was no plan-approval gate per step. Claude Code instead committed each step separately so the steps can be reviewed one by one, and it stopped to ask before changing the guide's design.

What it produced: 28 local commits covering Steps 0–13. That includes the guardrail files, the NestJS scaffold, schema and seed, CI, tests written first, domain, repositories, booking API, the four SHOULD features, OpenAPI and client stubs, observability, hardening and documentation. Nothing was pushed.

### Concurrency design decision (8 Oct 2026)

Asked by Claude Code after stress testing, as a multiple-choice question:

> Stress testing shows the guide's plain INSERT + 23P01 design livelocks when many requests race for one slot (CT tests fail in roughly 1 of 8 full-suite runs: deadlock aborts → bounded retries exhausted → 500). INSERT … ON CONFLICT DO NOTHING (PostgreSQL's speculative insertion, deadlock-free) removes it: the exclusion constraints stay the guarantee and the INSERT stays the single autocommit decision, but a lost race returns 0 rows and the repository then reads which resource (bay, technician, vehicle or idempotency key) is taken, instead of reading the 23P01 constraint name. Which design should the code use?

Options offered:

1. **ON CONFLICT DO NOTHING (Recommended).** Switch the insert; the repository attributes the conflict with a follow-up read; keep the 23P01 mapping as a fallback; update the guide's algorithm text, ADR-001 and the IT-07 wording.
2. **Keep plain INSERT + 23P01.** Follow the guide as written, accept rare 500s under extreme same-slot contention, and document it as a known limitation.
3. **Stop; I'll decide later.** Leave the concurrency code as committed and continue with Steps 11–13.

My answer: **ON CONFLICT DO NOTHING (Recommended)**.

What it produced: commit `0ab06bf`, the "Revision, 8 Oct 2026" section of [ADR-001](../adr/0001-database-enforced-no-overlap.md), and the updated Booking algorithm section of the guide. A full-suite stress loop then passed 30 of 30 runs.

### Collaboration docs (9 Oct 2026)

> Could you help to adjust the docs/ai-collaboration/verification-log.md and key-prompts.md according to the work ?

What it produced: this file and the entries in [verification-log.md](verification-log.md), drafted from the build session and the git history and marked by who ran each check.

## Prompts still to run

- Steps 8 and 12, reviewer subagent: "Use the reviewer subagent to review the whole repository against CLAUDE.md and the guide; report findings only". Restart Claude Code first so `/agents` lists `reviewer`.
- Step 12 STRETCH: give Gemini CLI the use case, the repositories and the concurrency tests, and ask for correctness and concurrency issues only.
