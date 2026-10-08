# System design: Unified Service Scheduler

> Skeleton created in Step 1. Completed in Step 13.

## Context

## Assumptions

## Architecture

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

## Components

## Data flow

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
    else 23P01 on bay or technician constraint
      DB-->>R: exclusion_violation
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

## Technology choices

## Observability

## Build for the future

## GenAI in the design phase

## Production roadmap
