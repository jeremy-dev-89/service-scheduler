# ADR-002: Technology stack

- Status: Proposed
- Date: 2026-10-08

## Context

The brief asks for a RESTful backend with a persistent database, a stubbed client (OpenAPI, cURL, test harness), and attention to scalability, reliability, maintainability and observability.

## Decision

| Concern | Choice |
| --- | --- |
| Runtime | Node.js 24 LTS, TypeScript in strict mode |
| Framework | NestJS 11 |
| Database | PostgreSQL 17 with `btree_gist` |
| Data access | Kysely over `pg` |
| Time zones | Luxon |
| Validation | class-validator, class-transformer |
| API docs | @nestjs/swagger, yaml |
| Logging | nestjs-pino, pino-http |
| Metrics | prom-client |
| Tracing | OpenTelemetry Node SDK, OTLP HTTP exporter |
| Tests | Jest, ts-jest, Supertest, Testcontainers |
| Quality | ESLint 9 flat config, typescript-eslint, Prettier |

Exact pinned versions are recorded here when this ADR moves to Accepted in Step 13.

## Consequences

To be completed in Step 13.
