import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

// Shared server-side Gemini client helper
function getGeminiClient(customApiKey?: string): GoogleGenAI | null {
  const key = customApiKey || process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Server API Routes for Gemini
// ---------------------------------------------------------------------------

// Check server-side Gemini key availability
app.get('/api/gemini/status', (_req, res) => {
  const hasServerKey = !!process.env.GEMINI_API_KEY;
  res.json({
    available: hasServerKey,
    defaultModel: 'gemini-3.1-flash-lite',
  });
});

// Topic clustering & editorial title extraction using gemini-3.1-flash-lite
app.post('/api/gemini/cluster', async (req, res) => {
  try {
    const { samplePosts, dateRange, apiKey: customKey } = req.body;
    const ai = getGeminiClient(customKey);

    if (!ai) {
      return res.status(400).json({
        error: 'Gemini API key is not configured. Please attach a key in Settings > Secrets or provide a key in the app.',
      });
    }

    if (!Array.isArray(samplePosts) || samplePosts.length === 0) {
      return res.json({ clusters: [] });
    }

    const prompt = `You are an expert news intelligence analyst.
Analyze these ${samplePosts.length} Telegram posts from time range "${dateRange}".
Task:
1. Cluster related posts into distinct high-impact news topics or thematic developments based on semantic meaning, news events, and link preview metadata.
2. For each cluster, write:
   - "title": A concise, informative, human-grade editorial headline (6 to 12 words, title case). Reflect the key person, entity, action, or fact. Do NOT use generic labels like "Tech News".
   - "titleZh": If the title is NOT in English or Chinese (e.g. Russian, Arabic, Japanese, Korean, French, German, Spanish, etc.), provide an accurate, natural Chinese translation of the title. If the title is already in English or Chinese, set this to null.
   - "summary": A crisp 1-2 sentence briefing of the topic.
   - "category": One of "Tech", "Business", "World", "Crypto", "Science", "Culture", "Security", or "General".
   - "keywords": 3 to 5 key entity keywords or hashtags.
   - "persons": Up to 2 key person names mentioned.
   - "entities": Up to 3 key organizations, products, or tokens.
   - "facts": Up to 2 key metrics, numbers, or verified facts.
   - "options": Key choices, poll questions, or viewpoints debated (if applicable).
   - "postIds": Array of post IDs belonging to this cluster.
Output MUST be a valid JSON array of clusters:
[
  {
    "title": "string",
    "titleZh": "string or null",
    "summary": "string",
    "category": "string",
    "keywords": ["string"],
    "persons": ["string"],
    "entities": ["string"],
    "facts": ["string"],
    "options": ["string"],
    "postIds": ["string"]
  }
]`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: [
        {
          parts: [
            { text: prompt },
            { text: JSON.stringify(samplePosts) },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const rawText = response.text || '[]';
    let parsed: any[] = [];
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = [];
    }

    res.json({ clusters: Array.isArray(parsed) ? parsed : [] });
  } catch (error: any) {
    console.error('Gemini cluster error:', error);
    res.status(500).json({
      error: error?.message || 'Failed to cluster posts with Gemini',
    });
  }
});

// General text generation endpoint
app.post('/api/gemini/generate', async (req, res) => {
  try {
    const { prompt, model = 'gemini-3.8-flash', systemInstruction, apiKey: customKey } = req.body;
    const ai = getGeminiClient(customKey);

    if (!ai) {
      return res.status(400).json({ error: 'Gemini API key is not configured.' });
    }

    const config: any = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: Object.keys(config).length > 0 ? config : undefined,
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error('Gemini generate error:', error);
    res.status(500).json({ error: error?.message || 'Failed to generate content' });
  }
});

// Streaming generation endpoint (SSE)
app.post('/api/gemini/generate-stream', async (req, res) => {
  try {
    const { prompt, model = 'gemini-3.8-flash', systemInstruction, apiKey: customKey } = req.body;
    const ai = getGeminiClient(customKey);

    if (!ai) {
      return res.status(400).json({ error: 'Gemini API key is not configured.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const config: any = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;

    const stream = await ai.models.generateContentStream({
      model,
      contents: prompt,
      config: Object.keys(config).length > 0 ? config : undefined,
    });

    for await (const chunk of stream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('Gemini stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error?.message || 'Streaming failed' });
    } else {
      res.write(`data: ${JSON.stringify({ error: error?.message })}\n\n`);
      res.end();
    }
  }
});

// ---------------------------------------------------------------------------
// Server Proxy Routes for Listen Scrape Queue & SystemOne
// ---------------------------------------------------------------------------

app.all('/api/lq/:channel', async (req, res) => {
  try {
    const channel = req.params.channel;
    const url = `https://i.gogingko.net/api/v1/lq/${encodeURIComponent(channel)}`;
    const headers: Record<string, string> = {};
    if (req.headers['x-gos-token']) {
      headers['x-gos-token'] = String(req.headers['x-gos-token']);
    }
    const response = await fetch(url, {
      method: 'PUT',
      headers,
    });
    const data = await response.text();
    res.status(response.status).type('application/json').send(data);
  } catch (err: any) {
    console.warn('Proxy /api/lq error:', err);
    res.status(502).json({ error: 'Failed to proxy scrape request' });
  }
});

app.post('/api/systemone', async (req, res) => {
  try {
    const response = await fetch('https://kev.gogingko.net/v1/systemone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.text();
    res.status(response.status).type('application/json').send(data);
  } catch (err: any) {
    console.warn('Proxy /api/systemone error:', err);
    res.status(502).json({ error: 'Failed to proxy SystemOne request' });
  }
});

// Endpoint to translate non-English, non-Chinese topic titles into Chinese
app.post('/api/translate-titles', async (req, res) => {
  try {
    const { titles, apiKey: customKey } = req.body;
    if (!Array.isArray(titles) || titles.length === 0) {
      return res.json({ translations: {} });
    }

    const translations: Record<string, string> = {};
    const unhandled: string[] = [];

    // 1. Try Gemini first if key available
    const ai = getGeminiClient(customKey);
    if (ai) {
      try {
        const prompt = `Translate each of the following foreign-language headlines into concise, natural Chinese (Simplified Chinese).
If a headline is already in Chinese or English, you can leave it empty or return the Chinese translation.
Output MUST be a strict JSON object mapping each original title to its Chinese translation:
{
  "original title": "Chinese translation"
}

Headlines:
${JSON.stringify(titles)}`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });

        const raw = response.text || '{}';
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string' && v.trim()) {
              translations[k] = v.trim();
            }
          }
        }
      } catch (e) {
        console.warn('Gemini translate-titles error, using fallback:', e);
      }
    }

    // 2. Fallback for any unhandled titles using MyMemory Neural MT
    for (const title of titles) {
      if (!translations[title] && typeof title === 'string' && title.trim()) {
        unhandled.push(title.trim());
      }
    }

    if (unhandled.length > 0) {
      await Promise.all(
        unhandled.map(async (t) => {
          try {
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(t)}&langpair=autodetect|zh-CN`;
            const r = await fetch(url);
            if (r.ok) {
              const data = await r.json();
              const tr = data.responseData?.translatedText;
              if (tr && typeof tr === 'string' && tr.trim() && !tr.includes('MYMEMORY WARNING')) {
                translations[t] = tr.trim();
              }
            }
          } catch {}
        })
      );
    }

    res.json({ translations });
  } catch (err: any) {
    console.warn('Translate titles route error:', err);
    res.status(500).json({ error: 'Failed to translate titles' });
  }
});

// ---------------------------------------------------------------------------
// Server Bootstrap: Vite middlewares in dev, static files in production
// ---------------------------------------------------------------------------

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

startServer();
