import { describe, expect, it } from 'vitest';
import { authClientIp, clientFromForwarded } from './client-ip.js';

describe('auth client IP', () => {
  it('keeps the rightmost public address and drops a spoofed one', () => {
    expect(clientFromForwarded('203.0.113.9, 198.51.100.20')).toBe('198.51.100.20');
    expect(clientFromForwarded('203.0.113.9, 127.0.0.1')).toBe('203.0.113.9');
  });

  it('uses the address stamped by Next when the socket is only the local proxy', () => {
    const ip = authClientIp({
      socketAddress: '127.0.0.1',
      requestIp: '127.0.0.1',
      forwardedFor: '127.0.0.1',
      realIp: undefined,
      stampedIp: '203.0.113.10',
    });
    expect(ip).toBe('203.0.113.10');
  });

  it('does not treat the local proxy as a visitor', () => {
    expect(
      authClientIp({
        socketAddress: '127.0.0.1',
        requestIp: '127.0.0.1',
        forwardedFor: '127.0.0.1',
        realIp: undefined,
        stampedIp: undefined,
      }),
    ).toBeNull();
  });

  it('ignores a stamped address from a connection that is not the proxy', () => {
    expect(
      authClientIp({
        socketAddress: '198.51.100.8',
        requestIp: '198.51.100.8',
        forwardedFor: '203.0.113.50',
        realIp: '203.0.113.51',
        stampedIp: '203.0.113.52',
      }),
    ).toBe('198.51.100.8');
  });
});
