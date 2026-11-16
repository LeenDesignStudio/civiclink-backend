const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * A loopback browser may sign in against this API and return to itself.
 * Any other origin stays on PUBLIC_WEB_URL.
 */
export function loopbackWebOrigin(header: string | undefined): string | undefined {
  if (!header) return undefined;
  let url: URL;
  try {
    url = new URL(header);
  } catch {
    return undefined;
  }
  if (url.username || url.password) return undefined;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (!LOCAL_HOSTS.has(url.hostname)) return undefined;
  return url.origin;
}

/** Development and test helper. Production callers use {@link loopbackWebOrigin} directly. */
export function developmentWebOrigin(appEnv: string, header: string | undefined): string | undefined {
  if (appEnv !== 'development' && appEnv !== 'test') return undefined;
  return loopbackWebOrigin(header);
}
