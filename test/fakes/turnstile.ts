import type { TurnstileVerifier } from '../../src/modules/contact/contact.ports.js';

export class FakeTurnstile implements TurnstileVerifier {
  readonly seen: { token: string; ipHash: string }[] = [];

  constructor(private readonly accept = true) {}

  verify(token: string, ipHash: string): Promise<boolean> {
    this.seen.push({ token, ipHash });
    if (token === 'fail') return Promise.resolve(false);
    return Promise.resolve(this.accept);
  }
}
