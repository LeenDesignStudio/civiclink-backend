import type { FastifyReply } from 'fastify';
import type { Authz, Principal } from '../authz/authz.js';
import type { AppServices } from '../app/services.js';
import type { Loaders } from './loaders.js';

export interface GraphQLContext {
  requestId: string;
  principal: Principal;
  authz: Authz;
  services: AppServices;
  loaders: Loaders;
  ipHash: string;
  userAgent?: string;
  reply: FastifyReply;
}

export interface ServiceContext {
  requestId: string;
  principal: Principal;
  authz: Authz;
  ipHash: string;
  userAgent?: string;
}
