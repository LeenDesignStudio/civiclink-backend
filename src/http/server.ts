import { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';
import Stripe from 'stripe';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { useCSRFPrevention } from '@graphql-yoga/plugin-csrf-prevention';
import { createYoga } from 'graphql-yoga';
import { GraphQLError, Kind, NoSchemaIntrospectionCustomRule, getOperationAST, type DocumentNode } from 'graphql';
import type { Plugin } from 'graphql-yoga';
import type { GraphQLContext } from '../graphql/context.js';
import { env } from '../config/env.js';
import { Authz } from '../authz/authz.js';
import { anonymousPrincipal, type Principal } from '../authz/authz.js';
import { hashIp } from '../lib/crypto.js';
import { CODE_META, isAppError } from '../lib/errors.js';
import { logger as rootLogger } from '../lib/logger.js';
import { OPERATION_RATES, type RateGate } from '../lib/rate-limit.js';
import { REQUEST_ID, ulid } from '../lib/ulid.js';
import { depthLimitRule, limitsPlugin } from '../graphql/limits.js';
import {
  deferGraphqlOriginRejection,
  introspectionSkipsCsrf,
  rejectsDisallowedOrigin,
  skipDepthForIntrospection,
} from '../graphql/introspection.js';
import { createLoaders } from '../graphql/loaders.js';
import { maskError, requestAls } from '../graphql/errors.js';
import { schema } from '../graphql/schema.js';
import type { AppServices } from '../app/services.js';
import type { MemoryExportStore } from '../modules/sources/export.store.js';
import { registerHealthRoutes, type Readiness } from './routes/health.js';

/** GraphiQL loads an inline script, Monaco workers, and assets from unpkg. API responses keep the strict Helmet policy. */
const GRAPHIQL_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com blob:",
  "style-src 'unsafe-inline' https://unpkg.com",
  "img-src https://raw.githubusercontent.com data:",
  "font-src https://unpkg.com data:",
  "connect-src 'self' https://unpkg.com",
  "worker-src blob:",
].join('; ');

function bodyChunk(chunk: unknown): Buffer {
  if (typeof chunk === 'string') return Buffer.from(chunk);
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  throw new Error('Unexpected request body chunk');
}

function isDocumentNode(value: unknown): value is DocumentNode {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === Kind.DOCUMENT;
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export interface ServerDeps {
  services: AppServices;
  readiness: Readiness;
  rateGate: RateGate;
  resolvePrincipal?: (request: { headers: Record<string, unknown>; cookies: Record<string, string | undefined> }) => Promise<Principal>;
  devExports?: MemoryExportStore;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 100 * 1024,
    genReqId: (request) => {
      const inbound = request.headers['x-request-id'];
      return typeof inbound === 'string' && REQUEST_ID.test(inbound) ? inbound : ulid();
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    xContentTypeOptions: true,
  });
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || env.CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });
  await app.register(cookie);
  await app.register(formbody);

  app.addHook('preParsing', async (request, _reply, payload) => {
    if (request.url.split('?')[0] !== '/webhooks/stripe') return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(bodyChunk(chunk));
    }
    const raw = Buffer.concat(chunks);
    request.rawBody = raw;
    return Readable.from([raw]);
  });

  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/auth/') && !path.startsWith('/admin-auth/')) return;
    await deps.rateGate.consume('auth', hashIp(request.ip));
  });

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (
      typeof origin === 'string' &&
      !env.CORS_ORIGINS.includes(origin) &&
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      request.method !== 'OPTIONS'
    ) {
      if (deferGraphqlOriginRejection(env.APP_ENV, request.method, request.url)) return;
      await reply.code(403).send({
        error: { code: 'FORBIDDEN', message: CODE_META.FORBIDDEN.defaultMessage, requestId: request.id },
      });
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? request.url.split('?')[0] ?? '';
    const quietQuery = route.startsWith('/auth/');
    rootLogger.info(
      {
        requestId: request.id,
        method: request.method,
        route: quietQuery ? route : request.url.split('?')[0],
        status: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      'request completed',
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    if (isAppError(error)) {
      const body = {
        error: {
          code: error.code,
          message: error.clientMessage(),
          requestId,
          ...(error.code === 'RATE_LIMITED' && 'retryAfterSeconds' in error
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
        },
      };
      if (error.code === 'RATE_LIMITED' && 'retryAfterSeconds' in error) {
        void reply.header('retry-after', String(error.retryAfterSeconds));
      }
      return reply.code(error.httpStatus).send(body);
    }
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (statusCode === 413) {
      return reply.code(413).send({
        error: { code: 'VALIDATION', message: 'The request is too large.', requestId },
      });
    }
    if (statusCode === 404) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: CODE_META.NOT_FOUND.defaultMessage, requestId },
      });
    }
    rootLogger.error({ requestId, err: error }, 'unhandled http error');
    Sentry.captureException(error);
    return reply.code(500).send({
      error: { code: 'INTERNAL', message: CODE_META.INTERNAL.defaultMessage, requestId },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: CODE_META.NOT_FOUND.defaultMessage, requestId: request.id },
    });
  });

  registerHealthRoutes(app, deps.readiness);
  if (deps.devExports && env.APP_ENV !== 'production' && env.APP_ENV !== 'staging') {
    const devExports = deps.devExports;
    app.get('/dev/exports/:token', async (request, reply) => {
      const token = (request.params as { token: string }).token;
      const file = devExports.read(token);
      if (!file) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: CODE_META.NOT_FOUND.defaultMessage, requestId: request.id },
        });
      }
      void reply.header('content-type', file.contentType);
      void reply.header('content-disposition', 'attachment');
      return reply.send(Buffer.from(file.body));
    });
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  app.post('/webhooks/stripe', async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!request.rawBody || typeof signature !== 'string') {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: CODE_META.BAD_REQUEST.defaultMessage, requestId: request.id },
      });
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(request.rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      rootLogger.info({ requestId: request.id, err: error }, 'stripe signature rejected');
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: CODE_META.BAD_REQUEST.defaultMessage, requestId: request.id },
      });
    }
    await deps.services.billing.acceptStripeEvent(event);
    return { received: true };
  });

  const ratePlugin: Plugin<GraphQLContext> = {
    async onExecute({ args }) {
      const document: unknown = args.document;
      const operationName: unknown = args.operationName;
      if (!isDocumentNode(document)) return;
      const operation = getOperationAST(document, typeof operationName === 'string' ? operationName : undefined);
      const selection = operation?.selectionSet.selections.find((node) => node.kind === Kind.FIELD);
      const store = requestAls.getStore();
      if (store && selection) store.operation = selection.name.value;
      if (!selection) return;
      const rate = OPERATION_RATES[selection.name.value];
      if (!rate) return;
      const context = args.contextValue;
      const key =
        context.principal.kind === 'resident'
          ? context.principal.userId
          : context.principal.kind === 'admin'
            ? context.principal.adminId
            : context.ipHash;
      await deps.rateGate.consume(rate, key);
    },
  };

  const introspectionPlugin: Plugin<GraphQLContext> = {
    onValidate({ addValidationRule, params }) {
      if (!skipDepthForIntrospection(env.APP_ENV, params.documentAST)) {
        addValidationRule(depthLimitRule());
      }
      if (!env.GRAPHQL_INTROSPECTION) addValidationRule(NoSchemaIntrospectionCustomRule);
    },
  };

  // Yoga masks execute errors only. Validation errors are reported first, and the
  // GRAPHQL_VALIDATION_FAILED code is attached after user plugins run.
  const maskValidationPlugin: Plugin<GraphQLContext> = {
    onValidate() {
      return ({ valid, result, setResult }) => {
        if (valid) return;
        setResult(
          result.map((error: unknown) => {
            const message = error instanceof Error ? error.message : 'Invalid document';
            return maskError(new GraphQLError(message, { extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }));
          }),
        );
      };
    },
  };

  const yoga = createYoga<{ reply: FastifyReply }, GraphQLContext>({
    schema,
    graphqlEndpoint: '/graphql',
    landingPage: env.APP_ENV === 'development',
    graphiql: env.APP_ENV === 'development',
    batching: false,
    logging: {
      debug() {},
      info() {},
      warn() {},
      // Yoga prints every replaced error with console.error. maskError already records it.
      error() {},
    },
    maskedErrors: {
      maskError: (error) => maskError(error),
    },
    plugins: [
      useCSRFPrevention({ requestHeaders: ['x-civiclink-csrf'] }),
      limitsPlugin(),
      introspectionPlugin,
      maskValidationPlugin,
      ratePlugin,
    ],
    context: async ({ request, reply }) => {
      const requestId = request.headers.get('x-request-id') ?? ulid();
      const cookieHeader = request.headers.get('cookie') ?? '';
      const cookies = Object.fromEntries(
        cookieHeader
          .split(';')
          .map((part) => part.trim())
          .filter((part) => part.includes('='))
          .map((part) => {
            const index = part.indexOf('=');
            return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
          }),
      );
      const principal = deps.resolvePrincipal
        ? await deps.resolvePrincipal({ headers: Object.fromEntries(request.headers), cookies })
        : anonymousPrincipal;
      const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      const ipHash = hashIp(forwarded && forwarded.length > 0 ? forwarded : '0.0.0.0');
      const userAgent = request.headers.get('user-agent') ?? undefined;
      const services = deps.services;
      const authz = new Authz(principal);
      return {
        requestId,
        principal,
        authz,
        services,
        loaders: createLoaders(services),
        ipHash,
        ...(userAgent ? { userAgent } : {}),
        reply,
      };
    },
  });

  app.route({
    url: '/graphql',
    method: ['GET', 'POST', 'OPTIONS'],
    handler: async (request, reply) => {
      const csrf = request.headers['x-civiclink-csrf'];
      const hasCsrf = typeof csrf === 'string' && csrf.length > 0;
      const introspectionOnly = introspectionSkipsCsrf({
        appEnv: env.APP_ENV,
        method: request.method,
        url: request.url,
        body: request.body,
      });
      const originHeader = request.headers.origin;
      if (
        rejectsDisallowedOrigin({
          appEnv: env.APP_ENV,
          method: request.method,
          origin: typeof originHeader === 'string' ? originHeader : undefined,
          allowedOrigins: env.CORS_ORIGINS,
          introspectionOnly,
        })
      ) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: CODE_META.FORBIDDEN.defaultMessage, requestId: request.id },
        });
      }
      if (request.method !== 'OPTIONS' && !hasCsrf && !introspectionOnly) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: CODE_META.FORBIDDEN.defaultMessage, requestId: request.id },
        });
      }
      if (request.method === 'GET' && env.APP_ENV !== 'development') {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: CODE_META.NOT_FOUND.defaultMessage, requestId: request.id },
        });
      }
      const url = `${request.protocol}://${request.hostname}${request.url}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      if (!headers.has('x-request-id')) headers.set('x-request-id', request.id);
      const init: RequestInit = { method: request.method, headers };
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        init.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});
      }
      const response = await requestAls.run({ requestId: request.id }, () =>
        yoga.fetch(new Request(url, init), { reply }),
      );
      reply.code(response.status);
      response.headers.forEach((value, key) => {
        void reply.header(key, value);
      });
      let body = await response.text();
      const contentType = response.headers.get('content-type') ?? '';
      if (env.APP_ENV === 'development' && contentType.includes('text/html')) {
        body = body.replaceAll('__TITLE__', 'CivicLink GraphQL');
        void reply.header('content-security-policy', GRAPHIQL_CONTENT_SECURITY_POLICY);
        reply.raw.setHeader('content-security-policy', GRAPHIQL_CONTENT_SECURITY_POLICY);
      }
      return reply.send(body);
    },
  });

  return app;
}
