const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isIpv4(value: string): boolean {
  if (!IPV4.test(value)) return false;
  return value.split('.').every((part) => {
    const octet = Number(part);
    return octet >= 0 && octet <= 255 && String(octet) === part;
  });
}

function isIpv6(value: string): boolean {
  return value.length <= 45 && value.includes(':') && /^[0-9a-f:]+$/i.test(value);
}

export function isIpAddress(value: string): boolean {
  return isIpv4(value) || isIpv6(value);
}

/** Loopback and private hops are the nginx / Next proxy, not a visitor. */
export function isProxyHop(ip: string): boolean {
  const value = ip.trim().toLowerCase();
  if (value === '::1' || value === '::' || value === '0.0.0.0') return true;
  const mapped = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
  if (mapped.startsWith('127.') || mapped.startsWith('10.') || mapped.startsWith('192.168.')) return true;
  const parts = mapped.split('.');
  if (parts[0] === '172') {
    const second = Number(parts[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
}

/** Rightmost address that is not a local proxy hop. A spoofed left-hand address is ignored. */
export function clientFromForwarded(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => isIpAddress(part));
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const ip = parts[index];
    if (ip && !isProxyHop(ip)) return ip;
  }
  return null;
}

function oneIp(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const ip = raw?.trim();
  return ip && isIpAddress(ip) ? ip : undefined;
}

export interface ClientIpInput {
  socketAddress: string | undefined;
  requestIp: string | undefined;
  forwardedFor: string | string[] | undefined;
  realIp: string | string[] | undefined;
  stampedIp: string | string[] | undefined;
}

/**
 * Visitor address for the auth limiter.
 * A localhost connection may pass the client in x-civiclink-client-ip (set by the Next app)
 * or in the forwarded headers. A direct connection cannot. A missing visitor is null so the
 * shared proxy address is not used as one bucket for everybody.
 */
export function authClientIp(input: ClientIpInput): string | null {
  const socket = input.socketAddress?.trim();
  const fromProxy = !socket || isProxyHop(socket);
  if (fromProxy) {
    const stamped = oneIp(input.stampedIp);
    if (stamped && !isProxyHop(stamped)) return stamped;
    const real = oneIp(input.realIp);
    if (real && !isProxyHop(real)) return real;
    const forwarded = clientFromForwarded(Array.isArray(input.forwardedFor) ? input.forwardedFor[0] : input.forwardedFor);
    if (forwarded) return forwarded;
  }
  const seen = input.requestIp?.trim();
  if (seen && isIpAddress(seen) && !isProxyHop(seen)) return seen;
  return null;
}
