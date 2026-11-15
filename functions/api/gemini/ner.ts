interface CloudflareFunctionContext {
  request: Request;
  env?: {
    GEMINI_API_KEY?: string;
    [key: string]: unknown;
  };
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gos-token',
  Allow: 'GET, POST, HEAD, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

export const onRequest = async (context: CloudflareFunctionContext): Promise<Response> => {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (method === 'HEAD') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (method !== 'POST' && method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    let rawPosts: any;
    let channelName: any;
    let customKey: string | undefined;

    if (method === 'POST') {
      const body: any = await request.json().catch(() => ({}));
      rawPosts = body?.posts;
      channelName = body?.channelName;
      customKey = body?.apiKey;
    } else {
      const url = new URL(request.url);
      const payloadParam = url.searchParams.get('payload');
      if (payloadParam) {
        try {
          const decoded = JSON.parse(payloadParam);
          if (decoded && typeof decoded === 'object') {
            rawPosts = decoded.posts;
            channelName = decoded.channelName;
            customKey = decoded.apiKey;
          }
        } catch {
          // ignore malformed payload query param
        }
      }
      if (!rawPosts) {
        const postsParam = url.searchParams.get('posts');
        if (postsParam) {
          try {
            rawPosts = JSON.parse(postsParam);
          } catch {
            rawPosts = [];
          }
        }
      }
      if (!channelName) channelName = url.searchParams.get('channelName') || undefined;
      if (!customKey) customKey = url.searchParams.get('apiKey') || undefined;
    }

    const apiKey = customKey || env?.GEMINI_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: 'Gemini API key is not configured. Falling back to local extraction.' },
        400
      );
    }

    if (!Array.isArray(rawPosts) || rawPosts.length === 0) {
      return jsonResponse({ extractions: [], engine: 'gemini' }, 200);
    }

    const inputPosts = rawPosts.slice(0, 30).map((p: any) => ({
      postKey: String(p?.postKey || ''),
      dateLabel: String(p?.dateLabel || ''),
      author: p?.author ? String(p.author) : '',
      text: String(p?.text || '').slice(0, 2400),
    }));

    const systemInstruction = `You are a strict multilingual Named Entity Recognition (NER) and Relation Extraction analyst inspecting posts from channel "${String(channelName || 'unknown')}".
For every input post, extract named entities and directed/undirected relations grounded strictly in the post text.
Allowed nerClass values (exactly 10):
- person: Named human individuals
- organization: Companies, agencies, NGOs, military units, political parties, media outlets
- nation: Sovereign states, territories, governments, geopolitical blocs
- job_position: Executive, governmental, military, judicial, or institutional titles/roles
- location: Cities, provinces, regions, districts, landmarks, geographic features
- address: Street addresses, buildings, bases, ports, airports, embassies, compounds
- event: Named summits, protests, hearings, elections, operations, clashes, disasters
- platform: Online platforms, Telegram channels, @handles, domains, URLs
- asset_law: Bills, laws, treaties, decrees, weapons, software, products, crypto assets
- financial_metric: Monetary sums, percentages, casualty/crowd counts, economic metrics

Allowed relationClass values (exactly 10):
- holds_role (person -> job_position or organization)
- affiliated_with (person/group -> organization or nation)
- located_at (actor/event -> location/address/nation)
- participated_in (actor -> event)
- targets_or_acts_on (actor -> person/organization/nation/address)
- issued_or_authored (actor -> asset_law/statement)
- cooperated_with (actor <-> actor)
- opposed_to (actor <-> actor)
- transferred_or_funded (actor -> asset/organization/nation/metric)
- operated_by (platform/address -> organization/person)

Rules:
1. Canonicalize entity names cleanly (e.g. "US" / "U.S." -> "United States" for canonical, keep exact surface span in name).
2. Always include a concise verbatim quote snippet from that post supporting each entity and relation.
3. Preserve exact postKey values.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key=${encodeURIComponent(String(apiKey))}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: JSON.stringify(inputPosts) }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                extractions: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      postKey: { type: 'STRING' },
                      entities: {
                        type: 'ARRAY',
                        items: {
                          type: 'OBJECT',
                          properties: {
                            name: { type: 'STRING' },
                            canonical: { type: 'STRING' },
                            nerClass: { type: 'STRING' },
                            quote: { type: 'STRING' },
                          },
                          required: ['name', 'canonical', 'nerClass', 'quote'],
                        },
                      },
                      relations: {
                        type: 'ARRAY',
                        items: {
                          type: 'OBJECT',
                          properties: {
                            subject: { type: 'STRING' },
                            subjectClass: { type: 'STRING' },
                            relationClass: { type: 'STRING' },
                            object: { type: 'STRING' },
                            objectClass: { type: 'STRING' },
                            quote: { type: 'STRING' },
                            confidence: { type: 'NUMBER' },
                          },
                          required: [
                            'subject',
                            'subjectClass',
                            'relationClass',
                            'object',
                            'objectClass',
                            'quote',
                            'confidence',
                          ],
                        },
                      },
                    },
                    required: ['postKey', 'entities', 'relations'],
                  },
                },
              },
              required: ['extractions'],
            },
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      return jsonResponse(
        { error: errText || `Gemini upstream returned HTTP ${geminiRes.status}` },
        geminiRes.status >= 400 ? geminiRes.status : 500
      );
    }

    const geminiJson: any = await geminiRes.json();
    const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '{"extractions":[]}';
    const parsed = JSON.parse(rawText);

    return jsonResponse({
      extractions: Array.isArray(parsed?.extractions) ? parsed.extractions : [],
      engine: 'gemini',
    });
  } catch (error: any) {
    return jsonResponse(
      { error: error?.message || 'Failed to extract entities with Gemini' },
      500
    );
  }
};
