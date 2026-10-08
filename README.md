# unified-service-scheduler

[![CI](https://github.com/OWNER/unified-service-scheduler/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/unified-service-scheduler/actions/workflows/ci.yml)

Service appointment scheduler for the Keyloop Technical Assessment, Scenario A.

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

More: Swagger UI at <http://localhost:3000/docs> (raw spec at `/docs-json`, committed as [`openapi.yaml`](openapi.yaml)), every request in [`http/booking.http`](http/booking.http) for the VS Code REST Client, and the scripted walkthrough `./scripts/demo.sh`.
