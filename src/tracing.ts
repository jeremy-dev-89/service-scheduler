// OpenTelemetry tracing. main.ts imports this first, so the SDK patches http, express and
// pg before Nest loads them. Off unless OTEL_ENABLED=true. It reads process.env directly
// because it must run before the validated configuration exists; the same variables are
// still validated at startup in config/config.schema.ts.
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | undefined;

if (process.env.OTEL_ENABLED === 'true') {
  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318').replace(
    /\/$/,
    '',
  );
  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'unified-service-scheduler',
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // HTTP, Express and pg only: the rest adds noise (fs, dns, net) or does not apply.
        ...Object.fromEntries(
          [
            '@opentelemetry/instrumentation-fs',
            '@opentelemetry/instrumentation-dns',
            '@opentelemetry/instrumentation-net',
          ].map((name) => [name, { enabled: false }]),
        ),
      }),
    ],
  });
  sdk.start();
}

/** Flushes pending spans and stops the SDK. Safe to call when tracing is off. */
export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}
