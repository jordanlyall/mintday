// Lightweight Sentry error reporting for Vercel serverless functions
// No framework SDK needed — just the Node SDK

import * as Sentry from "@sentry/node";

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.VERCEL_ENV || "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 1.0,
  });
}

export { Sentry };

export function captureError(err: unknown, context?: Record<string, string>) {
  if (!SENTRY_DSN) {
    console.error("[sentry-disabled]", err);
    return;
  }
  if (context) {
    Sentry.setContext("mint.day", context);
  }
  Sentry.captureException(err);
}
