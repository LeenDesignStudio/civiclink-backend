export type ContactTopic = 'GENERAL' | 'DATA_ACCURACY' | 'BILLING' | 'PARTNERSHIPS' | 'PRESS' | 'OTHER';

export interface ContactMessageDto {
  id: string;
  topic: ContactTopic;
  createdAt: Date;
}

export interface StoredContactMessage {
  id: string;
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
  ipHash: string;
  createdAt: Date;
}
