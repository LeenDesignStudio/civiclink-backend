import { describe, expect, it } from 'vitest';
import { developmentWebOrigin, loopbackWebOrigin } from './web-origin.js';

describe('developmentWebOrigin', () => {
  it('accepts localhost only in development and test', () => {
    expect(developmentWebOrigin('development', 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(developmentWebOrigin('development', 'http://localhost:3000/admin/login')).toBe('http://localhost:3000');
    expect(developmentWebOrigin('test', 'http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
  });

  it('rejects public hosts and non-development environments', () => {
    expect(developmentWebOrigin('development', 'https://civic.leenterminal.com')).toBeUndefined();
    expect(developmentWebOrigin('development', 'https://evil.example')).toBeUndefined();
    expect(developmentWebOrigin('production', 'http://localhost:3000')).toBeUndefined();
    expect(developmentWebOrigin('staging', 'http://localhost:3000')).toBeUndefined();
    expect(developmentWebOrigin('development', undefined)).toBeUndefined();
  });

  it('accepts only a loopback origin, including when the API is the public site', () => {
    expect(loopbackWebOrigin('http://localhost:3000/signin')).toBe('http://localhost:3000');
    expect(loopbackWebOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(loopbackWebOrigin('https://civic.leenterminal.com')).toBeUndefined();
    expect(loopbackWebOrigin('http://localhost.evil.example')).toBeUndefined();
    expect(loopbackWebOrigin('http://user:pass@localhost:3000')).toBeUndefined();
    expect(loopbackWebOrigin(undefined)).toBeUndefined();
  });
});
