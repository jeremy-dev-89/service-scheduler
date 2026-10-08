# Unified Service Scheduler — Implementation Guide for Claude Code

Oct 8, 2026 · @Jeremy

## How to use this guide

This guide is the single source of truth Claude Code builds from. Commit it to the repo as `docs/implementation-guide.md` and run one step per session with `/step N`. You approve every plan before code is written, and every step ends at a checkpoint you sign off.

### One-time setup

1. Export this doc as Markdown and save it in the repo as `docs/implementation-guide.md`.
2. Install the prerequisites: Node.js 24 LTS, Docker, Git, `jq` (the hooks use it), VS Code with Claude Code.
3. Step 1 creates the guardrail files (CLAUDE.md, reviewer subagent, `/step` command, hooks) from the AI guardrails section.

### Running a step

1. Start a fresh Claude Code session, or `/clear`, so each step starts with a small, focused context.
2. Switch to plan mode (Shift+Tab) and type `/step 6`. Claude restates the goal and Done-when checks, proposes a plan, and stops.
3. Review the plan. Correct it if needed; each correction becomes a line in the verification log.
4. Approve. Claude implements in small increments while the hooks lint every edit.
5. Run the step's Done-when commands yourself rather than trusting "all tests pass".
6. Work through the step's Human checkpoint, then commit.

### Conventions in this guide

- **MUST**, **SHOULD** and **STRETCH** match the playbook's scope tiers. Claude never starts a SHOULD item before every MUST item of that step is done.
- Test IDs (UT, IT, AT, CT, SH) refer to the Test specification section.
- Each step's Prompt block can be pasted to Claude Code verbatim if you are not using `/step`.
- When this guide and the code disagree, the guide wins until you change the guide.

## Build plan at a glance

Fifteen steps across Thursday to Sunday; Monday is kept free for submission. Each step's gate is checked by commands, not by Claude's summary.

| Step | Name | Day | Tier | Gate |
| --- | --- | --- | --- | --- |
| 0 | Prepare the repository (you only) | Thu | MUST | Repo exists; this guide committed |
| 1 | Guardrails and docs skeleton | Thu | MUST | Hook blocks an edit to a locked test; CLAUDE.md approved |
| 2 | NestJS scaffold and tooling | Fri | MUST | Build, lint, type-check and unit tests green |
| 3 | Database, migrations, seed, Docker Compose | Fri | MUST | `docker compose up` gives 200 on `/health/ready` |
| 4 | Continuous integration | Fri | MUST | First green run on GitHub Actions |
| 5 | Acceptance and concurrency tests first | Fri | MUST | Tests compile, fail for the right reason, then locked |
| 6 | Domain layer | Sat | MUST | UT tests green; domain import rule passes |
| 7 | Persistence adapters | Sat | MUST | IT tests green |
| 8 | Booking use case and API | Sat | MUST | All AT and CT tests green |
| 9 | Should-have features | Sat | SHOULD | SH tests green for each feature built |
| 10 | OpenAPI and client stubs | Sat | MUST | `/docs` works; drift check in CI; `demo.sh` runs |
| 11 | Observability | Sun | MUST, traces SHOULD | Booking metrics on `/metrics`; request ID on every log line |
| 12 | Review and hardening | Sun | MUST, extras STRETCH | Every blocker and major finding fixed and logged |
| 13 | Documentation | Sun | MUST | README, SDD and ADRs complete |
| 14 | Fresh-clone verification and release | Sun | MUST | README followed word for word works; tag `v1.0.0` |

## Scope

The service must satisfy the three Scenario A requirements below, quoted from the Keyloop brief so they are never paraphrased away. Everything else is either a tier item or explicitly out of scope.

| ID | Requirement, as written in the brief | Implemented by | Proven by |
| --- | --- | --- | --- |
| A1 | Resource Constrained Booking: "Allow a user to request a service appointment for a specific vehicle, service type, and dealership at a desired time." | `POST /appointments` | AT-A1-01 to AT-A1-06 |
| A2 | Real-Time Availability Check: "Before confirming, check for the availability of both a ServiceBay and a qualified Technician for the entire service duration." | Booking use case and exclusion constraints | AT-A2-01 to AT-A2-07, CT-01 to CT-03, IT tests |
| A3 | Confirmed Appointment Record: "Upon success, create a persistent Appointment record associating the customer, vehicle, technician, and service bay." | `appointment` table, `GET /appointments/{id}` | AT-A3-01 to AT-A3-03 |

From the brief's backend option: expose a RESTful API, use a persistent database, and stub the client with an OpenAPI spec, cURL examples and a test harness. Design and code must consider scalability, performance, reliability, maintainability and observability.

### MUST

- A1–A3, with bay, technician and vehicle exclusion constraints
- `GET /appointments/{id}`, health endpoints, idempotent seed data
- OpenAPI with Swagger UI, `http/booking.http`, `scripts/demo.sh`
- Docker Compose one-command start; GitHub Actions CI
- Structured logs with request IDs; Prometheus metrics
- README, system design document, ADRs

### SHOULD

- 409 responses carrying alternative start times
- `GET /dealerships/{id}/availability`
- `POST /appointments/{id}/cancel`
- `Idempotency-Key` support on `POST /appointments`
- OpenTelemetry traces with an optional Jaeger profile

### STRETCH

- StrykerJS mutation testing on `src/domain`
- Second-opinion review with Gemini CLI

### Out of scope: Claude must not build these

Authentication and roles, customer or vehicle CRUD, reference-data admin endpoints, rescheduling, notifications, outbox events, a frontend, technician shifts or breaks, multi-day jobs, payments, rate limiting. If a step seems to need one of these, stop and ask.

## Assumptions the code must implement

AS1–AS13 come from the playbook; AS14–AS16 are new, found while writing this spec. Confirm the new ones before Step 3, because AS14 adds a database constraint.

| ID | Assumption | What the code does |
| --- | --- | --- |
| AS1 | Callers act for the customer; no authentication | No auth guard; `customerId` travels in the request body |
| AS2 | Customer and Vehicle already exist; the vehicle must belong to the customer | 404 if either is unknown; 422 `VEHICLE_NOT_OWNED_BY_CUSTOMER` |
| AS3 | Each service type has a fixed duration and one required qualification | `service_type.duration_minutes`, `required_qualification_code` |
| AS4 | Bays are interchangeable within a dealership; one vehicle per bay at a time | Any free bay of the dealership; bay exclusion constraint |
| AS5 | A technician works at one dealership, during its opening hours; no shifts | `technician.dealership_id`; availability is opening hours minus appointments |
| AS6 | Weekly opening hours in the dealership's IANA zone; a service fits inside one day | `dealership_opening_hours`; 422 `OUTSIDE_OPENING_HOURS` |
| AS7 | The request names an exact start; the time is never shifted silently | 409 `SLOT_UNAVAILABLE`, with alternatives if that SHOULD is built |
| AS8 | UTC storage; half-open periods | `tstzrange` with `'[)'` bounds; back-to-back bookings succeed |
| AS9 | First-fit allocation in a stable order | Technicians, then bays, ordered by `name`, then `id` |
| AS10 | Success confirms immediately; only CONFIRMED blocks resources | Status CONFIRMED or CANCELLED; partial exclusion constraints |
| AS11 | Start must be in the future and within a configurable horizon | 422 `START_IN_PAST` or `BEYOND_BOOKING_HORIZON`; `BOOKING_HORIZON_DAYS` |
| AS12 | No changeover buffer | `period = [start, start + duration)` |
| AS13 | Everything is scoped by dealership; single region | Composite foreign keys tie bay and technician to the appointment's dealership |
| AS14 (new) | A vehicle cannot have two overlapping confirmed appointments | Third exclusion constraint; 409 `VEHICLE_ALREADY_BOOKED` |
| AS15 (new) | Every dealership offers every service type | No dealership–service type table |
| AS16 (new) | Any start minute is accepted; suggestions use fixed steps | Availability and alternatives use `SLOT_STEP_MINUTES` (default 15) |

## Architecture and project structure

A stateless NestJS service in four layers, with dependencies pointing inwards to a framework-free domain. The layer rule is enforced by ESLint, so a violation fails CI rather than relying on review.

```mermaid
flowchart LR
  C["Stub clients<br/>Swagger UI, cURL, demo.sh, tests"] -->|HTTP JSON| API
  subgraph S["NestJS service (stateless)"]
    API["API layer<br/>controllers, DTOs, problem details"] --> APP["Application<br/>use cases, retry on conflict"]
    APP --> DOM["Domain<br/>pure booking rules"]
    APP --> INF["Infrastructure<br/>Kysely repositories, migrations"]
  end
  INF -->|SQL| DB[("PostgreSQL 17<br/>exclusion constraints")]
  S -.-> OBS["Logs, metrics, traces"]
```

### Layer rules

| Layer | Path | May import | Must not import |
| --- | --- | --- | --- |
| Domain | `src/domain` | Plain TypeScript, `luxon` | `@nestjs/*`, `kysely`, `pg`, any other layer |
| Application | `src/application` | Domain, its own port interfaces, `@nestjs/common` for DI | `kysely`, `pg`, infrastructure, api |
| Infrastructure | `src/infrastructure` | Application ports, domain, `kysely`, `pg` | api |
| API | `src/api` | Application, domain types | `kysely`, `pg`, infrastructure internals |

Enforce it with `no-restricted-imports` overrides per path in `eslint.config.mjs`.

### Technology baseline

Pin exact versions at install time and record them in ADR-002.

| Concern | Package |
| --- | --- |
| Runtime | Node.js 24 LTS, TypeScript in strict mode |
| Framework | NestJS 11 |
| Database | PostgreSQL 17 (`postgres:17` image), `btree_gist` extension |
| Data access | `kysely`, `pg` |
| Time zones | `luxon` |
| Validation | `class-validator`, `class-transformer` |
| API docs | `@nestjs/swagger`, `yaml` for the export script |
| Logging | `nestjs-pino`, `pino-http` |
| Metrics | `prom-client` |
| Tracing | `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http` |
| Tests | `jest`, `ts-jest`, `supertest`, `@testcontainers/postgresql` |
| Quality | ESLint 9 flat config, `typescript-eslint`, Prettier |

### Directory layout

```
src/
  main.ts                          # bootstrap, Swagger, shutdown hooks
  tracing.ts                       # OpenTelemetry, loaded first when OTEL_ENABLED=true
  app.module.ts
  config/config.schema.ts          # environment validation
  domain/
    types.ts                       # plain domain types
    errors.ts                      # DomainError and error codes
    period.ts                      # half-open Period value object
    opening-hours.ts               # fitsWithinOpeningHours()
    availability.ts                # computeAvailableStarts()
    allocation.ts                  # nextCandidatePair()
  application/
    ports.ts                       # repository interfaces and DI tokens
    book-appointment.use-case.ts
    get-appointment.query.ts
    get-availability.query.ts      # SHOULD
    cancel-appointment.use-case.ts # SHOULD
  infrastructure/
    database/
      database.module.ts           # Kysely provider, pool, shutdown
      database.types.ts            # table typings
      migrator.ts                  # npm run db:migrate
      migrations/0001_initial_schema.ts
      seed/seed.ts                 # idempotent seed
    repositories/
      appointment.repository.ts
      scheduling.repository.ts     # candidates, day appointments, lookups
      pg-errors.ts                 # SQLSTATE mapping
    observability/
      logger.config.ts
      metrics.ts
  api/
    appointments.controller.ts
    availability.controller.ts     # SHOULD
    health.controller.ts
    metrics.controller.ts
    dto/
    problem-details.filter.ts
test/
  helpers/                         # container, app factory, data factories, db reset
  unit/
  integration/
  acceptance/
  concurrency/
scripts/
  demo.sh
  export-openapi.ts
http/booking.http
```

## Data model

One migration creates the whole schema. Three partial exclusion constraints make overlapping confirmed bookings impossible for a bay, a technician or a vehicle. Composite foreign keys stop an appointment from using a bay or technician from another dealership. Claude must reproduce this SQL exactly in `migrations/0001_initial_schema.ts` using Kysely's `sql` template; any change needs your approval.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE dealership (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  time_zone  text NOT NULL,                 -- IANA zone, e.g. Europe/London
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dealership_opening_hours (
  dealership_id   uuid NOT NULL REFERENCES dealership(id),
  iso_day_of_week smallint NOT NULL CHECK (iso_day_of_week BETWEEN 1 AND 7), -- 1 = Monday
  opens_at        time NOT NULL,
  closes_at       time NOT NULL,
  PRIMARY KEY (dealership_id, iso_day_of_week),
  CHECK (opens_at < closes_at)
);

CREATE TABLE qualification (
  code text PRIMARY KEY,                     -- GENERAL, BRAKES, EV_HIGH_VOLTAGE
  name text NOT NULL
);

CREATE TABLE service_type (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        text NOT NULL UNIQUE,
  name                        text NOT NULL,
  duration_minutes            integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 600),
  required_qualification_code text NOT NULL REFERENCES qualification(code)
);

CREATE TABLE service_bay (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id uuid NOT NULL REFERENCES dealership(id),
  name          text NOT NULL,
  UNIQUE (dealership_id, name),
  UNIQUE (id, dealership_id)                -- target of the composite FK
);

CREATE TABLE technician (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id uuid NOT NULL REFERENCES dealership(id),
  name          text NOT NULL,
  UNIQUE (id, dealership_id)
);

CREATE TABLE technician_qualification (
  technician_id      uuid NOT NULL REFERENCES technician(id),
  qualification_code text NOT NULL REFERENCES qualification(code),
  PRIMARY KEY (technician_id, qualification_code)
);

CREATE TABLE customer (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  email      text,
  phone      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicle (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customer(id),
  vin         text NOT NULL UNIQUE CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  make        text NOT NULL,
  model       text NOT NULL,
  model_year  smallint
);

CREATE TABLE appointment (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id           uuid NOT NULL REFERENCES dealership(id),
  customer_id             uuid NOT NULL REFERENCES customer(id),
  vehicle_id              uuid NOT NULL REFERENCES vehicle(id),
  service_type_id         uuid NOT NULL REFERENCES service_type(id),
  service_bay_id          uuid NOT NULL,
  technician_id           uuid NOT NULL,
  period                  tstzrange NOT NULL,
  status                  text NOT NULL DEFAULT 'CONFIRMED'
                          CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  idempotency_key         text,
  idempotency_fingerprint text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  cancelled_at            timestamptz,

  CONSTRAINT appointment_bay_same_dealership
    FOREIGN KEY (service_bay_id, dealership_id) REFERENCES service_bay (id, dealership_id),
  CONSTRAINT appointment_technician_same_dealership
    FOREIGN KEY (technician_id, dealership_id) REFERENCES technician (id, dealership_id),
  CONSTRAINT appointment_period_half_open
    CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period)
           AND NOT lower_inf(period) AND NOT upper_inf(period)),
  CONSTRAINT appointment_cancelled_at_matches_status
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),

  CONSTRAINT appointment_no_bay_overlap
    EXCLUDE USING gist (service_bay_id WITH =, period WITH &&) WHERE (status = 'CONFIRMED'),
  CONSTRAINT appointment_no_technician_overlap
    EXCLUDE USING gist (technician_id WITH =, period WITH &&) WHERE (status = 'CONFIRMED'),
  CONSTRAINT appointment_no_vehicle_overlap
    EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (status = 'CONFIRMED')
);

CREATE UNIQUE INDEX appointment_idempotency_key_uq
  ON appointment (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX appointment_dealership_period_idx
  ON appointment USING gist (dealership_id, period) WHERE status = 'CONFIRMED';
CREATE INDEX vehicle_customer_idx ON vehicle (customer_id);
CREATE INDEX technician_qualification_code_idx ON technician_qualification (qualification_code);
```

### Working with the period column in Kysely

- Insert with the Kysely template `` sql`tstzrange(${startsAt}, ${endsAt}, '[)')`  ``, passing both bounds as `Date` values.
- Read with `lower(period) AS starts_at` and `upper(period) AS ends_at`; never parse the range string.
- Map SQLSTATE in `pg-errors.ts`: `23P01` exclusion violation (use `error.constraint` to tell bay, technician or vehicle apart), `23505` unique violation (idempotency key), `23503` foreign key violation, and `40P01` / `55P03` (deadlock victim, lock timeout) as a retryable abort.
- The booking insert is `INSERT … ON CONFLICT DO NOTHING` (changed 8 Oct 2026 after stress testing, see ADR-001): a lost race returns no row, and the repository reads which committed row holds the idempotency key, vehicle, bay or technician. The 23P01 and 23505 mappings remain for any other writer.

### Seed data

Fictional and idempotent (`ON CONFLICT DO NOTHING`), with fixed UUIDs in `seed/ids.ts` so `demo.sh`, `booking.http` and the README can reference them. The seed never creates appointments.

| Entity | Rows |
| --- | --- |
| Dealerships | Northside Motors, `Europe/London`, Mon–Fri 08:00–18:00, Sat 09:00–13:00 · Saigon Auto Service, `Asia/Ho_Chi_Minh`, Mon–Sat 07:30–17:30 |
| Qualifications | GENERAL, BRAKES, EV\_HIGH\_VOLTAGE |
| Service types | OIL\_SERVICE 60 min GENERAL · BRAKE\_REPLACEMENT 120 min BRAKES · EV\_BATTERY\_CHECK 90 min EV\_HIGH\_VOLTAGE · ANNUAL\_SERVICE 180 min GENERAL |
| Bays | Northside: Bay 1, Bay 2, Bay 3 · Saigon: Bay A, Bay B |
| Technicians | Northside: Alex Morgan (GENERAL, BRAKES), Priya Shah (GENERAL, EV\_HIGH\_VOLTAGE), Tom Reed (GENERAL) · Saigon: Minh Tran (GENERAL, BRAKES), Lan Pham (GENERAL, EV\_HIGH\_VOLTAGE) |
| Customers and vehicles | Four fictional customers, one vehicle each, VINs `SEEDVHC0000000001` to `SEEDVHC0000000004` |

## API specification

JSON over HTTP, with errors as RFC 9457 problem details carrying a stable `code`. The generated OpenAPI document must match this section; where they differ, fix the code, not this spec.

| Method | Path | Tier | Success |
| --- | --- | --- | --- |
| POST | `/appointments` | MUST | 201 + `Location` header |
| GET | `/appointments/{id}` | MUST | 200 |
| GET | `/dealerships/{dealershipId}/availability?serviceTypeId=&date=` | SHOULD | 200 |
| POST | `/appointments/{id}/cancel` | SHOULD | 200, idempotent |
| GET | `/health/live`, `/health/ready` | MUST | 200; ready returns 503 if the database is unreachable |
| GET | `/metrics` | MUST | Prometheus text format |
| GET | `/docs`, `/docs-json` | MUST | Swagger UI and raw spec |

### POST /appointments

Optional headers: `Idempotency-Key` (SHOULD, 1–128 characters) and `X-Request-Id`. `startsAt` must be ISO 8601 with an explicit offset or `Z`; a time without an offset is rejected.

```json
{
  "dealershipId": "8b1f0c2e-0000-4000-8000-000000000001",
  "customerId": "8b1f0c2e-0000-4000-8000-000000000101",
  "vehicleId": "8b1f0c2e-0000-4000-8000-000000000201",
  "serviceTypeId": "8b1f0c2e-0000-4000-8000-000000000302",
  "startsAt": "2026-10-20T09:00:00+01:00"
}
```

Response 201, also the shape returned by `GET /appointments/{id}`. Only the customer's name is returned, to keep personal data out of responses.

```json
{
  "id": "0f6c…",
  "status": "CONFIRMED",
  "startsAt": "2026-10-20T08:00:00.000Z",
  "endsAt": "2026-10-20T10:00:00.000Z",
  "localStartsAt": "2026-10-20T09:00:00+01:00",
  "localEndsAt": "2026-10-20T11:00:00+01:00",
  "dealership": { "id": "…", "name": "Northside Motors", "timeZone": "Europe/London" },
  "customer": { "id": "…", "fullName": "Sam Carter" },
  "vehicle": { "id": "…", "vin": "SEEDVHC0000000001", "make": "…", "model": "…" },
  "serviceType": { "id": "…", "code": "BRAKE_REPLACEMENT", "name": "Brake replacement", "durationMinutes": 120 },
  "serviceBay": { "id": "…", "name": "Bay 1" },
  "technician": { "id": "…", "name": "Alex Morgan" },
  "createdAt": "2026-10-08T14:03:12.000Z"
}
```

The seed UUIDs above are illustrative; the real ones live in `seed/ids.ts`.

### GET /dealerships/{dealershipId}/availability (SHOULD)

`date` is a local date in the dealership's zone. A closed day returns an empty list.

```json
{
  "dealershipId": "…",
  "serviceTypeId": "…",
  "date": "2026-10-20",
  "timeZone": "Europe/London",
  "slotStepMinutes": 15,
  "availableStarts": ["2026-10-20T08:00:00+01:00", "2026-10-20T08:15:00+01:00"]
}
```

### Error format

```json
{
  "type": "/problems/slot-unavailable",
  "title": "Requested slot is unavailable",
  "status": 409,
  "code": "SLOT_UNAVAILABLE",
  "detail": "No qualified technician and service bay are both free from 09:00 to 11:00 (Europe/London).",
  "instance": "/appointments",
  "requestId": "c0a8…",
  "alternatives": ["2026-10-20T11:00:00+01:00", "2026-10-20T11:15:00+01:00", "2026-10-20T11:30:00+01:00"]
}
```

`alternatives` appears only once that SHOULD is built. Responses use `Content-Type: application/problem+json` and never include stack traces.

| Code | Status | When |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Malformed body, invalid UUID, `startsAt` without offset; includes an `errors` array |
| `DEALERSHIP_NOT_FOUND` | 404 | Unknown dealership |
| `CUSTOMER_NOT_FOUND` | 404 | Unknown customer |
| `VEHICLE_NOT_FOUND` | 404 | Unknown vehicle |
| `SERVICE_TYPE_NOT_FOUND` | 404 | Unknown service type |
| `APPOINTMENT_NOT_FOUND` | 404 | Unknown appointment ID |
| `VEHICLE_NOT_OWNED_BY_CUSTOMER` | 422 | Vehicle belongs to another customer (AS2) |
| `START_IN_PAST` | 422 | `startsAt` is not in the future (AS11) |
| `BEYOND_BOOKING_HORIZON` | 422 | `startsAt` is beyond the horizon (AS11) |
| `OUTSIDE_OPENING_HOURS` | 422 | Closed day, or the period does not fit opening hours (AS6) |
| `SLOT_UNAVAILABLE` | 409 | No free bay and qualified technician pair for the whole period |
| `VEHICLE_ALREADY_BOOKED` | 409 | The vehicle already has an overlapping appointment (AS14) |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key sent with a different body (SHOULD) |
| `INTERNAL_ERROR` | 500 | Anything unexpected; logged with the request ID |

## Booking algorithm and concurrency

Reads find candidates without locks; the INSERT is the decision. It is `INSERT … ON CONFLICT DO NOTHING` with the exclusion constraints and the idempotency index as arbiters: PostgreSQL's speculative insertion keeps racing inserts from deadlocking (a plain INSERT livelocked under the CT tests; see ADR-001). If the insert writes nothing, another request won that resource, so the use case excludes it and tries the next pair, a bounded number of times.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant API as API layer
  participant UC as BookAppointment
  participant D as Domain rules
  participant R as Repositories
  participant DB as PostgreSQL
  C->>API: POST /appointments
  API->>API: Validate DTO (400 on failure)
  API->>UC: execute(command)
  UC->>R: Load dealership, customer, vehicle, service type
  R->>DB: SELECT
  UC->>D: Ownership, horizon, opening hours (422 on failure)
  UC->>R: Free qualified technicians, free bays
  R->>DB: SELECT (no locks)
  UC->>D: nextCandidatePair()
  loop until inserted or no pair left (max BOOKING_MAX_ATTEMPTS)
    UC->>R: insertConfirmed(pair, period)
    R->>DB: INSERT appointment
    alt success
      DB-->>R: new row
    else conflict: no row inserted
      DB-->>R: 0 rows (ON CONFLICT DO NOTHING)
      R->>DB: SELECT which resource is taken
      R-->>UC: ResourceConflict
      UC->>D: Exclude that resource, take next pair
    end
  end
  alt inserted
    UC-->>API: Appointment
    API-->>C: 201 Created
  else no pair left
    UC-->>API: SlotUnavailable
    API-->>C: 409 problem+json
  end
```

### BookAppointment, step by step

```text
bookAppointment(command, idempotencyKey?)
  0. SHOULD: if idempotencyKey exists in the database
       same request fingerprint      -> return stored appointment, 200, header Idempotent-Replayed: true
       different fingerprint         -> 422 IDEMPOTENCY_KEY_REUSED
  1. Load dealership, customer, vehicle, service type     -> 404 *_NOT_FOUND
  2. vehicle.customerId == command.customerId             -> else 422 VEHICLE_NOT_OWNED_BY_CUSTOMER
  3. period = [startsAt, startsAt + durationMinutes)
  4. startsAt > now                                       -> else 422 START_IN_PAST
     startsAt <= now + BOOKING_HORIZON_DAYS               -> else 422 BEYOND_BOOKING_HORIZON
  5. fitsWithinOpeningHours(period, hours, timeZone)      -> else 422 OUTSIDE_OPENING_HOURS
  6. vehicle has an overlapping CONFIRMED appointment     -> 409 VEHICLE_ALREADY_BOOKED (fast path)
  7. technicians = qualified and free during period, ordered by name, id
     bays        = free during period, ordered by name, id
  8. excludedTechnicians = {}, excludedBays = {}
     repeat at most BOOKING_MAX_ATTEMPTS times
       pair = nextCandidatePair(technicians, bays, excludedTechnicians, excludedBays)
       if no pair: stop
       try insertConfirmed(command, pair, period)        -> 201 Created
       (INSERT … ON CONFLICT DO NOTHING; on 0 rows the repository reads what is taken)
       idempotency key taken                             -> go back to step 0
       vehicle taken                                     -> 409 VEHICLE_ALREADY_BOOKED
       bay taken                                         -> add bay to excludedBays
       technician taken                                  -> add technician to excludedTechnicians
       aborted (40P01 deadlock victim, 55P03 timeout)    -> back off with jitter, re-read
                                                            candidates, retry (own bound of 15)
  9. 409 SLOT_UNAVAILABLE, with alternatives if that SHOULD is built
```

Rules Claude must keep:

- Each insert is a single autocommit statement: no `SELECT … FOR UPDATE`, no advisory locks, no SERIALIZABLE. It is `INSERT … ON CONFLICT DO NOTHING`, and the pool sets `lock_timeout = 2s` as a backstop.
- Steps 6 and 7 are optimisations. The constraints are the guarantee, which is why CT-01 to CT-03 exist.
- Every retry increments `booking_conflict_retries_total{resource}`.
- `nextCandidatePair` is a pure domain function: first technician not excluded, paired with first bay not excluded.

### Availability and alternatives (SHOULD)

`computeAvailableStarts` is a pure domain function. Its inputs are the local date, that weekday's opening hours, the time zone, duration, step, the dealership's bays, the qualified technicians, the day's confirmed appointments, the vehicle's busy periods (alternatives only) and `now`.

1. Build each candidate start in local time with Luxon, from opening time to closing time minus duration, every `SLOT_STEP_MINUTES`. Luxon resolves the daylight-saving offset for each one.
2. Skip candidates that are not in the future.
3. Keep a candidate when at least one bay and one qualified technician are free for its whole period, and the vehicle is free when computing alternatives.

Alternatives scan forward from the requested start, rounded up to the next step, through the rest of that day and up to `ALTERNATIVES_SEARCH_DAYS` further days. They return the first `ALTERNATIVES_COUNT` starts. Times that do not exist or repeat on a daylight-saving change are outside the seeded opening hours; note this in the SDD.

## Configuration

All settings come from environment variables, validated at startup in `config/config.schema.ts`; the app refuses to start on an invalid value. Only `.env.example` is committed.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `postgres://scheduler:scheduler@localhost:5432/scheduler` | PostgreSQL connection |
| `DB_POOL_MAX` | `10` | Connection pool size; concurrency tests use 20 |
| `BOOKING_HORIZON_DAYS` | `90` | Latest bookable start (AS11) |
| `BOOKING_MAX_ATTEMPTS` | `5` | Insert attempts before 409 |
| `SLOT_STEP_MINUTES` | `15` | Step for availability and alternatives (AS16) |
| `ALTERNATIVES_COUNT` | `3` | Alternatives in a 409 response |
| `ALTERNATIVES_SEARCH_DAYS` | `7` | Days scanned for alternatives |
| `LOG_LEVEL` | `info` | pino level |
| `OTEL_ENABLED` | `false` | Turns tracing on |
| `OTEL_SERVICE_NAME` | `unified-service-scheduler` | Service name on spans |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Jaeger OTLP endpoint for the tracing profile |

### Time source

No code calls `new Date()` or `DateTime.now()` directly for business rules. A `Clock` port in `application/ports.ts` has a `SystemClock` implementation, and tests inject a `FixedClock`. This keeps "start in the past" and horizon tests deterministic, and it is a good example of a design choice to point out in the video.

## Observability specification

Logs explain one request, metrics show the system, traces show where time goes; the request ID and trace ID join them. No personal data goes into any of the three: IDs only, no names, emails, phone numbers or VINs.

### Logs (MUST)

- `nestjs-pino` with `pino-http`; JSON to stdout.
- Request ID: take `X-Request-Id` if present, otherwise generate a UUID; echo it in the response header and include it in problem details.
- Redact `req.headers.authorization` and `req.headers.cookie`; never log request bodies.
- One `booking.decided` line per booking with `outcome`, `errorCode`, `retries`, `dealershipId`, `serviceTypeId`, `appointmentId`, `durationMs`.
- When tracing is on, a pino `mixin` adds `trace_id` and `span_id` from the active span.

### Metrics (MUST)

`prom-client` with default process metrics, exposed at `GET /metrics`. Labels never contain IDs, which keeps cardinality bounded.

| Metric | Type | Labels |
| --- | --- | --- |
| `booking_requests_total` | Counter | `outcome`: confirmed, slot\_unavailable, vehicle\_already\_booked, invalid, not\_found, error |
| `booking_conflict_retries_total` | Counter | `resource`: bay, technician |
| `booking_duration_seconds` | Histogram | none; buckets 0.005 to 2.5 s |
| `http_server_request_duration_seconds` | Histogram | `method`, `route` (template, not raw URL), `status_code` |

### Traces (SHOULD)

- `src/tracing.ts` starts the OpenTelemetry Node SDK before Nest loads, only when `OTEL_ENABLED=true`, with HTTP, Express and pg auto-instrumentation and the OTLP HTTP exporter.
- Custom spans: `booking.execute` (attributes `dealership.id`, `service_type.id`) and `booking.insert_attempt` (attributes `attempt`, `outcome`).
- Docker Compose profile `tracing` adds Jaeger (`jaegertracing/jaeger`, OTLP on 4318, UI on 16686): `docker compose --profile tracing up`.

### Health and shutdown (MUST)

- `/health/live` returns 200 while the process runs; `/health/ready` runs `SELECT 1` with a 1-second timeout and returns 503 on failure.
- `app.enableShutdownHooks()`; on shutdown, destroy the Kysely pool and flush the tracing SDK.

## Test specification

Every test is named by its ID (for example `it('AT-A2-03 rejects …')`) so the README can trace each requirement to a test. You own the AT and CT cases below: Claude turns them into code in Step 5, you review them, and then they are locked.

### Test infrastructure

- Jest projects: `unit` (no database), and `integration`, `acceptance`, `concurrency` sharing one Testcontainers `postgres:17`, started in `globalSetup` with migrations run once.
- Tables are truncated between tests. Tests build the minimum data they need with `test/helpers/factories.ts` instead of relying on the seed.
- Acceptance and concurrency tests start the Nest app in-process with a `FixedClock` at `2026-10-12T09:00:00Z` and call it through Supertest.
- Concurrency tests run each scenario 5 times with a reset in between, to expose flaky races.

### Unit (domain)

| ID | Case |
| --- | --- |
| UT-P-01 | Overlap at the start of a period is detected |
| UT-P-02 | Overlap at the end of a period is detected |
| UT-P-03 | Containment in either direction is detected |
| UT-P-04 | Identical periods overlap |
| UT-P-05 | Adjacent periods (`end == start`) do not overlap |
| UT-P-06 | Zero or negative duration is rejected |
| UT-OH-01 | A period inside opening hours fits |
| UT-OH-02 | A period ending exactly at closing time fits |
| UT-OH-03 | A period ending one minute after closing does not fit |
| UT-OH-04 | A closed day does not fit |
| UT-OH-05 | `Asia/Ho_Chi_Minh`, open 07:30–17:30: 00:30Z (07:30 local) fits, 00:00Z (07:00 local) does not |
| UT-OH-06 | `Europe/London` open 08:00–18:00 daily, around the 25 Oct 2026 clock change: 07:30Z fits on Sat 24 Oct (08:30 local) but not on Mon 26 Oct (07:30 local) |
| UT-AL-01 | `nextCandidatePair` returns the first technician and first bay in order |
| UT-AL-02 | An excluded bay is skipped; the technician is kept |
| UT-AL-03 | An excluded technician is skipped; the bay is kept |
| UT-AL-04 | No pair when every bay or every technician is excluded |
| UT-AV-01 | A free day yields every step from opening to closing minus duration |
| UT-AV-02 | Starts are excluded when every bay is busy |
| UT-AV-03 | Starts are excluded when only an unqualified technician is free |
| UT-AV-04 | Starts that are not in the future are excluded |
| UT-AV-05 | Vehicle busy periods are excluded when computing alternatives |

### Integration (database)

| ID | Case |
| --- | --- |
| IT-01 | Overlapping CONFIRMED rows on one bay fail with `23P01` on `appointment_no_bay_overlap` |
| IT-02 | Same for one technician, on `appointment_no_technician_overlap` |
| IT-03 | Same for one vehicle, on `appointment_no_vehicle_overlap` |
| IT-04 | Back-to-back rows on the same bay and technician succeed |
| IT-05 | A row overlapping a CANCELLED row succeeds |
| IT-06 | A bay from another dealership fails with `23503` on `appointment_bay_same_dealership` |
| IT-07 | The repository maps each lost race (no row inserted) to a domain conflict naming the right resource |
| IT-08 | A period with an inclusive upper bound violates `appointment_period_half_open` |
| IT-09 | Candidate queries return only free, qualified technicians and free bays, ordered by name then ID |

### Acceptance (requirements A1–A3)

| ID | Case | Expected |
| --- | --- | --- |
| AT-A1-01 | Valid request | 201, `Location` header, all six associations, `endsAt = startsAt + duration`, local times in the dealership zone |
| AT-A1-02 | Unknown dealership, customer, vehicle or service type (table-driven) | 404 with the matching `*_NOT_FOUND` code |
| AT-A1-03 | Vehicle belongs to another customer | 422 `VEHICLE_NOT_OWNED_BY_CUSTOMER` |
| AT-A1-04 | Start in the past; start beyond the horizon | 422 `START_IN_PAST`; 422 `BEYOND_BOOKING_HORIZON` |
| AT-A1-05 | Closed day; period runs past closing | 422 `OUTSIDE_OPENING_HOURS` |
| AT-A1-06 | Missing field, invalid UUID, `startsAt` without offset | 400 `VALIDATION_FAILED` as problem+json |
| AT-A2-01 | EV battery check with one EV-qualified and one general technician free | 201 with the EV-qualified technician |
| AT-A2-02 | Every bay busy for part of the period; technicians free | 409 `SLOT_UNAVAILABLE` |
| AT-A2-03 | Only qualified technician busy for the last 30 minutes; bays free | 409 `SLOT_UNAVAILABLE` |
| AT-A2-04 | Only an unqualified technician is free | 409; the unqualified technician is never assigned |
| AT-A2-05 | Starts exactly when the only bay and technician become free | 201 |
| AT-A2-06 | Overlaps a CANCELLED appointment inserted directly | 201 |
| AT-A2-07 | Same vehicle, overlapping period | 409 `VEHICLE_ALREADY_BOOKED` |
| AT-A3-01 | `GET /appointments/{id}` after booking | 200, identical to the POST response |
| AT-A3-02 | Database row after booking | Row has all six foreign keys and a half-open period |
| AT-A3-03 | Unknown appointment ID | 404 `APPOINTMENT_NOT_FOUND` |

### Concurrency

Each request uses a different customer and vehicle; otherwise the vehicle constraint decides the race and the test proves the wrong thing.

| ID | Setup | Expected |
| --- | --- | --- |
| CT-01 | 1 bay, 1 qualified technician, 50 parallel requests for one start | Exactly one 201, 49 × 409, one row |
| CT-02 | 2 bays, 2 qualified technicians, 20 parallel requests | Exactly two 201, 18 × 409, no overlap per resource |
| CT-03 | 1 bay, 3 qualified technicians, 10 parallel requests | Exactly one 201: bay contention alone |

### Should-have features

| ID | Case | Expected |
| --- | --- | --- |
| SH-ALT-01 | 409 response | `ALTERNATIVES_COUNT` starts; booking the first returns 201 |
| SH-ALT-02 | Vehicle busy later that day | Alternatives skip the vehicle's busy times |
| SH-AV-01 | Availability for a part-booked day | Steps of `SLOT_STEP_MINUTES` inside opening hours; busy windows excluded |
| SH-AV-02 | Sunday-open test dealership in `Europe/London` | Starts on 25 Oct 2026 carry `+00:00`; starts on 24 Oct carry `+01:00` |
| SH-AV-03 | Closed day | Empty list |
| SH-CAN-01 | Cancel, then rebook the slot, then cancel again | 200 CANCELLED; rebooking 201; second cancel 200 unchanged |
| SH-IDEM-01 | Same key and body twice | Same ID, one row, `Idempotent-Replayed: true` on the replay |
| SH-IDEM-02 | Same key, different body | 422 `IDEMPOTENCY_KEY_REUSED` |
| SH-IDEM-03 | 10 parallel requests with the same key | One row; every response carries the same ID |

## AI guardrails

These files turn the AI operating model into something Claude Code actually obeys: CLAUDE.md sets the rules, the reviewer subagent checks the work, `/step` enforces plan-first, and two hooks block edits to locked tests and lint every edit. Step 1 creates them exactly as written here.

### CLAUDE.md

```markdown
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
```

### Reviewer subagent: `.claude/agents/reviewer.md`

```markdown
---
name: reviewer
description: Independent read-only reviewer. Use after each implementation step to review that step's changes against CLAUDE.md and docs/implementation-guide.md.
tools: Read, Grep, Glob, Bash
---
You are a senior backend reviewer. You did not write this code and you assume nothing about it.

Review the changes for the step you are given (default: git diff HEAD~1). Use Bash only for read-only commands: git diff, git log, npm test, npm run lint, npm run typecheck.

Check, in this order:
1. Requirements: the change meets the guide's spec for this step, including error codes.
2. Concurrency: no reliance on check-then-insert; 23P01 handled per constraint; retries bounded; no locks or SERIALIZABLE.
3. Time: UTC storage, half-open periods, dealership time zone, daylight saving, Clock port used.
4. Architecture: layer import rules respected; no SQL outside infrastructure.
5. Tests: every new behaviour tested; assertions meaningful; no locked test changed.
6. Security and privacy: validated input, parameterised SQL only, no personal data in logs or responses beyond the spec.
7. Observability: new paths emit the specified logs and metrics.

Output a table with severity (blocker, major, minor), file:line, finding and suggested fix, then a one-line verdict. Never edit files.
```

### Plan-first command: `.claude/commands/step.md`

```markdown
---
description: Run one step of the implementation guide, plan first
argument-hint: <step number>
---
Read CLAUDE.md and docs/implementation-guide.md. We are working on Step $ARGUMENTS only.

1. Restate the step's goal, its tier items and its Done-when checks in a few lines.
2. Propose a plan: files to create or change, tests to add or run, new dependencies and why, risks and open questions.
3. Stop and wait for my approval. Do not edit any file before I approve.

After approval, implement in small increments and run the Done-when checks. Finish with a summary, the step's Human checkpoint items, and proposed verification-log entries for anything I corrected.
```

### Hooks: `.claude/settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-locked-tests.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/lint-edited-file.sh" }]
      }
    ]
  }
}
```

`.claude/hooks/protect-locked-tests.sh`:

```bash
#!/usr/bin/env bash
# Blocks edits to locked test suites unless .claude/tests-unlocked exists.
set -euo pipefail
file="$(jq -r '.tool_input.file_path // empty')"
case "$file" in
  */test/acceptance/*|*/test/concurrency/*)
    if [[ ! -f "$CLAUDE_PROJECT_DIR/.claude/tests-unlocked" ]]; then
      echo "Blocked: $file is a locked test. Explain why it should change and wait for approval." >&2
      exit 2
    fi
    ;;
esac
exit 0
```

`.claude/hooks/lint-edited-file.sh`:

```bash
#!/usr/bin/env bash
# Lints the TypeScript file Claude just edited and feeds failures back to Claude.
set -uo pipefail
file="$(jq -r '.tool_input.file_path // empty')"
[[ "$file" == *.ts ]] || exit 0
cd "$CLAUDE_PROJECT_DIR"
if ! output="$(npx eslint --no-warn-ignored "$file" 2>&1)"; then
  printf 'ESLint failed for %s:\n%s\n' "$file" "$output" >&2
  exit 2
fi
exit 0
```

Make both scripts executable and add `.claude/tests-unlocked` to `.gitignore`. You create that file only during Step 5, or when you approve a test change, and delete it afterwards. The hook does not catch edits made through shell commands; the reviewer subagent and your diff review cover that gap, and the README should say so honestly.

### Verification log template: `docs/ai-collaboration/verification-log.md`

```markdown
# Verification log

Real entries only, written when they happen.

| Date | Step | What I asked | What the AI produced | What I checked | Issue found | Decision |
| --- | --- | --- | --- | --- | --- | --- |
```

## Step-by-step build

Each step lists its goal, prompt, tasks, Done-when checks and your Human checkpoint. Commit at the end of every step, and never start the next step with a failing check.

### Step 0: Prepare the repository (Thu, you only)

Goal: an empty repository ready for Claude Code, with this guide inside it.

1. Create the public GitHub repo `unified-service-scheduler` with a README stub and a Node `.gitignore`, then clone it.
2. Export this guide as Markdown to `docs/implementation-guide.md`.
3. Check prerequisites: `node -v` shows 24.x, `docker version` and `jq --version` both work.
4. Decide on AS14–AS16; if you change them, edit the guide first.
5. Commit `docs: add implementation guide`.

Human checkpoint: your edits to the AI-drafted assumptions become the first verification-log entry.

### Step 1: Guardrails and docs skeleton (Thu, MUST)

Goal: the rules, reviewer, plan-first command and hooks exist before any code does.

Prompt (paste it; `/step` does not exist yet):

```text
Read docs/implementation-guide.md, the "AI guardrails" section and Step 1.
Propose a plan and wait for my approval. Then create the guardrail files
exactly as written in the guide, and the documentation skeleton.
```

1. Create `CLAUDE.md`, `.claude/agents/reviewer.md`, `.claude/commands/step.md`, `.claude/settings.json` and both hook scripts exactly as in AI guardrails; make the scripts executable.
2. Extend `.gitignore` with `node_modules`, `dist`, `coverage`, `reports`, `.env`, `.claude/tests-unlocked`. Add `.nvmrc` (24) and `.editorconfig`.
3. Create `docs/system-design.md` with these headings: Context, Assumptions, Architecture, Components, Data flow, Technology choices, Observability, Build for the future, GenAI in the design phase, Production roadmap. Paste in the two Mermaid diagrams from this guide.
4. Create ADRs: `0001-database-enforced-no-overlap.md` (Accepted; alternatives considered: row locks, SERIALIZABLE, advisory locks), `0002-technology-stack.md` (Proposed), `0003-allocation-strategy.md` (Accepted: first-fit).
5. Create `docs/ai-collaboration/verification-log.md` (template), `key-prompts.md` and `review-checklist.md`.
6. Add `test/acceptance/.gitkeep` and `test/concurrency/.gitkeep`.

Done when:

- [ ] After restarting Claude Code, `/step` appears in the command list and `/agents` lists `reviewer`
- [ ] Asking Claude to edit `test/acceptance/.gitkeep` is blocked with the "Blocked:" message

Human checkpoint: read CLAUDE.md line by line, since these are your rules. Make ADR-001's reasoning your own words. Save today's assumption stress-test prompts in `key-prompts.md`. Commit `chore: add AI guardrails and docs skeleton`.

### Step 2: NestJS scaffold and tooling (Fri, MUST)

Goal: a compiling, linted NestJS 11 app whose layer rules are enforced by tooling.

Prompt: `/step 2`

1. Scaffold NestJS 11 into the existing repo without re-initialising git and without overwriting `README.md`, `CLAUDE.md` or `docs/`.
2. TypeScript strict mode, plus `noUncheckedIndexedAccess`.
3. Create the layer folders from Architecture and project structure. Configure ESLint 9 flat config, `typescript-eslint`, Prettier, and `no-restricted-imports` overrides per layer.
4. Jest with four projects (unit, integration, acceptance, concurrency) selected by folder; `--passWithNoTests` for now.
5. npm scripts: `build`, `start`, `start:dev`, `lint`, `format`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:acceptance`, `test:concurrency`; placeholders for `db:migrate`, `db:seed`, `openapi:export`.
6. `config/config.schema.ts` validating every variable in Configuration; the `Clock` port with `SystemClock`.
7. `GET /health/live`.

Done when:

- [ ] `npm run build && npm run lint && npm run typecheck && npm run test:unit` all pass
- [ ] A temporary `import 'kysely'` in `src/domain` fails lint (then remove it)

Human checkpoint: read `package.json` and question any dependency you did not expect. Confirm the layer rule genuinely fails. Commit.

### Step 3: Database, migrations, seed, Docker Compose (Fri, MUST)

Goal: one command starts PostgreSQL with the exact schema, seed data and the API.

Prompt: `/step 3`

1. Install `kysely`, `pg`, `@types/pg`. `database.module.ts` provides a Kysely instance over a `pg` pool sized by `DB_POOL_MAX` and destroys it on shutdown.
2. `database.types.ts` with typings for every table in the Data model.
3. `migrations/0001_initial_schema.ts` reproducing the Data model SQL exactly; `down` drops in reverse order.
4. `migrator.ts` using Kysely's `Migrator` and `FileMigrationProvider`, wired to `npm run db:migrate`.
5. `seed/ids.ts` and an idempotent `seed/seed.ts`, wired to `npm run db:seed`.
6. `GET /health/ready` running `SELECT 1` with a 1-second timeout; 503 on failure.
7. Multi-stage `Dockerfile` (`node:24-alpine`), non-root user; the entrypoint runs migrate, seed, then the app.
8. `docker-compose.yml`: `db` (`postgres:17`, `pg_isready` healthcheck, named volume) and `api` (depends on a healthy `db`, port 3000). Add `.env.example`.
9. Test helpers: Testcontainers `global-setup.ts` and teardown, `reset-db.ts`, `factories.ts`.
10. First integration test: migrations apply and three constraints of type `x` exist in `pg_constraint` for `appointment`.

Done when:

- [ ] `docker compose up --build`, then `curl -i localhost:3000/health/ready` returns 200
- [ ] `docker compose exec db psql -U scheduler -c '\d appointment'` lists the three EXCLUDE constraints
- [ ] A second `docker compose up` does not duplicate seed rows
- [ ] `npm run test:integration` passes

Human checkpoint: compare the migration's constraint lines with the guide character by character. They are the most important lines in the project. Commit.

### Step 4: Continuous integration (Fri, MUST)

Goal: every push proves the build, the rules and the tests.

Prompt: `/step 4`

1. `.github/workflows/ci.yml` on push and pull request, `ubuntu-latest`: checkout, setup-node from `.nvmrc` with npm cache, `npm ci`, lint, typecheck, build, then the four test projects. Cancel superseded runs with a concurrency group.
2. Add the CI badge to the README.
3. If Testcontainers fails on the runner, fall back to a `postgres:17` service container and point `DATABASE_URL` at it.

Done when:

- [ ] A push produces a green run, and the badge shows passing

Human checkpoint: open the Actions log once and confirm the integration test really ran against PostgreSQL rather than being skipped.

### Step 5: Acceptance and concurrency tests first (Fri, MUST)

Goal: the three requirements exist as failing tests before any booking code is written.

Before starting, run `touch .claude/tests-unlocked` so the hook allows test edits.

Prompt: `/step 5`

1. `test/helpers/app-factory.ts`: builds the Nest app with a `FixedClock` at `2026-10-12T09:00:00Z`, the Testcontainers database and `DB_POOL_MAX=20`.
2. Extend `factories.ts`: dealership with hours, bays, technicians with qualifications, service types, and customers with vehicles in bulk for the CT tests.
3. One file per requirement: `test/acceptance/a1-booking-request.spec.ts`, `a2-availability-check.spec.ts`, `a3-appointment-record.spec.ts`, plus `test/concurrency/booking-race.spec.ts`.
4. Every case from the Test specification's Acceptance and Concurrency tables, each `it` named by its ID, asserting status, error `code` and database state where specified.
5. Concurrency: fire N Supertest requests with `Promise.all`, count statuses, count rows, and repeat each scenario 5 times with a reset.
6. No production code beyond what the tests need to compile.

Done when:

- [ ] `npm run test:acceptance` and `npm run test:concurrency` compile and fail, every failure being a 404 for the missing route rather than a setup or type error
- [ ] You have read every test, then run `rm .claude/tests-unlocked`
- [ ] Asking Claude to edit one of these tests is blocked again

Human checkpoint: the most important review of the week. For each test ask: could a wrong implementation pass this? Check that CT tests use distinct vehicles and that AT-A2-03 overlaps only the last 30 minutes. Log what you changed. Commit `test: add acceptance and concurrency tests for A1–A3`.

### Step 6: Domain layer (Sat, MUST)

Goal: every booking rule as a pure, unit-tested function.

Prompt: `/step 6`

1. `domain/types.ts`; `domain/errors.ts` with one `DomainError` subclass per error code in the API specification.
2. `period.ts`: half-open `Period` with `of(start, minutes)` and `overlaps`.
3. `opening-hours.ts`: `fitsWithinOpeningHours(period, weeklyHours, timeZone)` evaluated in the dealership zone with Luxon.
4. `allocation.ts`: `nextCandidatePair`.
5. `availability.ts`: `computeAvailableStarts`. It serves the SHOULD features, so it may move to Step 9 if time is short.
6. Unit tests UT-P, UT-OH and UT-AL (MUST), UT-AV (with availability).

Done when:

- [ ] `npm run test:unit` and `npm run lint` pass
- [ ] `grep -rnE 'new Date\(\)|DateTime\.now\(\)' src/domain` prints nothing

Human checkpoint: read `opening-hours.ts` and the DST tests yourself. Time zones are where AI code is most often plausible but wrong. Commit.

### Step 7: Persistence adapters (Sat, MUST)

Goal: repositories that find candidates and insert appointments, turning database errors into domain errors.

Prompt: `/step 7`

1. `application/ports.ts`: `SchedulingRepository` (booking context, free qualified technicians, free bays, vehicle overlap, day appointments), `AppointmentRepository` (insert confirmed, find by ID, find by idempotency key, cancel) and `Clock`.
2. Kysely implementations in `infrastructure/repositories`. Candidate queries use `NOT EXISTS` against CONFIRMED appointments whose `period` overlaps (`&&`) a `'[)'` range, ordered by name then ID.
3. `pg-errors.ts`: `23P01` mapped by constraint name to a bay, technician or vehicle conflict; `23505` on the idempotency index to an idempotency conflict; `23503` to an internal integrity error; `40P01` and `55P03` to a retryable abort. The booking insert itself uses `ON CONFLICT DO NOTHING` and attributes a lost race with a follow-up read (see Booking algorithm).
4. Integration tests IT-01 to IT-09.

Done when:

- [ ] `npm run test:integration` passes
- [ ] `grep -rn 'sql.raw' src` finds nothing that touches request input

Human checkpoint: read both candidate queries and confirm the overlap predicate and the `status = 'CONFIRMED'` filter. Commit.

### Step 8: Booking use case and API (Sat, MUST)

Goal: A1–A3 work end to end, and the parallel-booking tests pass.

Prompt: `/step 8`

1. `book-appointment.use-case.ts` following steps 1–9 of the Booking algorithm; the idempotency branch waits for Step 9.
2. `get-appointment.query.ts`.
3. `appointments.controller.ts`: `POST /appointments` (201 and `Location`) and `GET /appointments/:id`. DTOs use `class-validator`, plus a check that `startsAt` carries an offset.
4. `problem-details.filter.ts`: domain errors to status and code; validation errors to 400 `VALIDATION_FAILED` with an `errors` array; anything else to 500 `INTERNAL_ERROR`; `application/problem+json` with `requestId`.
5. A response mapper producing exactly the JSON in the API specification, including local times.
6. Increment `booking_requests_total` and `booking_conflict_retries_total` here; Step 11 exposes them.

Done when:

- [ ] `npm run test:acceptance` passes: every AT case
- [ ] `npm run test:concurrency` passes: every CT case, 5 iterations each
- [ ] `npm test` passes
- [ ] "Use the reviewer subagent to review Step 8" reports no blockers

Human checkpoint: read the use case line by line: retry bound, handling per constraint, no locks. Log what the first AI implementation did about concurrency and whether CT-01 failed first; it is your strongest video story. Commit `feat: book appointments with database-enforced availability`.

### Step 9: Should-have features (Sat, SHOULD)

Goal: add the four SHOULD features in order, one commit each, stopping when time runs out. If it is already late Saturday afternoon, do Step 10 first and return here.

For each feature: `touch .claude/tests-unlocked`, run `/step 9a` (or 9b, 9c, 9d) and let Claude write that feature's SH tests in `test/acceptance/`. Review them, `rm .claude/tests-unlocked`, then approve the implementation.

- **9a, 409 alternatives**: `findAlternatives` built on `computeAvailableStarts`, scanning forward across days. Tests SH-ALT-01, SH-ALT-02.
- **9b, availability endpoint**: `availability.controller.ts` and `get-availability.query.ts`. Tests SH-AV-01 to SH-AV-03.
- **9c, cancel**: `cancel-appointment.use-case.ts` and `POST /appointments/:id/cancel`, idempotent. Test SH-CAN-01.
- **9d, idempotency key**: fingerprint = SHA-256 of the body as canonical JSON (sorted keys); store key and fingerprint on insert; handle replay and the `23505` race. Tests SH-IDEM-01 to SH-IDEM-03.

Done when, per feature:

- [ ] Its SH tests pass and `npm test` passes

Human checkpoint: one `feat:` commit per feature. Anything not built goes into the README's "What I would do next".

### Step 10: OpenAPI and client stubs (Sat, MUST)

Goal: the client side is stubbed three ways, and the API contract cannot drift silently.

Prompt: `/step 10`

1. `@nestjs/swagger` decorators on controllers and DTOs, including problem-details error responses and request examples. Swagger UI at `/docs`, JSON at `/docs-json`.
2. `scripts/export-openapi.ts` writes `openapi.yaml` without a running database; wire it to `npm run openapi:export`.
3. Add to CI: `npm run openapi:export && git diff --exit-code openapi.yaml`.
4. `http/booking.http` for the VS Code REST Client: variables for base URL and seed IDs; requests for book, conflict, read, invalid input, and availability and cancel if built.
5. `scripts/demo.sh` with `curl` and `jq`: printed headings, a booking, a 409, the stored record; exits non-zero on any unexpected status. Compute the next weekday with `node -e` so it works on macOS and Linux, and allow a `DEMO_DATE` override.
6. README "API quick tour" with three cURL calls.

Done when:

- [ ] `/docs` shows every endpoint with examples and error schemas
- [ ] `./scripts/demo.sh` runs cleanly against `docker compose up`
- [ ] The drift check passes, and fails once when you change a DTO without exporting

Human checkpoint: compare `openapi.yaml` with the API specification: paths, status codes, error codes. Commit.

### Step 11: Observability (Sun, MUST; traces SHOULD)

Goal: logs, metrics and traces exactly as in the Observability specification.

Prompt: `/step 11`

1. `nestjs-pino` with request IDs, redaction and the `booking.decided` line.
2. `metrics.ts` with the four metrics, `GET /metrics`, and an HTTP duration interceptor that labels by route template.
3. SHOULD: `tracing.ts`, the two custom spans, the pino `mixin`, and a `tracing` Compose profile with Jaeger.
4. Confirm graceful shutdown closes the pool and flushes tracing.

Done when:

- [ ] After `demo.sh`, `curl -s localhost:3000/metrics | grep booking_` shows the booking metrics
- [ ] `docker compose logs api` shows JSON lines with `requestId`
- [ ] SHOULD: with `docker compose --profile tracing up`, Jaeger at `localhost:16686` shows a booking trace with insert-attempt spans

Human checkpoint: search the logs for a seeded customer name and VIN; there must be no match. Screenshot a trace for the video if built. Commit.

### Step 12: Review and hardening (Sun, MUST; extras STRETCH)

Goal: an independent review finds the problems before Keyloop does.

Prompt: first "Use the reviewer subagent to review the whole repository against CLAUDE.md and the guide; report findings only", then `/step 12` to fix what you choose.

1. You triage the findings: fix every blocker and major; minors go to the README's known limitations.
2. One commit per fix, naming the finding.
3. `npm audit --omit=dev`; resolve high and critical issues.
4. STRETCH: StrykerJS with the Jest runner, mutating `src/domain/**/*.ts`; record the score and add tests for meaningful survivors.
5. STRETCH: give Gemini CLI the use case, the repositories and the concurrency tests, ask for correctness and concurrency issues only, and log what it found.

Done when:

- [ ] No open blocker or major finding
- [ ] No high or critical runtime vulnerabilities
- [ ] `npm test` and CI are green

Human checkpoint: log every finding you rejected and why. Rejected AI advice is as strong an interview story as accepted advice. Commit.

### Step 13: Documentation (Sun, MUST)

Goal: a reviewer understands the system, runs it and sees how it was built, from the README alone.

Prompt: `/step 13`. Claude drafts structure and factual sections; you write the AI narrative and the GenAI design section in your own words.

1. README, in this order: title, summary, CI badge, video link placeholder; requirements coverage (A1–A3 to endpoint to test file); Build; Run; Test; API quick tour; design summary with links; AI Collaboration Narrative (strategy, verification, final quality, scaling to a team) as headings for you to fill; assumptions and known limitations, including the hook's shell-command gap; what I would do next.
2. Complete `docs/system-design.md` from this guide, including the build-for-the-future table that separates built from roadmap.
3. Move ADR-002 to Accepted with the pinned versions.
4. Check links with `npx markdown-link-check README.md docs/*.md docs/adr/*.md`.

Done when:

- [ ] README has Build, Run, Test and AI Collaboration Narrative headings, and you have written the narrative
- [ ] The SDD has the architecture diagram, component roles, data flow, technologies with justifications, observability strategy and the GenAI design section
- [ ] The link check passes

Human checkpoint: read the README aloud once and rewrite anything you would not say in the interview. Commit.

### Step 14: Fresh-clone verification and release (Sun, MUST)

Goal: prove a stranger can build, run and test the project with only Docker and Node.

You do this step yourself; use Claude only to diagnose failures.

1. Clone into a new folder and follow the README word for word. Every time you need knowledge the README does not give, fix the README.
2. Confirm no `.env` is committed and no secrets are in history. The local Compose database password is a development default; say so in the README.
3. After uploading the video, add its link to the README.
4. Tag `v1.0.0`, push the tag, and check CI on it.

Done when:

- [ ] From the fresh clone, `docker compose up --build` works and `npm ci && npm test` passes
- [ ] Tag `v1.0.0` exists on GitHub with a green CI run

Human checkpoint: switch to the playbook's video plan and pre-flight checklist.

## Final verification and traceability

Before Step 14 closes, every row below must point at real files and passing tests. This table also becomes the README's requirements coverage section.

| Requirement | Code | Tests | Documentation |
| --- | --- | --- | --- |
| A1 booking request | `api/appointments.controller.ts`, `application/book-appointment.use-case.ts` | AT-A1-01 to AT-A1-06 | README coverage, SDD data flow |
| A2 bay and qualified technician free for the whole duration | `domain/opening-hours.ts`, `domain/allocation.ts`, `repositories/scheduling.repository.ts`, migration constraints | AT-A2-01 to AT-A2-07, CT-01 to CT-03, IT-01 to IT-09, UT tests | ADR-001, SDD |
| A3 persistent Appointment record | `migrations/0001_initial_schema.ts`, `repositories/appointment.repository.ts`, `application/get-appointment.query.ts` | AT-A3-01 to AT-A3-03 | SDD data model |
| RESTful API and persistent database | Controllers, PostgreSQL in Docker Compose | Acceptance suite | README Run |
| Stubbed client | `openapi.yaml`, `http/booking.http`, `scripts/demo.sh` | CI drift check | README API quick tour |
| Observability | `logger.config.ts`, `metrics.ts`, `tracing.ts` | Step 11 checks | SDD observability |
| Build for the future | Whole codebase | Full suite | SDD build-for-the-future table |
| AI collaboration | `CLAUDE.md`, `.claude/`, verification log | Hooks, reviewer reports | README AI narrative, SDD GenAI section |

Final run, from a clean checkout:

```bash
npm ci
npm run lint && npm run typecheck && npm run build
npm test
npm run openapi:export && git diff --exit-code openapi.yaml
docker compose up --build -d && ./scripts/demo.sh
curl -s localhost:3000/metrics | grep booking_
docker compose down -v
```

Sources: Keyloop Technical Assessment v1.0 (PDF supplied by Keyloop) and Keyloop Technical Assessment — Execution Playbook.
