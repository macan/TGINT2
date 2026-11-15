interface CloudflareStatusContext {
  request: Request;
  env?: {
    GEMINI_API_KEY?: string;
    [key: string]: unknown;
  };
}

export const onRequest = async (context: CloudflareStatusContext): Promise<Response> => {
  const method = context.request.method.toUpperCase();
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gos-token',
      },
    });
  }
  if (method === 'HEAD') {
    return new Response(null, { status: 200 });
  }
  return new Response(
    JSON.stringify({
      available: Boolean(context.env?.GEMINI_API_KEY),
      defaultModel: 'gemini-3.1-flash-lite',
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
};
