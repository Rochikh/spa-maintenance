const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// OpenRouter config
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

// Database setup
const db = new Database(path.join(__dirname, 'data', 'spa.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    ph REAL,
    alkalinity REAL,
    hardness REAL,
    sanitizer_type TEXT DEFAULT 'brome',
    sanitizer_free REAL,
    sanitizer_total REAL,
    actions TEXT,
    raw_response TEXT
  );

  CREATE TABLE IF NOT EXISTS maintenance_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    interval_days INTEGER NOT NULL,
    last_done TEXT,
    next_due TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Seed default maintenance tasks
const defaultTasks = [
  { key: 'filter_clean', label: 'Nettoyage filtre', interval: 14 },
  { key: 'filter_degrease', label: 'Trempage dégraissant filtre', interval: 30 },
  { key: 'filter_replace', label: 'Remplacement filtre', interval: 180 },
  { key: 'full_drain', label: 'Vidange complète', interval: 90 },
];

const insertTask = db.prepare(`
  INSERT OR IGNORE INTO maintenance_tasks (task_key, label, interval_days)
  VALUES (?, ?, ?)
`);
for (const t of defaultTasks) {
  insertTask.run(t.key, t.label, t.interval);
}

// Seed default settings
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('sanitizer_type', 'brome');
insertSetting.run('volume_liters', '900');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// OpenRouter API call helper
async function callVisionModel(base64Image, mimeType, prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

// --- API Routes ---

// Analyze strip image
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    const imageData = fs.readFileSync(req.file.path);
    const base64Image = imageData.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    // Get settings
    const settings = {};
    for (const row of db.prepare('SELECT key, value FROM settings').all()) {
      settings[row.key] = row.value;
    }
    const sanitizerType = settings.sanitizer_type || 'brome';
    const volume = settings.volume_liters || '900';

    const prompt = `Tu es un expert en maintenance de spa/jacuzzi. Analyse cette photo de bandelette d'analyse d'eau de spa.

Identifie les couleurs de chaque zone de la bandelette et déduis-en les valeurs suivantes :
- pH
- Alcalinité (TAC) en ppm
- Dureté (TH) en ppm
- ${sanitizerType === 'brome' ? 'Brome' : 'Chlore'} libre en ppm
- ${sanitizerType === 'brome' ? 'Brome' : 'Chlore'} total en ppm

Plages idéales pour un spa de ${volume} litres :
- pH : 7.2 - 7.6
- Alcalinité : 80 - 120 ppm
- Dureté : 150 - 300 ppm
- ${sanitizerType === 'brome' ? 'Brome : 3 - 5 ppm' : 'Chlore : 1 - 3 ppm'}

Pour chaque paramètre hors plage, indique l'action corrective précise avec le produit et la quantité approximative pour ${volume} litres.

Réponds UNIQUEMENT en JSON valide, sans markdown, avec cette structure exacte :
{
  "ph": { "value": number, "status": "ok"|"warning"|"critical" },
  "alkalinity": { "value": number, "unit": "ppm", "status": "ok"|"warning"|"critical" },
  "hardness": { "value": number, "unit": "ppm", "status": "ok"|"warning"|"critical" },
  "sanitizer_free": { "value": number, "unit": "ppm", "status": "ok"|"warning"|"critical" },
  "sanitizer_total": { "value": number, "unit": "ppm", "status": "ok"|"warning"|"critical" },
  "actions": [
    { "parameter": "string", "issue": "string", "product": "string", "quantity": "string", "instruction": "string" }
  ],
  "confidence": "high"|"medium"|"low",
  "notes": "string"
}`;

    const rawText = await callVisionModel(base64Image, mimeType, prompt);
    let parsed;
    try {
      // Try to extract JSON from the response (handle potential markdown wrapping)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: 'Impossible de parser la réponse IA', raw: rawText });
    }

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO analyses (ph, alkalinity, hardness, sanitizer_type, sanitizer_free, sanitizer_total, actions, raw_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      parsed.ph?.value,
      parsed.alkalinity?.value,
      parsed.hardness?.value,
      sanitizerType,
      parsed.sanitizer_free?.value,
      parsed.sanitizer_total?.value,
      JSON.stringify(parsed.actions || []),
      rawText
    );

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      id: result.lastInsertRowid,
      ...parsed,
      sanitizer_type: sanitizerType,
    });
  } catch (err) {
    console.error('Analyze error:', err);
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    res.status(500).json({ error: err.message });
  }
});

// Get analysis history
app.get('/api/analyses', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const rows = db.prepare('SELECT * FROM analyses ORDER BY date DESC LIMIT ?').all(limit);
  res.json(rows.map(r => ({ ...r, actions: JSON.parse(r.actions || '[]') })));
});

// Get single analysis
app.get('/api/analyses/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, actions: JSON.parse(row.actions || '[]') });
});

// Delete analysis
app.delete('/api/analyses/:id', (req, res) => {
  db.prepare('DELETE FROM analyses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Maintenance tasks
app.get('/api/maintenance', (req, res) => {
  const tasks = db.prepare('SELECT * FROM maintenance_tasks ORDER BY next_due ASC NULLS FIRST').all();
  res.json(tasks);
});

app.post('/api/maintenance/:key/done', (req, res) => {
  const task = db.prepare('SELECT * FROM maintenance_tasks WHERE task_key = ?').get(req.params.key);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const now = new Date();
  const nextDue = new Date(now);
  nextDue.setDate(nextDue.getDate() + task.interval_days);

  db.prepare('UPDATE maintenance_tasks SET last_done = ?, next_due = ? WHERE task_key = ?')
    .run(now.toISOString().slice(0, 10), nextDue.toISOString().slice(0, 10), req.params.key);

  const updated = db.prepare('SELECT * FROM maintenance_tasks WHERE task_key = ?').get(req.params.key);
  res.json(updated);
});

// Settings
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const update = db.transaction((entries) => {
    for (const [k, v] of Object.entries(entries)) {
      upsert.run(k, String(v));
    }
  });
  update(req.body);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Spa Maintenance running on http://localhost:${PORT}`);
});
