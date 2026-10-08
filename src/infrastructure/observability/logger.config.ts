import type { IncomingMessage, ServerResponse } from 'node:http';
import { trace } from '@opentelemetry/api';
import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../../config/config.schema';

/** Paths polled by Docker, Prometheus and load balancers: not worth a log line each. */
const QUIET_PATHS = ['/health/live', '/health/ready', '/metrics'];

/** trace_id and span_id of the active span, so log lines join their trace. */
function activeTraceIds(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (!span) {
    return {};
  }
  const { traceId, spanId } = span.spanContext();
  return { trace_id: traceId, span_id: spanId };
}

/**
 * JSON logs to stdout via pino-http. Every line written while handling a request carries
 * `requestId`. Authorization and cookie headers are redacted and bodies are never logged,
 * so no personal data (names, emails, phone numbers, VINs) reaches the logs.
 */
export function loggerParams(
  config: AppConfig,
  assignRequestId: (req: IncomingMessage, res: ServerResponse) => string,
): Params {
  return {
    pinoHttp: {
      level: config.logLevel,
      genReqId: assignRequestId,
      customAttributeKeys: { reqId: 'requestId' },
      quietReqLogger: true,
      // Only what explains the request: no client IP, user agent or other headers.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      // Defence in depth if a serializer ever logs headers again.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[REDACTED]',
      },
      autoLogging: {
        ignore: (req) => QUIET_PATHS.some((path) => req.url?.split('?')[0] === path),
      },
      ...(config.otelEnabled ? { mixin: activeTraceIds } : {}),
    },
  };
}
