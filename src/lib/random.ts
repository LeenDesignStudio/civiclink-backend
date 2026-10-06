import { randomBytes, randomInt, randomUUID } from 'node:crypto';

export interface RandomSource {
  uuid(): string;
  token(bytes?: number): string;
  int(max: number): number;
  float(): number;
}

export const systemRandom: RandomSource = {
  uuid: () => randomUUID(),
  token: (bytes = 32) => randomBytes(bytes).toString('base64url'),
  int: (max: number) => randomInt(0, max),
  float: () => Math.random(),
};

export class FakeRandom implements RandomSource {
  private n = 0;

  constructor(private readonly floats: number[] = [0]) {}

  uuid(): string {
    this.n += 1;
    const hex = this.n.toString(16).padStart(12, '0');
    return `00000000-0000-7000-8000-${hex}`;
  }

  token(bytes = 32): string {
    this.n += 1;
    return `tok${this.n}`.padEnd(bytes, 'x').slice(0, Math.max(bytes, 4));
  }

  int(max: number): number {
    return this.n++ % max;
  }

  float(): number {
    const value = this.floats[this.n % this.floats.length] ?? 0;
    this.n += 1;
    return value;
  }
}
