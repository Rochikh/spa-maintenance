// --- State ---
let currentView = 'dashboard';
let settings = { sanitizer_type: 'brome', volume_liters: '900' };

// --- Navigation ---
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchView(btn.dataset.view);
  });
});

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'history') loadHistory();
  if (view === 'settings') loadSettings();
}

// --- Analyze ---
const btnAnalyze = document.getElementById('btn-analyze');
const inputCamera = document.getElementById('input-camera');
const loadingOverlay = document.getElementById('analyze-loading');
const resultsPanel = document.getElementById('results-panel');

btnAnalyze.addEventListener('click', () => inputCamera.click());

inputCamera.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  loadingOverlay.classList.remove('hidden');
  resultsPanel.classList.add('hidden');

  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Erreur lors de l\'analyse');
    }

    displayResults(data);
    loadLastAnalysis();
    loadMaintenance();
  } catch (err) {
    toast('Erreur : ' + err.message);
  } finally {
    loadingOverlay.classList.add('hidden');
    inputCamera.value = '';
  }
});

function displayResults(data) {
  const grid = document.getElementById('results-grid');
  const actionsDiv = document.getElementById('results-actions');
  const notesDiv = document.getElementById('results-notes');

  const sanitizerLabel = data.sanitizer_type === 'chlore' ? 'Chlore' : 'Brome';

  const params = [
    { key: 'ph', label: 'pH', value: data.ph?.value, unit: '', status: data.ph?.status },
    { key: 'alkalinity', label: 'Alcalinité', value: data.alkalinity?.value, unit: 'ppm', status: data.alkalinity?.status },
    { key: 'hardness', label: 'Dureté', value: data.hardness?.value, unit: 'ppm', status: data.hardness?.status },
    { key: 'sanitizer_free', label: `${sanitizerLabel} libre`, value: data.sanitizer_free?.value, unit: 'ppm', status: data.sanitizer_free?.status },
    { key: 'sanitizer_total', label: `${sanitizerLabel} total`, value: data.sanitizer_total?.value, unit: 'ppm', status: data.sanitizer_total?.status },
  ];

  grid.innerHTML = params.map(p => `
    <div class="result-item status-${p.status || 'ok'}">
      <div class="result-label">${p.label}</div>
      <div class="result-value">${p.value != null ? p.value : '—'} <span class="result-unit">${p.unit}</span></div>
    </div>
  `).join('');

  if (data.actions && data.actions.length > 0) {
    actionsDiv.innerHTML = '<h3 style="font-size:0.9rem;font-weight:700;margin-bottom:10px;">Actions correctives</h3>' +
      data.actions.map(a => `
        <div class="action-item">
          <div class="action-param">${a.parameter} — ${a.issue}</div>
          <div class="action-detail"><strong>${a.product}</strong> : ${a.quantity}</div>
          <div class="action-detail">${a.instruction}</div>
        </div>
      `).join('');
  } else {
    actionsDiv.innerHTML = '<p style="color:var(--green);font-weight:600;">Tous les paramètres sont dans les normes.</p>';
  }

  notesDiv.textContent = data.notes || '';
  if (data.confidence) {
    const conf = { high: 'Confiance élevée', medium: 'Confiance moyenne', low: 'Confiance faible' };
    notesDiv.textContent = (conf[data.confidence] || '') + (data.notes ? ' — ' + data.notes : '');
  }

  resultsPanel.classList.remove('hidden');
  resultsPanel.scrollIntoView({ behavior: 'smooth' });
}

// --- Last Analysis ---
async function loadLastAnalysis() {
  try {
    const res = await fetch('/api/analyses?limit=1');
    const data = await res.json();
    const container = document.getElementById('last-analysis-content');

    if (data.length === 0) {
      container.innerHTML = '<p class="empty-state">Aucune analyse enregistrée</p>';
      return;
    }

    const a = data[0];
    const sanitizerLabel = a.sanitizer_type === 'chlore' ? 'Chlore' : 'Brome';
    const date = new Date(a.date).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    container.innerHTML = `
      <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:10px;">${date}</p>
      <div class="results-grid">
        ${renderMiniResult('pH', a.ph, '', getStatus('ph', a.ph))}
        ${renderMiniResult('TAC', a.alkalinity, 'ppm', getStatus('alkalinity', a.alkalinity))}
        ${renderMiniResult('TH', a.hardness, 'ppm', getStatus('hardness', a.hardness))}
        ${renderMiniResult(sanitizerLabel, a.sanitizer_free, 'ppm', getStatus('sanitizer', a.sanitizer_free, a.sanitizer_type))}
      </div>
    `;
  } catch (err) {
    console.error('loadLastAnalysis error:', err);
  }
}

function renderMiniResult(label, value, unit, status) {
  return `
    <div class="result-item status-${status}">
      <div class="result-label">${label}</div>
      <div class="result-value" style="font-size:1.2rem;">${value != null ? value : '—'} <span class="result-unit">${unit}</span></div>
    </div>
  `;
}

function getStatus(param, value, sanitizerType) {
  if (value == null) return 'ok';
  const ranges = {
    ph: { ok: [7.2, 7.6], warn: [7.0, 7.8] },
    alkalinity: { ok: [80, 120], warn: [60, 150] },
    hardness: { ok: [150, 300], warn: [100, 400] },
  };

  if (param === 'sanitizer') {
    if (sanitizerType === 'chlore') {
      ranges.sanitizer = { ok: [1, 3], warn: [0.5, 5] };
    } else {
      ranges.sanitizer = { ok: [3, 5], warn: [1, 8] };
    }
    param = 'sanitizer';
  }

  const r = ranges[param];
  if (!r) return 'ok';
  if (value >= r.ok[0] && value <= r.ok[1]) return 'ok';
  if (value >= r.warn[0] && value <= r.warn[1]) return 'warning';
  return 'critical';
}

// --- Maintenance ---
async function loadMaintenance() {
  try {
    const res = await fetch('/api/maintenance');
    const tasks = await res.json();
    const container = document.getElementById('maintenance-list');

    if (tasks.length === 0) {
      container.innerHTML = '<p class="empty-state">Aucune tâche configurée</p>';
      return;
    }

    container.innerHTML = tasks.map(t => {
      let dueText = 'Jamais effectué';
      let dueClass = 'overdue';

      if (t.next_due) {
        const due = new Date(t.next_due);
        const now = new Date();
        const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          dueText = `En retard de ${Math.abs(diffDays)} jour(s)`;
          dueClass = 'overdue';
        } else if (diffDays === 0) {
          dueText = "Aujourd'hui";
          dueClass = 'overdue';
        } else if (diffDays <= 3) {
          dueText = `Dans ${diffDays} jour(s)`;
          dueClass = 'soon';
        } else {
          dueText = due.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
          dueClass = '';
        }
      }

      const lastText = t.last_done
        ? new Date(t.last_done).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
        : 'Jamais';

      return `
        <div class="maint-item">
          <div class="maint-info">
            <div class="maint-label">${t.label}</div>
            <div class="maint-due ${dueClass}">Prochain : ${dueText}</div>
            <div class="maint-due">Dernier : ${lastText}</div>
          </div>
          <button class="btn-done" onclick="markDone('${t.task_key}')">Fait ✓</button>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('loadMaintenance error:', err);
  }
}

async function markDone(taskKey) {
  try {
    await fetch(`/api/maintenance/${taskKey}/done`, { method: 'POST' });
    toast('Tâche marquée comme effectuée');
    loadMaintenance();
  } catch (err) {
    toast('Erreur : ' + err.message);
  }
}

// --- History ---
async function loadHistory() {
  try {
    const res = await fetch('/api/analyses?limit=100');
    const data = await res.json();
    const tbody = document.getElementById('history-body');
    const emptyMsg = document.getElementById('history-empty');
    const chartsContainer = document.getElementById('charts-container');

    if (data.length === 0) {
      tbody.innerHTML = '';
      emptyMsg.classList.remove('hidden');
      chartsContainer.innerHTML = '';
      return;
    }

    emptyMsg.classList.add('hidden');

    const sanitizerLabel = settings.sanitizer_type === 'chlore' ? 'Chlore' : 'Brome';

    tbody.innerHTML = data.map(a => {
      const date = new Date(a.date).toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      return `
        <tr>
          <td>${date}</td>
          <td><span class="status-dot dot-${getStatus('ph', a.ph)}"></span>${a.ph ?? '—'}</td>
          <td><span class="status-dot dot-${getStatus('alkalinity', a.alkalinity)}"></span>${a.alkalinity ?? '—'}</td>
          <td><span class="status-dot dot-${getStatus('hardness', a.hardness)}"></span>${a.hardness ?? '—'}</td>
          <td><span class="status-dot dot-${getStatus('sanitizer', a.sanitizer_free, a.sanitizer_type)}"></span>${a.sanitizer_free ?? '—'}</td>
          <td><button class="btn-delete" onclick="deleteAnalysis(${a.id})">🗑</button></td>
        </tr>
      `;
    }).join('');

    // Draw sparklines
    renderCharts(data.slice().reverse(), sanitizerLabel);
  } catch (err) {
    console.error('loadHistory error:', err);
  }
}

function renderCharts(data, sanitizerLabel) {
  const container = document.getElementById('charts-container');
  if (data.length < 2) {
    container.innerHTML = '';
    return;
  }

  const params = [
    { key: 'ph', label: 'pH', range: [7.2, 7.6], color: '#1a73e8' },
    { key: 'alkalinity', label: 'Alcalinité (ppm)', range: [80, 120], color: '#7c3aed' },
    { key: 'hardness', label: 'Dureté (ppm)', range: [150, 300], color: '#059669' },
    { key: 'sanitizer_free', label: `${sanitizerLabel} libre (ppm)`, range: settings.sanitizer_type === 'chlore' ? [1, 3] : [3, 5], color: '#ea580c' },
  ];

  container.innerHTML = params.map((p, i) => `
    <div class="chart-row">
      <div class="chart-label">${p.label}</div>
      <div class="sparkline-container">
        <canvas id="chart-${i}" width="600" height="50"></canvas>
      </div>
    </div>
  `).join('');

  params.forEach((p, i) => {
    const canvas = document.getElementById(`chart-${i}`);
    drawSparkline(canvas, data.map(d => d[p.key]), p.range, p.color);
  });
}

function drawSparkline(canvas, values, idealRange, color) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const filtered = values.filter(v => v != null);
  if (filtered.length < 2) return;

  const min = Math.min(...filtered, idealRange[0]) * 0.9;
  const max = Math.max(...filtered, idealRange[1]) * 1.1;
  const rangeY = max - min || 1;

  // Draw ideal range band
  const y1 = h - ((idealRange[1] - min) / rangeY) * h;
  const y2 = h - ((idealRange[0] - min) / rangeY) * h;
  ctx.fillStyle = 'rgba(22, 163, 74, 0.12)';
  ctx.fillRect(0, y1, w, y2 - y1);

  // Draw line
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';

  let idx = 0;
  const step = w / (values.length - 1);
  values.forEach((v, i) => {
    if (v == null) return;
    const x = i * step;
    const y = h - ((v - min) / rangeY) * h;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    idx++;
  });
  ctx.stroke();

  // Draw dots
  values.forEach((v, i) => {
    if (v == null) return;
    const x = i * step;
    const y = h - ((v - min) / rangeY) * h;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = (v >= idealRange[0] && v <= idealRange[1]) ? '#16a34a' : '#ea580c';
    ctx.fill();
  });
}

async function deleteAnalysis(id) {
  if (!confirm('Supprimer cette analyse ?')) return;
  try {
    await fetch(`/api/analyses/${id}`, { method: 'DELETE' });
    loadHistory();
    loadLastAnalysis();
    toast('Analyse supprimée');
  } catch (err) {
    toast('Erreur : ' + err.message);
  }
}

// --- Settings ---
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    settings = await res.json();
    document.getElementById('setting-sanitizer').value = settings.sanitizer_type || 'brome';
    document.getElementById('setting-volume').value = settings.volume_liters || '900';
  } catch (err) {
    console.error('loadSettings error:', err);
  }
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const sanitizer = document.getElementById('setting-sanitizer').value;
  const volume = document.getElementById('setting-volume').value;

  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sanitizer_type: sanitizer, volume_liters: volume }),
    });
    settings.sanitizer_type = sanitizer;
    settings.volume_liters = volume;
    toast('Réglages enregistrés');
  } catch (err) {
    toast('Erreur : ' + err.message);
  }
});

// --- Toast ---
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// --- Init ---
async function init() {
  await loadSettings();
  loadLastAnalysis();
  loadMaintenance();
}

init();
