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
