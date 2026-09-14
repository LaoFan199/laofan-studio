// Only return to the app document; never accept external or login redirects.
export function safeReturnTo(value, base) {
  const fallback = new URL('./', base);
  try {
    const target = new URL(value || './', base);
    if (target.origin !== fallback.origin || ![fallback.pathname, fallback.pathname + 'index.html'].includes(target.pathname)) return fallback.href;
    return target.href;
  } catch { return fallback.href; }
}
