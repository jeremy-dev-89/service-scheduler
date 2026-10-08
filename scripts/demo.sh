#!/usr/bin/env bash
# Walks through the API against a running instance (docker compose up --build).
# Books a slot, shows a 409 with alternatives, reads the stored record, then cancels
# the booking so the demo can run again. Exits non-zero on any unexpected status.
#
#   ./scripts/demo.sh                      # next weekday in Europe/London
#   DEMO_DATE=2026-10-20 ./scripts/demo.sh # a specific date (YYYY-MM-DD)
#   BASE_URL=http://localhost:3001 ./scripts/demo.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

# Fixed seed IDs (src/infrastructure/database/seed/ids.ts).
NORTHSIDE_MOTORS=8b1f0c2e-0000-4000-8000-000000000001
SAM_CARTER=8b1f0c2e-0000-4000-8000-000000000101
SAM_CARTER_FOCUS=8b1f0c2e-0000-4000-8000-000000000201
JORDAN_BLAKE=8b1f0c2e-0000-4000-8000-000000000102
JORDAN_BLAKE_MODEL3=8b1f0c2e-0000-4000-8000-000000000202
BRAKE_REPLACEMENT=8b1f0c2e-0000-4000-8000-000000000302

for tool in curl jq node; do
  command -v "$tool" > /dev/null || { echo "demo.sh needs $tool on the PATH" >&2; exit 1; }
done

# Next weekday in the dealership's zone; node keeps this portable across macOS and Linux.
DEMO_DATE="${DEMO_DATE:-$(node -e '
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  for (let days = 1; days <= 7; days += 1) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(Date.now() + days * 864e5))
      .map(({ type, value }) => [type, value]));
    if (p.weekday !== "Sat" && p.weekday !== "Sun") { console.log(`${p.year}-${p.month}-${p.day}`); break; }
  }')}"

# London's UTC offset on that date (+00:00 in winter, +01:00 in summer).
OFFSET="$(node -e '
  const [y, m, d] = process.argv[1].split("-").map(Number);
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "longOffset" })
    .formatToParts(new Date(Date.UTC(y, m - 1, d, 12))).find((p) => p.type === "timeZoneName").value;
  console.log(name === "GMT" ? "+00:00" : name.slice(3));' "$DEMO_DATE")"
STARTS_AT="${DEMO_DATE}T09:00:00${OFFSET}"

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

heading() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# call METHOD PATH EXPECTED_STATUS [JSON_BODY]
call() {
  local method=$1 path=$2 expected=$3 body=${4:-}
  local args=(-sS -o "$BODY_FILE" -w '%{http_code}' -X "$method" "$BASE_URL$path")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  local status
  status="$(curl "${args[@]}")"
  echo "$method $path -> $status"
  if [[ "$status" != "$expected" ]]; then
    echo "Expected $expected but got $status:" >&2
    cat "$BODY_FILE" >&2
    echo >&2
    exit 1
  fi
}

booking() {
  jq -n --arg d "$NORTHSIDE_MOTORS" --arg c "$1" --arg v "$2" --arg s "$BRAKE_REPLACEMENT" \
    --arg t "$STARTS_AT" \
    '{dealershipId: $d, customerId: $c, vehicleId: $v, serviceTypeId: $s, startsAt: $t}'
}

heading "Service is ready"
call GET /health/ready 200

heading "Book a brake replacement at Northside Motors, $STARTS_AT"
call POST /appointments 201 "$(booking "$SAM_CARTER" "$SAM_CARTER_FOCUS")"
APPOINTMENT_ID="$(jq -r .id "$BODY_FILE")"
jq '{id, status, localStartsAt, localEndsAt, serviceBay: .serviceBay.name, technician: .technician.name}' "$BODY_FILE"

heading "Same slot for another customer: the only brakes technician is taken"
call POST /appointments 409 "$(booking "$JORDAN_BLAKE" "$JORDAN_BLAKE_MODEL3")"
jq '{status, code, detail, alternatives}' "$BODY_FILE"

heading "Read the stored appointment"
call GET "/appointments/$APPOINTMENT_ID" 200
jq . "$BODY_FILE"

heading "Availability for brake replacement on $DEMO_DATE"
call GET "/dealerships/$NORTHSIDE_MOTORS/availability?serviceTypeId=$BRAKE_REPLACEMENT&date=$DEMO_DATE" 200
jq '{timeZone, slotStepMinutes, count: (.availableStarts | length), first: .availableStarts[0:3]}' "$BODY_FILE"

heading "Cancel the booking (keeps the demo repeatable)"
call POST "/appointments/$APPOINTMENT_ID/cancel" 200
jq '{id, status}' "$BODY_FILE"

heading "Done"
