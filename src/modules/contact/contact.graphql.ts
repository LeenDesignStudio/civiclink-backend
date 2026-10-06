import { builder, rememberScope } from '../../graphql/builder.js';
import type { ContactMessageDto, ContactTopic } from './contact.dto.js';
import { ContactService } from './contact.service.js';
import { withoutNulls } from '../follows/relay.graphql.js';

const publicScope = { public: true };

const ContactTopicEnum = builder.enumType('ContactTopic', {
  values: ['GENERAL', 'DATA_ACCURACY', 'BILLING', 'PARTNERSHIPS', 'PRESS', 'OTHER'] as const satisfies readonly ContactTopic[],
});

const ContactMessageType = builder.objectRef<ContactMessageDto>('ContactMessage').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    topic: t.expose('topic', { type: ContactTopicEnum }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
  }),
});

const ContactPayload = builder
  .objectRef<{ contactMessage: ContactMessageDto }>('SubmitContactMessagePayload')
  .implement({
    fields: (t) => ({
      contactMessage: t.expose('contactMessage', { type: ContactMessageType }),
    }),
  });

const ContactInput = builder.inputType('SubmitContactMessageInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    email: t.string({ required: true }),
    topic: t.field({ type: ContactTopicEnum, required: true }),
    message: t.string({ required: true }),
    consent: t.boolean({ required: true }),
    turnstileToken: t.string({ required: true }),
  }),
});

function contact(ctx: { services: unknown }): ContactService {
  return (ctx.services as { contact: ContactService }).contact;
}

builder.mutationField('submitContactMessage', (t) =>
  t.field({
    type: ContactPayload,
    authScopes: publicScope,
    args: { input: t.arg({ type: ContactInput, required: true }) },
    resolve: (_root, args, ctx) => contact(ctx).submitContactMessage(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'submitContactMessage', publicScope);
