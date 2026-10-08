# ADR-002: Technology stack

- Status: Accepted
- Date: 2026-10-08

## Context

The brief asks for a RESTful backend with a persistent database, a stubbed client (OpenAPI, cURL, test harness), and attention to scalability, reliability, maintainability and observability. The core rule (no overlapping bookings for a bay, technician or vehicle) must hold under concurrency, so the database's ability to enforce it matters more than any framework feature.

## Decision

Versions are pinned exactly in `package.json` (`save-exact=true` in `.npmrc`).

| Concern | Choice | Pinned version |
| --- | --- | --- |
| Runtime | Node.js 24 LTS | `.nvmrc` = 24; Docker `node:24-alpine` |
| Language | TypeScript, strict + `noUncheckedIndexedAccess` | typescript 5.9.3 |
| Framework | NestJS 11 | @nestjs/common, core, platform-express, testing 11.2.7; @nestjs/cli 11.0.24 |
| Database | PostgreSQL 17 with `btree_gist` | Docker `postgres:17` |
| Data access | Kysely over `pg` | kysely 0.28.17, pg 8.23.1 |
| Time zones | Luxon | luxon 3.7.2 |
| Validation | class-validator, class-transformer | 0.15.1, 0.5.1 |
| API docs | @nestjs/swagger, yaml | 11.4.7 (js-yaml overridden to 5.4.3), yaml 2.9.1 |
| Logging | nestjs-pino, pino-http, pino | 5.3.1, 11.0.0, 10.4.0 |
| Metrics | prom-client | 15.1.3 |
| Tracing | OpenTelemetry Node SDK, auto-instrumentations, OTLP HTTP exporter, API | 0.223.0, 0.81.0, 0.223.0, 1.9.1 |
| Tests | Jest, ts-jest, Supertest, Testcontainers | 30.5.2, 29.4.14, 7.3.1, @testcontainers/postgresql 12.2.0 |
| Scripts | ts-node | 10.9.2 (`db:migrate`, `db:seed`, `openapi:export` from source) |
| Quality | ESLint 9 flat config, typescript-eslint, Prettier | 9.39.5, 8.71.1, 3.9.9 |

### Versions chosen below the latest, and why

- **NestJS 11, not 12.** The guide specifies NestJS 11. 11.2.7 is the latest 11.x.
- **TypeScript 5.9, not 7.** TypeScript 7 is the native compiler and ts-jest supports `<7`.
- **Kysely 0.28.17, not 0.29.** 0.29 is ESM-only, which Jest's CommonJS runtime cannot load without extra transforms. 0.28.17 was published the same day as 0.29.6 and still ships CommonJS, so its file migration provider works under Jest, ts-node and the compiled build alike.
- **js-yaml override.** @nestjs/swagger 11.4.7 pins js-yaml 5.3.0, which has a moderate advisory (GHSA-r3ph-w7gj-g6xm). An npm `overrides` entry moves it to 5.4.3 within the same major; `npm audit --omit=dev` reports no vulnerabilities.

## Consequences

- PostgreSQL range types and exclusion constraints carry the no-overlap guarantee ([ADR-001](0001-database-enforced-no-overlap.md)); the service is tied to PostgreSQL by design.
- Kysely keeps the important SQL (`tstzrange`, `&&`, `ON CONFLICT DO NOTHING`, `NOT EXISTS`) visible and type-checked instead of hidden behind an ORM.
- NestJS DI makes the ports-and-adapters split cheap and lets tests swap the clock and other adapters.
- Testcontainers runs the integration, acceptance and concurrency suites against a real PostgreSQL 17, which is necessary because the constraints cannot be mocked. Tests therefore need Docker.
- Upgrading to NestJS 12, Kysely 0.29 (ESM) or TypeScript 7 is a deliberate future step, not a drop-in change.
