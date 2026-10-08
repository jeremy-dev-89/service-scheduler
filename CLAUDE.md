# CLAUDE.md: Unified Service Scheduler

## Purpose
Backend for the Keyloop Technical Assessment, Scenario A. The source of truth for requirements, design and step order is docs/implementation-guide.md. Requirement IDs: A1 booking request; A2 bay and qualified technician free for the whole duration; A3 persistent Appointment record.

## How we work
- One step of the implementation guide per session. Start with a written plan and wait for my approval before editing any file.
- Small commits, one logical change each, Conventional Commits (feat:, fix:, test:, docs:, chore:).
- When I correct your plan or code, propose a one-line entry for docs/ai-collaboration/verification-log.md. I confirm or edit it.
- If a requirement is ambiguous, or this file conflicts with the guide, stop and ask. Never invent behaviour.
- Never add a dependency without naming it and the reason in the plan.

## Architecture rules
- src/domain: pure TypeScript plus luxon. No imports from @nestjs/*, kysely, pg or other layers.
- src/application: use cases and port interfaces. No kysely, pg, infrastructure or api imports.
- src/infrastructure: Kysely repositories, migrations, observability. Implements the ports.
- src/api: controllers, DTOs, error mapping. No SQL.
- Business rules read time from the Clock port, never new Date() or DateTime.now().

## Domain rules (change only with my approval)
- Entity names: Dealership, ServiceBay, Technician, ServiceType, Customer, Vehicle, Appointment.
- Store timestamptz in UTC. The API requires ISO 8601 with an offset. Periods are half-open [start, end).
- Only CONFIRMED appointments block a bay, technician or vehicle.
- PostgreSQL exclusion constraints are the no-overlap guarantee. Application checks are optimisations.
- Errors are RFC 9457 problem details using the codes listed in the guide.

## Hard rules
- Never edit, delete, skip or weaken tests in test/acceptance or test/concurrency. A hook enforces this. If you think a test is wrong, stop and explain why.
- Never drop or relax a database constraint. Never edit an applied migration; add a new one.
- Never commit secrets or real personal data. Seed data is fictional.
- Never log names, emails, phone numbers or VINs.
- Do not build anything the guide lists as out of scope.

## Commands
- npm run lint | npm run typecheck | npm run build
- npm run test:unit | test:integration | test:acceptance | test:concurrency | npm test (all)
- npm run db:migrate | npm run db:seed | npm run openapi:export
- docker compose up --build | docker compose --profile tracing up

## Definition of done for a step
1. The step's tests pass and all existing tests still pass.
2. Lint and type-check are clean.
3. openapi.yaml is regenerated if the API changed.
4. Every Done-when check in the guide passes.
5. End with a summary: what changed, what I should review by hand, proposed log entries.
