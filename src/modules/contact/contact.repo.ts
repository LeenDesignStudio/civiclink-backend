import { dbCall, type Db } from '../../db/prisma.js';
import type { ContactTopic, StoredContactMessage } from './contact.dto.js';
import type { ContactRepo as ContactStore, NewContactMessage } from './contact.ports.js';

export class ContactRepo implements ContactStore {
  constructor(private readonly db: Db) {}

  async insert(row: NewContactMessage): Promise<StoredContactMessage> {
    const created = await dbCall(() =>
      this.db.contactMessage.create({
        data: {
          name: row.name,
          email: row.email,
          topic: row.topic,
          message: row.message,
          ipHash: row.ipHash,
          createdAt: row.createdAt,
        },
        select: {
          id: true,
          name: true,
          email: true,
          topic: true,
          message: true,
          ipHash: true,
          createdAt: true,
        },
      }),
    );
    return {
      id: created.id,
      name: created.name,
      email: created.email,
      topic: created.topic as ContactTopic,
      message: created.message,
      ipHash: created.ipHash,
      createdAt: created.createdAt,
    };
  }
}
