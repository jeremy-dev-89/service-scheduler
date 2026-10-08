import { type Kysely, sql } from 'kysely';

// Reproduces the Data model SQL in docs/implementation-guide.md exactly.
// Never edit this migration once applied; add a new one instead.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
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
`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
DROP TABLE appointment;
DROP TABLE vehicle;
DROP TABLE customer;
DROP TABLE technician_qualification;
DROP TABLE technician;
DROP TABLE service_bay;
DROP TABLE service_type;
DROP TABLE qualification;
DROP TABLE dealership_opening_hours;
DROP TABLE dealership;
DROP EXTENSION IF EXISTS btree_gist;
`.execute(db);
}
