import type { ContactTopic, StoredContactMessage } from './contact.dto.js';

export interface TurnstileVerifier {
  verify(token: string, ipHash: string): Promise<boolean>;
}

export interface NewContactMessage {
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
  ipHash: string;
  createdAt: Date;
}

export interface ContactRepo {
  insert(row: NewContactMessage): Promise<StoredContactMessage>;
}

export interface ContactQueue {
  enqueue(name: 'email.contact', payload: { contactMessageId: string }): Promise<void>;
}
