# Unified Service Scheduler

A booking service for dealership service appointments (Keyloop Technical Assessment, Scenario A). A request names a vehicle, a service type, a dealership and a start time. The service confirms it only if a service bay **and** a technician qualified for that service type are both free for the **whole** service duration, and it stores the appointment with all its associations. PostgreSQL exclusion constraints make a double booking impossible, even when many requests race for the same slot.

[![CI](https://github.com/OWNER/unified-service-scheduler/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/unified-service-scheduler/actions/workflows/ci.yml)

Video walkthrough: _link to be added_

## Requirements coverage

| Requirement | Endpoint | Code | Tests |
| --- | --- | --- | --- |
| **A1** Request an appointment for a vehicle, service type and dealership at a desired time | `POST /appointments` | [appointments.controller.ts](src/api/appointments.controller.ts), [book-appointment.use-case.ts](src/application/book-appointment.use-case.ts) | AT-A1-01 to AT-A1-06 in [a1-booking-request.spec.ts](test/acceptance/a1-booking-request.spec.ts) |
| **A2** A ServiceBay and a qualified Technician free for the entire duration | `POST /appointments` (409 when not) | [opening-hours.ts](src/domain/opening-hours.ts), [allocation.ts](src/domain/allocation.ts), [scheduling.repository.ts](src/infrastructure/repositories/scheduling.repository.ts), [migration constraints](src/infrastructure/database/migrations/0001_initial_schema.ts) | AT-A2-01 to AT-A2-07 in [a2-availability-check.spec.ts](test/acceptance/a2-availability-check.spec.ts); CT-01 to CT-03 in [booking-race.spec.ts](test/concurrency/booking-race.spec.ts); IT-01 to IT-09 in [test/integration](test/integration); UT-* in [test/unit](test/unit) |
| **A3** A persistent Appointment record associating customer, vehicle, technician and bay | `GET /appointments/{id}` | [appointment.repository.ts](src/infrastructure/repositories/appointment.repository.ts), [get-appointment.query.ts](src/application/get-appointment.query.ts) | AT-A3-01 to AT-A3-03 in [a3-appointment-record.spec.ts](test/acceptance/a3-appointment-record.spec.ts) |
| Should-haves: 409 alternatives, availability, cancel, idempotency | `GET /dealerships/{id}/availability`, `POST /appointments/{id}/cancel`, `Idempotency-Key` | [availability.ts](src/domain/availability.ts), [cancel-appointment.use-case.ts](src/application/cancel-appointment.use-case.ts), [idempotency.ts](src/api/idempotency.ts) | SH-ALT, SH-AV, SH-CAN, SH-IDEM in [test/acceptance](test/acceptance) |

Every test is named by its ID, so `npx jest -t AT-A2-03` runs exactly that case.

## Build

Prerequisites: **Node.js 24** (see [`.nvmrc`](.nvmrc)), **Docker** (for PostgreSQL and the tests), and `curl` and `jq` for the demo script.

```bash
npm ci
npm run lint && npm run typecheck && npm run build
```

## Run

```bash
docker compose up --build
```

This starts PostgreSQL 17 and the API on `http://localhost:3000`. The API container runs migrations and the idempotent seed (two fictional dealerships, bays, technicians, service types, customers and vehicles with fixed IDs from [`seed/ids.ts`](src/infrastructure/database/seed/ids.ts)) before it starts. Check it with:

```bash
curl -i localhost:3000/health/ready     # 200 when the database answers
./scripts/demo.sh                       # book, see a 409 with alternatives, read, cancel
```

If ports 5432 or 3000 are taken on your machine, set them for the host side: `DB_HOST_PORT=5433 API_HOST_PORT=3001 docker compose up --build` (and `BASE_URL=http://localhost:3001 ./scripts/demo.sh`). The database password in `docker-compose.yml` is a local development default, not a secret.

Tracing: `docker compose --profile tracing up --build` also starts Jaeger. Make a booking, then open `http://localhost:16686`.

Running the API outside Docker: start only the database (`docker compose up db`), then `npm run db:migrate && npm run db:seed && npm run start:dev`. Every setting is an environment variable, validated at startup; see [`.env.example`](.env.example).

## Test

```bash
npm test                  # everything (needs Docker: Testcontainers starts postgres:17)
npm run test:unit         # domain rules and the retry loop, no database
npm run test:integration  # constraints and repositories against PostgreSQL
npm run test:acceptance   # A1–A3 and the should-haves through HTTP
npm run test:concurrency  # parallel bookings, each scenario five times
```

The acceptance and concurrency tests start the real application in-process with a fixed clock (Mon 12 Oct 2026 09:00Z) against a throwaway PostgreSQL container, and build exactly the data they need. To use an existing database instead of Testcontainers, set `TEST_DATABASE_URL`.

## API quick tour

With the stack running (`docker compose up --build`), book a brake replacement at the seeded Northside Motors. Pick a future weekday and use `+01:00` during British Summer Time, `+00:00` otherwise:

```bash
curl -i -X POST localhost:3000/appointments -H 'Content-Type: application/json' -d '{
  "dealershipId": "8b1f0c2e-0000-4000-8000-000000000001",
  "customerId": "8b1f0c2e-0000-4000-8000-000000000101",
  "vehicleId": "8b1f0c2e-0000-4000-8000-000000000201",
  "serviceTypeId": "8b1f0c2e-0000-4000-8000-000000000302",
  "startsAt": "2026-10-20T09:00:00+01:00"
}'
```

The same slot for another customer returns `409 SLOT_UNAVAILABLE` with alternative start times, because Alex Morgan is the only brakes-qualified technician:

```bash
curl -s -X POST localhost:3000/appointments -H 'Content-Type: application/json' -d '{
  "dealershipId": "8b1f0c2e-0000-4000-8000-000000000001",
  "customerId": "8b1f0c2e-0000-4000-8000-000000000102",
  "vehicleId": "8b1f0c2e-0000-4000-8000-000000000202",
  "serviceTypeId": "8b1f0c2e-0000-4000-8000-000000000302",
  "startsAt": "2026-10-20T09:00:00+01:00"
}' | jq
```

Read the stored record with the `id` from the first response:

```bash
curl -s localhost:3000/appointments/<id> | jq
```

More: Swagger UI at `http://localhost:3000/docs` (raw spec at `/docs-json`, committed as [`openapi.yaml`](openapi.yaml)), every request in [`http/booking.http`](http/booking.http) for the VS Code REST Client, and the scripted walkthrough `./scripts/demo.sh`. Errors are RFC 9457 `application/problem+json` with a stable `code` and the `requestId`.

## Design summary

- **Four layers, enforced by lint.** A pure domain (periods, opening hours in the dealership's time zone, first-fit allocation, availability), use cases behind ports, Kysely adapters, and a thin HTTP layer. See the [system design](docs/system-design.md).
- **The database is the guarantee.** Three partial exclusion constraints stop overlapping confirmed bookings for a bay, a technician or a vehicle. Reads are lock-free optimisations; one `INSERT … ON CONFLICT DO NOTHING` is the decision. A lost race excludes that bay or technician and tries the next pair, a bounded number of times ([ADR-001](docs/adr/0001-database-enforced-no-overlap.md), [ADR-003](docs/adr/0003-allocation-strategy.md)).
- **Time is explicit.** UTC storage, half-open periods, requests must carry an offset, and opening hours are evaluated with Luxon in the dealership's IANA zone. The clock is a port, so tests are deterministic.
- **Observable.** JSON logs with request IDs and no personal data, Prometheus metrics at `/metrics`, and OpenTelemetry traces.
- **Stack.** Node.js 24, NestJS 11, PostgreSQL 17, Kysely, Luxon, Jest and Testcontainers ([ADR-002](docs/adr/0002-technology-stack.md)).

## AI Collaboration Narrative

<!-- Jeremy: write these four sections in your own words. Material to draw on:
     docs/ai-collaboration/verification-log.md, key-prompts.md, review-checklist.md,
     CLAUDE.md, .claude/ (reviewer subagent, /step command, hooks), and git history. -->

### Strategy

### Verification

### Final quality

### Scaling to a team

## Assumptions and known limitations

- The assumptions AS1–AS16 are listed in the [implementation guide](docs/implementation-guide.md#assumptions-the-code-must-implement). In short: no authentication (callers act for the customer), customers and vehicles already exist, one qualification per service type, interchangeable bays, no technician shifts or changeover buffers, and a service fits inside one local day.
- Availability and alternatives are snapshots: booking a listed start can still return 409 if someone else books it first.
- Under extreme contention for one slot, a request may wait a little while racing inserts settle. Statements aborted while waiting (deadlock victim or `lock_timeout`) are retried with jittered backoff, under their own bound of 15 retries, after which the request fails with 500 rather than a false 409.
- Times that do not exist or repeat on a daylight-saving change (01:00–02:00 in London) are outside the seeded opening hours, so they are never offered. A dealership open across a change would see its slots follow absolute time through it.
- The guardrail hook blocks Claude Code's edit tools on `test/acceptance` and `test/concurrency`, but not edits made through shell commands. The reviewer subagent and diff review cover that gap.
- Not built (out of scope): authentication, customer/vehicle/reference-data management, rescheduling, notifications, technician shifts, payments, rate limiting.

## What I would do next

- Authentication and roles, then rate limiting on booking.
- Dashboards and alerts on the booking metrics (5xx rate, `booking_conflict_retries_total`, latency SLO).
- A k6 load test of the contended-slot case, to size the pool and the retry bound.
- StrykerJS mutation testing on `src/domain` in CI.
- Rescheduling as an atomic cancel-and-book.
