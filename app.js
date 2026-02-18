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
    const { imageUrl } = req.body || {};
    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl is required.' });
    }
    if (!MISTRAL_API_KEY) {
      return res.status(400).json({ error: 'Mistral API key is not configured.' });
    }

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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
              { type: 'image_url', image_url: imageUrl },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText || 'Mistral error.' });
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content ?? '';
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

module.exports = app;
