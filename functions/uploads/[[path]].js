function errorResponse(status, message) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    }
  });
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(405, 'Method not allowed');
  if (!env?.UPLOADS) return errorResponse(503, 'Image storage is not connected');

  let key;
  try { key = decodeURIComponent(new URL(request.url).pathname.slice('/uploads/'.length)); }
  catch { return errorResponse(400, 'Invalid image path'); }
  if (!key || key.includes('..') || key.includes('\\') || key.includes('/')) return errorResponse(404, 'Not found');

  try {
    const object = await env.UPLOADS.get(key);
    if (!object) return errorResponse(404, 'Not found');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
  } catch (error) {
    console.error('MarketTech image storage error:', error?.message || error);
    return errorResponse(500, 'Could not load image');
  }
}
