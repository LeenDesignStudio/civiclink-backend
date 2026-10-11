import { dbCall, type Db } from '../../db/prisma.js';
import type { StoredContactMessage } from './contact.dto.js';
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
      topic: created.topic,
      message: created.message,
      ipHash: created.ipHash,
      createdAt: created.createdAt,
    };
  }

  async findForDelivery(id: string): Promise<{
    name: string;
    email: string;
    topic: string;
    message: string;
    emailedAt: Date | null;
  } | null> {
    return dbCall(() =>
      this.db.contactMessage.findUnique({
        where: { id },
        select: { name: true, email: true, topic: true, message: true, emailedAt: true },
      }),
    );
  }

  async markEmailed(id: string, at: Date): Promise<void> {
    await dbCall(() => this.db.contactMessage.update({ where: { id }, data: { emailedAt: at } }));
  }
}
