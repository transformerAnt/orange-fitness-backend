const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const EXERCISEDB_BASE_URL = process.env.EXERCISEDB_BASE_URL || '';
const EXERCISEDB_API_KEY = process.env.EXERCISEDB_API_KEY || '';
const EXERCISEDB_HOST = process.env.EXERCISEDB_HOST || '';
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';
const MISTRAL_VISION_MODEL = process.env.MISTRAL_VISION_MODEL || 'mistral-small-latest';
const MISTRAL_TEXT_MODEL = process.env.MISTRAL_TEXT_MODEL || 'mistral-small-latest';
const RAG_DOCS_JSON = process.env.RAG_DOCS_JSON || '[]';

const chatMemory = new Map();
const ragDocuments = (() => {
  try {
    const parsed = JSON.parse(RAG_DOCS_JSON);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const buildQuery = (query) => {
  const params = new URLSearchParams();
  const offset = query.offset;
  const limit = query.limit;
  const sortMethod = query.sortMethod;
  const sortOrder = query.sortOrder;
  if (offset !== undefined) params.set('offset', String(offset));
  if (limit !== undefined) params.set('limit', String(limit));
  if (sortMethod) params.set('sortMethod', String(sortMethod));
  if (sortOrder) params.set('sortOrder', String(sortOrder));
  const value = params.toString();
  return value ? `?${value}` : '';
};

app.get('/exercises', async (req, res) => {
  try {
    if (!EXERCISEDB_BASE_URL || !EXERCISEDB_API_KEY) {
      return res.status(400).json({ error: 'ExerciseDB is not configured.' });
    }
    const bodyPart = req.query.bodyPart;
    const baseUrl = EXERCISEDB_BASE_URL.replace(/\/$/, '');
    const queryString = buildQuery(req.query);
    const endpoint = bodyPart
      ? `${baseUrl}/exercises/bodyPart/${encodeURIComponent(bodyPart)}${queryString}`
      : `${baseUrl}/exercises${queryString}`;

    const headers = {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': EXERCISEDB_API_KEY,
      ...(EXERCISEDB_HOST ? { 'X-RapidAPI-Host': EXERCISEDB_HOST } : {}),
    };
    const response = await fetch(endpoint, { headers });
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText || 'ExerciseDB error.' });
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch exercises.' });
  }
});

app.get('/exercises/body-parts', async (_req, res) => {
  try {
    if (!EXERCISEDB_BASE_URL || !EXERCISEDB_API_KEY) {
      return res.status(400).json({ error: 'ExerciseDB is not configured.' });
    }
    const baseUrl = EXERCISEDB_BASE_URL.replace(/\/$/, '');
    const endpoint = `${baseUrl}/exercises/bodyPartList`;
    const headers = {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': EXERCISEDB_API_KEY,
      ...(EXERCISEDB_HOST ? { 'X-RapidAPI-Host': EXERCISEDB_HOST } : {}),
    };
    const response = await fetch(endpoint, { headers });
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText || 'ExerciseDB error.' });
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch body parts.' });
  }
});

app.get('/exercises/:id', async (req, res) => {
  try {
    if (!EXERCISEDB_BASE_URL || !EXERCISEDB_API_KEY) {
      return res.status(400).json({ error: 'ExerciseDB is not configured.' });
    }
    const exerciseId = req.params.id;
    const baseUrl = EXERCISEDB_BASE_URL.replace(/\/$/, '');
    const endpoint = `${baseUrl}/exercises/exercise/${encodeURIComponent(exerciseId)}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': EXERCISEDB_API_KEY,
      ...(EXERCISEDB_HOST ? { 'X-RapidAPI-Host': EXERCISEDB_HOST } : {}),
    };
    const response = await fetch(endpoint, { headers });
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText || 'ExerciseDB error.' });
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch exercise.' });
  }
});

app.post('/food/analyze', async (req, res) => {
  try {
    const { imageUrl, image_url, imageBase64 } = req.body || {};
    const inputImage = imageUrl || image_url || imageBase64;
    if (!inputImage) {
      return res.status(400).json({ error: 'imageUrl or imageBase64 is required.' });
    }
    if (!MISTRAL_API_KEY) {
      return res.status(400).json({ error: 'Mistral API key is not configured.' });
    }

    const imagePayload = String(inputImage).startsWith('data:image')
      ? inputImage
      : imageBase64
        ? `data:image/jpeg;base64,${inputImage}`
        : inputImage;

    const buildBody = (useObject) => ({
      model: MISTRAL_VISION_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a nutrition analyst. Return ONLY JSON with keys: items (array of {name, calories, protein_g, carbs_g, fat_g}), totalCalories, protein_g, carbs_g, fat_g.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Estimate macros and calories for this meal.' },
            useObject
              ? { type: 'image_url', image_url: { url: imagePayload } }
              : { type: 'image_url', image_url: imagePayload },
          ],
        },
      ],
    });

    const callMistral = async (useObject) =>
      fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildBody(useObject)),
      });

    let response = await callMistral(false);
    if (!response.ok) {
      response = await callMistral(true);
    }

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText || 'Mistral error.' });
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content ?? '';
    console.log('Mistral vision raw response:', content);
    const fenced = content.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fenced && fenced[1]) {
      try {
        const parsed = JSON.parse(fenced[1]);
        return res.json(parsed);
      } catch {
        // fallthrough
      }
    }
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return res.status(200).json({ items: [], raw: content });
    }
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
    return res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: 'Food analysis failed.' });
  }
});

const getUserId = (req) => req.headers['x-user-id'] || req.body?.userId || 'anonymous';

const rankRag = (query) => {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length || !ragDocuments.length) return [];
  const scored = ragDocuments.map((doc) => {
    const hay = String(doc.text || '').toLowerCase();
    const score = tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
    return { ...doc, score };
  });
  return scored.filter((d) => d.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
};

app.post('/chat', async (req, res) => {
  try {
    if (!MISTRAL_API_KEY) {
      return res.status(400).json({ error: 'Mistral API key is not configured.' });
    }
    const { message, history = [], ragQuery } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: 'message is required.' });
    }

    const userId = getUserId(req);
    const ragMatches = rankRag(ragQuery || message);
    const ragContext = ragMatches.map((m) => `- ${m.text}`).join('\n');

    const systemPrompt =
      'You are an AI nutrition coach. Be concise and actionable. If user lacks context, ask one clarifying question.';

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MISTRAL_TEXT_MODEL,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          ...(ragContext ? [{ role: 'system', content: `RAG context:\n${ragContext}` }] : []),
          ...history,
          { role: 'user', content: message },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText || 'Mistral error.' });
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content ?? '';

    const memory = chatMemory.get(userId) || [];
    memory.push({ role: 'user', content: message, at: new Date().toISOString() });
    memory.push({ role: 'assistant', content, at: new Date().toISOString() });
    chatMemory.set(userId, memory.slice(-40));

    return res.json({ reply: content, rag: ragMatches });
  } catch (error) {
    res.status(500).json({ error: 'Chat failed.' });
  }
});

app.get('/chat/history', (req, res) => {
  const userId = getUserId(req);
  const memory = chatMemory.get(userId) || [];
  res.json({ history: memory });
});

app.post('/chat/reset', (req, res) => {
  const userId = getUserId(req);
  chatMemory.delete(userId);
  res.json({ ok: true });
});

app.post('/rag/search', (req, res) => {
  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query is required.' });
  const matches = rankRag(query);
  res.json({ matches });
});

module.exports = app;
