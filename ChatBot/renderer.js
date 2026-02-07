const { marked } = require('marked');
marked.setOptions({ gfm: true, breaks: true });

function renderMarkdown(text) {
  const trimmed = (text || '').trimStart();
  if (!trimmed) return '';
  return marked.parse(trimmed);
}

// Theme toggle functionality
const themeToggle = document.getElementById('themeToggle');
const citedDocsButton = document.getElementById('citedDocsButton');
const citedDocsDialog = document.getElementById('citedDocsDialog');
const citedDocsList = document.getElementById('citedDocsList');
const citedDocsEmpty = document.getElementById('citedDocsEmpty');
const html = document.documentElement;

// Theme cycle: light -> dark -> muted-green -> gray -> muted-orange -> forest -> muted-blue -> light
const THEME_ORDER = ['light', 'dark', 'muted-green', 'gray', 'muted-orange', 'forest', 'muted-blue'];

// Load saved theme or default to light (fallback to light if saved theme unknown)
const savedTheme = localStorage.getItem('theme') || 'light';
const initialTheme = THEME_ORDER.includes(savedTheme) ? savedTheme : 'light';
html.setAttribute('data-theme', initialTheme);

themeToggle.addEventListener('click', () => {
  const currentTheme = html.getAttribute('data-theme');
  const idx = THEME_ORDER.indexOf(currentTheme);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % THEME_ORDER.length;
  const newTheme = THEME_ORDER[nextIdx];
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
});

// Returns ordered list of keys (sourceName\0url) for current citations; used to snapshot "previous" order before adding new turn.
function getCitedOrderKeys(citations) {
  if (!citations || citations.length === 0) return [];
  const byKey = new Map();
  let maxTurnIndex = -1;
  for (const c of citations) {
    const sourceName = c.sourceName;
    const url = c.url || '#';
    const turnIndex = typeof c.turnIndex === 'number' ? c.turnIndex : -1;
    const similarity = typeof c.similarity === 'number' ? c.similarity : null;
    if (turnIndex > maxTurnIndex) maxTurnIndex = turnIndex;
    const key = `${String(sourceName)}\0${String(url)}`;
    if (!byKey.has(key)) byKey.set(key, { key, sourceName, url, count: 0, maxTurnInGroup: -1, maxSimilarity: null });
    const entry = byKey.get(key);
    entry.count += 1;
    if (turnIndex > entry.maxTurnInGroup) entry.maxTurnInGroup = turnIndex;
    if (similarity != null && (entry.maxSimilarity == null || similarity > entry.maxSimilarity)) entry.maxSimilarity = similarity;
  }
  const entries = [...byKey.values()];
  const maxCount = Math.max(1, ...entries.map(e => e.count));
  const maxSimilarityGlobal = Math.max(0, ...entries.map(e => e.maxSimilarity ?? 0));
  entries.sort((a, b) => {
    const strengthA = maxSimilarityGlobal > 0 ? (a.maxSimilarity ?? 0) / maxSimilarityGlobal : 0;
    const strengthB = maxSimilarityGlobal > 0 ? (b.maxSimilarity ?? 0) / maxSimilarityGlobal : 0;
    const freqA = a.count / maxCount;
    const freqB = b.count / maxCount;
    const inRecentA = maxTurnIndex >= 0 && a.maxTurnInGroup === maxTurnIndex ? 1 : 0;
    const inRecentB = maxTurnIndex >= 0 && b.maxTurnInGroup === maxTurnIndex ? 1 : 0;
    const scoreA = (strengthA + freqA + inRecentA) / 3;
    const scoreB = (strengthB + freqB + inRecentB) / 3;
    return scoreB - scoreA;
  });
  return entries.map(e => e.key);
}

// Returns full entries in sorted order for previous snapshot (so we can render removed items).
function getCitedOrderEntries(citations) {
  if (!citations || citations.length === 0) return [];
  const byKey = new Map();
  let maxTurnIndex = -1;
  for (const c of citations) {
    const sourceName = c.sourceName;
    const url = c.url || '#';
    const turnIndex = typeof c.turnIndex === 'number' ? c.turnIndex : -1;
    const similarity = typeof c.similarity === 'number' ? c.similarity : null;
    if (turnIndex > maxTurnIndex) maxTurnIndex = turnIndex;
    const key = `${String(sourceName)}\0${String(url)}`;
    if (!byKey.has(key)) byKey.set(key, { key, sourceName, url, count: 0, maxTurnInGroup: -1, maxSimilarity: null });
    const entry = byKey.get(key);
    entry.count += 1;
    if (turnIndex > entry.maxTurnInGroup) entry.maxTurnInGroup = turnIndex;
    if (similarity != null && (entry.maxSimilarity == null || similarity > entry.maxSimilarity)) entry.maxSimilarity = similarity;
  }
  const entries = [...byKey.values()];
  const maxCount = Math.max(1, ...entries.map(e => e.count));
  const maxSimilarityGlobal = Math.max(0, ...entries.map(e => e.maxSimilarity ?? 0));
  entries.sort((a, b) => {
    const strengthA = maxSimilarityGlobal > 0 ? (a.maxSimilarity ?? 0) / maxSimilarityGlobal : 0;
    const strengthB = maxSimilarityGlobal > 0 ? (b.maxSimilarity ?? 0) / maxSimilarityGlobal : 0;
    const freqA = a.count / maxCount;
    const freqB = b.count / maxCount;
    const inRecentA = maxTurnIndex >= 0 && a.maxTurnInGroup === maxTurnIndex ? 1 : 0;
    const inRecentB = maxTurnIndex >= 0 && b.maxTurnInGroup === maxTurnIndex ? 1 : 0;
    const scoreA = (strengthA + freqA + inRecentA) / 3;
    const scoreB = (strengthB + freqB + inRecentB) / 3;
    return scoreB - scoreA;
  });
  return entries.map(e => ({ key: e.key, sourceName: e.sourceName, url: e.url }));
}

const CITED_DOC_ROW_HEIGHT_PX = 48;
const CITED_DOC_ANIM_DURATION_MS = 380;

// Relevant Resources button and dialog — use window-conversationCitations so dialog and RAG code share the same array
function openCitedDocsDialog() {
  if (!citedDocsDialog || !citedDocsList || !citedDocsEmpty) return;
  const citations = window.__conversationCitations || [];
  console.log(`📂 Opening Relevant Resources dialog, citations.length = ${citations.length}`, citations);
  citedDocsList.innerHTML = '';
  citedDocsList.style.display = 'block';
  citedDocsEmpty.style.display = 'none';

  const byKey = new Map();
  let maxTurnIndex = -1;
  for (const c of citations) {
    const sourceName = c.sourceName;
    const url = c.url || '#';
    const turnIndex = typeof c.turnIndex === 'number' ? c.turnIndex : -1;
    const similarity = typeof c.similarity === 'number' ? c.similarity : null;
    if (turnIndex > maxTurnIndex) maxTurnIndex = turnIndex;
    const key = `${String(sourceName)}\0${String(url)}`;
    if (!byKey.has(key)) byKey.set(key, { sourceName, url, count: 0, maxTurnInGroup: -1, maxSimilarity: null });
    const entry = byKey.get(key);
    entry.count += 1;
    if (turnIndex > entry.maxTurnInGroup) entry.maxTurnInGroup = turnIndex;
    if (similarity != null && (entry.maxSimilarity == null || similarity > entry.maxSimilarity)) entry.maxSimilarity = similarity;
  }
  const entries = [...byKey.values()];
  const maxCount = Math.max(1, ...entries.map(e => e.count));
  const maxSimilarityGlobal = Math.max(0, ...entries.map(e => e.maxSimilarity ?? 0));
  const sorted = entries.sort((a, b) => {
    const strengthA = maxSimilarityGlobal > 0 ? (a.maxSimilarity ?? 0) / maxSimilarityGlobal : 0;
    const strengthB = maxSimilarityGlobal > 0 ? (b.maxSimilarity ?? 0) / maxSimilarityGlobal : 0;
    const freqA = a.count / maxCount;
    const freqB = b.count / maxCount;
    const inRecentA = maxTurnIndex >= 0 && a.maxTurnInGroup === maxTurnIndex ? 1 : 0;
    const inRecentB = maxTurnIndex >= 0 && b.maxTurnInGroup === maxTurnIndex ? 1 : 0;
    const scoreA = (strengthA + freqA + inRecentA) / 3;
    const scoreB = (strengthB + freqB + inRecentB) / 3;
    return scoreB - scoreA;
  });

  if (sorted.length === 0) {
    citedDocsList.style.display = 'none';
    citedDocsEmpty.style.display = 'block';
  } else {
    const maxScore = Math.max(...sorted.map(e => {
      const strength = maxSimilarityGlobal > 0 ? (e.maxSimilarity ?? 0) / maxSimilarityGlobal : 0;
      const freq = e.count / maxCount;
      const inRecent = maxTurnIndex >= 0 && e.maxTurnInGroup === maxTurnIndex ? 1 : 0;
      return (strength + freq + inRecent) / 3;
    }), 1e-6);
    const previousOrder = window.__previousCitedOrder || [];
    const previousEntries = window.__previousCitedEntries || [];
    const currentOrderKeys = sorted.map(e => `${e.sourceName}\0${e.url}`);
    const currentKeySet = new Set(currentOrderKeys);
    const removedEntries = previousEntries.filter(e => !currentKeySet.has(e.key));

    const hasPreviousSnapshot = previousOrder.length > 0;
    if (hasPreviousSnapshot) citedDocsList.classList.add('cited-docs-list-animate');

    sorted.forEach((entry, i) => {
      const strength = maxSimilarityGlobal > 0 ? (entry.maxSimilarity ?? 0) / maxSimilarityGlobal : 0;
      const freq = entry.count / maxCount;
      const inRecent = maxTurnIndex >= 0 && entry.maxTurnInGroup === maxTurnIndex ? 1 : 0;
      const score = (strength + freq + inRecent) / 3;
      const li = document.createElement('li');
      const itemOpacity = 0.4 + 0.6 * (score / maxScore);
      li.style.opacity = String(itemOpacity);
      li.dataset.finalOpacity = String(itemOpacity);
      const key = `${entry.sourceName}\0${entry.url}`;
      const prevIndex = previousOrder.indexOf(key);
      li.dataset.prevIndex = String(prevIndex);
      li.dataset.currIndex = String(i);

      let changeState = 'new';
      if (prevIndex !== -1) {
        if (i < prevIndex) changeState = 'rose';
        else if (i > prevIndex) changeState = 'fell';
        else changeState = 'same';
      }
      const indicator = document.createElement('span');
      indicator.className = `cited-doc-indicator cited-doc-indicator--${changeState}`;
      indicator.setAttribute('aria-label', changeState === 'rose' ? 'Risen' : changeState === 'fell' ? 'Fallen' : changeState === 'same' ? 'Same position' : 'New');
      indicator.textContent = changeState === 'rose' ? '\u2191' : changeState === 'fell' ? '\u2193' : changeState === 'same' ? '\u2013' : '\u2022';

      const icon = document.createElement('img');
      icon.src = 'assets/document-svgrepo-com.svg';
      icon.alt = 'Document';
      icon.className = 'cited-doc-icon';

      const link = document.createElement('a');
      link.href = entry.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = entry.sourceName;
      link.className = 'cited-doc-link';

      li.appendChild(indicator);
      li.appendChild(icon);
      li.appendChild(link);
      citedDocsList.appendChild(li);
    });

    removedEntries.forEach((entry, idx) => {
      const li = document.createElement('li');
      li.className = 'cited-doc-item-removed';
      li.dataset.key = entry.key;
      const icon = document.createElement('img');
      icon.src = 'assets/document-svgrepo-com.svg';
      icon.alt = 'Document';
      icon.className = 'cited-doc-icon';
      const link = document.createElement('a');
      link.href = entry.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = entry.sourceName;
      link.className = 'cited-doc-link';
      li.appendChild(document.createElement('span')); // placeholder for indicator
      li.appendChild(icon);
      li.appendChild(link);
      citedDocsList.appendChild(li);
    });

    // Set initial positions *before* showing dialog so the first paint has offset items
    const lis = citedDocsList.querySelectorAll('li:not(.cited-doc-item-removed)');
    const hasAnyPrevious = previousOrder.length > 0 && lis.length > 0;
    if (hasAnyPrevious) {
      lis.forEach(li => {
        const prevIdx = parseInt(li.dataset.prevIndex, 10);
        const currIdx = parseInt(li.dataset.currIndex, 10);
        if (prevIdx >= 0) {
          li.style.transform = `translateY(${(prevIdx - currIdx) * CITED_DOC_ROW_HEIGHT_PX}px)`;
        } else {
          li.style.opacity = '0';
        }
      });
      citedDocsList.querySelectorAll('.cited-doc-item-removed').forEach(li => { li.style.opacity = '1'; });
    }

    citedDocsDialog.style.display = 'flex';

    if (hasAnyPrevious) {
      void citedDocsList.offsetHeight;
      requestAnimationFrame(() => {
        setTimeout(() => {
          lis.forEach(li => {
            li.style.transform = '';
            const finalOpacity = li.dataset.finalOpacity;
            li.style.opacity = finalOpacity != null ? finalOpacity : '';
          });
          citedDocsList.querySelectorAll('.cited-doc-item-removed').forEach(li => { li.style.opacity = '0'; });

          const removed = citedDocsList.querySelectorAll('.cited-doc-item-removed');
          removed.forEach(li => {
            li.addEventListener('transitionend', function onEnd() {
              li.removeEventListener('transitionend', onEnd);
              li.remove();
            });
          });
          setTimeout(() => citedDocsList.classList.remove('cited-docs-list-animate'), CITED_DOC_ANIM_DURATION_MS);
        }, 120);
      });
    } else {
      citedDocsList.classList.remove('cited-docs-list-animate');
    }
  }

  if (sorted.length === 0) citedDocsDialog.style.display = 'flex';
}

function closeCitedDocsDialog() {
  if (citedDocsDialog) citedDocsDialog.style.display = 'none';
}

if (citedDocsButton) {
  citedDocsButton.addEventListener('click', openCitedDocsDialog);
}

if (citedDocsDialog) {
  citedDocsDialog.addEventListener('click', (e) => {
    if (e.target === citedDocsDialog) closeCitedDocsDialog();
  });
}

// Panel toggle functionality
const panelToggle = document.getElementById('panelToggle');
const leftPanel = document.getElementById('leftPanel');
const body = document.body;

// Always start with panel open (ignore saved state on app start)
// Panel state is still saved when user toggles it, but always starts open
leftPanel.classList.remove('collapsed');
body.classList.remove('panel-collapsed');

panelToggle.addEventListener('click', () => {
  leftPanel.classList.toggle('collapsed');
  const isCollapsed = leftPanel.classList.contains('collapsed');
  body.classList.toggle('panel-collapsed', isCollapsed);
  localStorage.setItem('panelState', isCollapsed ? 'collapsed' : 'open');
});

// Status circle functionality
const statusCircle = document.getElementById('statusCircle');
let isConnected = false;
let currentModel = null;
let connectionMonitorInterval = null;

// Initialize status as not connected (red)
function updateOllamaStatus(connected, modelName = null) {
  isConnected = connected;
  if (connected && modelName) {
    statusCircle.classList.add('connected');
    statusCircle.setAttribute('data-tooltip', `Connected to Ollama - Model: ${modelName}`);
  } else if (connected) {
    statusCircle.classList.add('connected');
    statusCircle.setAttribute('data-tooltip', 'Connected to Ollama');
  } else {
    statusCircle.classList.remove('connected');
    statusCircle.setAttribute('data-tooltip', 'Not connected to Ollama');
  }
}

// Make function globally accessible for future Ollama connection checks
window.updateOllamaStatus = updateOllamaStatus;

// Start with not connected
updateOllamaStatus(false);

// Ollama settings functionality
const ollamaUrlInput = document.getElementById('ollamaUrl');
const connectButton = document.getElementById('connectButton');
const modelGroup = document.getElementById('modelGroup');
const modelSelect = document.getElementById('modelSelect');
const modelConnectionDialog = document.getElementById('modelConnectionDialog');
const modelConnectionMessage = document.getElementById('modelConnectionMessage');
const modelConnectionButtons = document.getElementById('modelConnectionButtons');
const modelConnectionOK = document.getElementById('modelConnectionOK');
const modelConnectionRetry = document.getElementById('modelConnectionRetry');

// Track retry context
let retryContext = null; // { type: 'ollama' | 'model', model?: string }

// Verify elements exist
if (!modelSelect) {
  console.error('modelSelect element not found!');
}
if (!modelGroup) {
  console.error('modelGroup element not found!');
}

// Load saved Ollama URL or use default
const defaultOllamaUrl = 'http://localhost:11434';
const savedOllamaUrl = localStorage.getItem('ollamaUrl') || defaultOllamaUrl;
ollamaUrlInput.value = savedOllamaUrl;

// Function to derive RAG URL from Ollama URL (needed before RAG settings)
function deriveRAGUrlFromOllama(ollamaUrl) {
  try {
    const url = new URL(ollamaUrl);
    return `${url.protocol}//${url.hostname}:9042`;
  } catch (e) {
    // Fallback if URL parsing fails
    return 'http://localhost:9042';
  }
}

// Function to update connect button state
function updateConnectButtonState() {
  // Disable button if model dropdown is visible (Ollama connected)
  if (modelGroup && modelGroup.style.display !== 'none') {
    connectButton.disabled = true;
  } else {
    connectButton.disabled = false;
  }
}

  // Save URL when changed - reset everything
ollamaUrlInput.addEventListener('change', () => {
  // Get old URL before saving new one
  const oldOllamaUrl = localStorage.getItem('ollamaUrl') || defaultOllamaUrl;
  const oldDerivedRAGUrl = deriveRAGUrlFromOllama(oldOllamaUrl);
  
  localStorage.setItem('ollamaUrl', ollamaUrlInput.value);
  
  // Reset everything - end current session
  stopConnectionMonitoring();
  updateOllamaStatus(false);
  currentModel = null;
  modelSelect.value = '';
  modelSelect.innerHTML = '<option value="">Select a model...</option>';
  modelGroup.style.display = 'none';
  updateSystemMessageButtonVisibility();
  updateRAGSettingsVisibility(); // Hide RAG settings
  hideModelConnectionDialog();
  updateConnectButtonState(); // Re-enable button when model menu is hidden
  
  // Clear chat history and citations
  chatHistory = [];
  window.__conversationCitations = [];
  window.__citationTurnIndex = 0;
  window.__previousCitedOrder = [];
  window.__previousCitedEntries = [];
  chatContainer.innerHTML = '';
  
  // Update RAG URL to match Ollama URL (if RAG URL hasn't been manually customized)
  const ragInput = document.getElementById('ragServerUrl');
  if (ragInput) {
    const newRAGUrl = deriveRAGUrlFromOllama(ollamaUrlInput.value.trim());
    const savedRAGUrl = localStorage.getItem('ragServerUrl');
    if (!savedRAGUrl || ragInput.value === oldDerivedRAGUrl) {
      ragInput.value = newRAGUrl;
      localStorage.setItem('ragServerUrl', newRAGUrl);
    }
  }
  
  // Update send button state
  updateSendButtonState();
});


// Model selection handler
if (modelSelect) {
  modelSelect.addEventListener('change', async () => {
    const selectedModel = modelSelect.value;
    console.log('Model selection changed:', selectedModel);
    if (!selectedModel) {
    currentModel = null;
    updateOllamaStatus(false);
    stopConnectionMonitoring();
    updateSystemMessageButtonVisibility();
    hideModelConnectionDialog();
    updateRAGSettingsVisibility(); // Hide RAG settings when model is deselected
    resetModelContextWindow(); // Reset context window cache
    updateSendButtonState(); // Disable send button
    return;
  }

  const url = ollamaUrlInput.value.trim();
  showModelConnectionDialog('Checking model responsiveness...', false);
  modelSelect.disabled = true;

  console.log('Starting model check for:', selectedModel, 'at URL:', url);

  try {
    // Check model availability with /api/show (fast; no inference)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 sec enough for metadata

    console.log('Checking model availability:', `${url}/api/show`);

    const response = await fetch(`${url}/api/show`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: selectedModel }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    console.log('Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Model check failed - Response error:', errorData);
      throw new Error(errorData.error || `Model unavailable: ${response.status}`);
    }

    const data = await response.json().catch(() => null);
    if (data && (data.name || data.modelfile !== undefined)) {
      console.log('Model check successful! Model is available.');
      currentModel = selectedModel;
      console.log('currentModel set to:', currentModel);
      hideModelConnectionDialog(); // Close dialog on success
      updateOllamaStatus(true, selectedModel);
      startConnectionMonitoring();
      console.log('About to call updateSystemMessageButtonVisibility...');
      updateSystemMessageButtonVisibility();
      console.log('After updateSystemMessageButtonVisibility, checking section display:', promptSettingsSection?.style.display);
      updateRAGSettingsVisibility(); // Show RAG settings when model is connected
      checkForRAGs(); // Check for RAG collections after model is connected
      resetModelContextWindow(); // Reset context window cache for new model
      updateSendButtonState(); // Enable send button
    } else {
      console.error('Model check failed - Invalid or empty response');
      throw new Error('Model metadata invalid or missing');
    }
  } catch (error) {
    console.error('Model check error:', error.name, error.message, error);
    let errorMessage = '';
    if (error.name === 'AbortError') {
      console.error('Model check timed out');
      errorMessage = 'Model check timed out. Ollama may be busy or unreachable.';
    } else {
      errorMessage = `Model check failed: ${error.message}`;
    }
    showModelConnectionDialog(errorMessage, true, 'model', selectedModel); // Show error dialog with retry context
    currentModel = null;
    modelSelect.value = '';
    updateOllamaStatus(false);
    stopConnectionMonitoring();
    updateSystemMessageButtonVisibility();
    updateRAGSettingsVisibility(); // Hide RAG settings when model check fails
    updateSendButtonState(); // Disable send button
  } finally {
    if (modelSelect) {
      modelSelect.disabled = false;
    }
  }
  });
} else {
  console.error('Cannot attach model selection handler: modelSelect is null');
}

// Show/hide model connection dialog
function showModelConnectionDialog(message, isError = false, retryType = null, retryModel = null) {
  modelConnectionMessage.textContent = message;
  modelConnectionMessage.className = isError ? 'dialog-message error' : 'dialog-message';
  modelConnectionButtons.style.display = isError ? 'flex' : 'none';
  modelConnectionDialog.style.display = 'flex';
  
  // Store retry context if this is an error
  if (isError && retryType) {
    retryContext = { type: retryType, model: retryModel };
  } else {
    retryContext = null;
  }
  
  // Show/hide retry button based on whether we have retry context
  if (modelConnectionRetry) {
    modelConnectionRetry.style.display = (isError && retryContext) ? 'block' : 'none';
  }
}

function hideModelConnectionDialog() {
  modelConnectionDialog.style.display = 'none';
}

// Close dialog on OK button
if (modelConnectionOK) {
  modelConnectionOK.addEventListener('click', () => {
    hideModelConnectionDialog();
    retryContext = null;
  });
}

// Retry button handler
if (modelConnectionRetry) {
  modelConnectionRetry.addEventListener('click', async () => {
    if (!retryContext) {
      hideModelConnectionDialog();
      return;
    }
    
    hideModelConnectionDialog();
    
    if (retryContext.type === 'ollama') {
      // Retry Ollama connection
      connectButton.click();
    } else if (retryContext.type === 'model' && retryContext.model) {
      // Retry model check
      const url = ollamaUrlInput.value.trim();
      showModelConnectionDialog('Checking model responsiveness...', false);
      modelSelect.disabled = true;
      modelSelect.value = retryContext.model; // Set the model again
      
      console.log('Retrying model check for:', retryContext.model, 'at URL:', url);
      
      try {
        // Check model availability with /api/show (fast; no inference)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        console.log('Checking model availability:', `${url}/api/show`);
        
        const response = await fetch(`${url}/api/show`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: retryContext.model }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        console.log('Response status:', response.status, response.statusText);
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('Model check failed - Response error:', errorData);
          throw new Error(errorData.error || `Model unavailable: ${response.status}`);
        }
        
        const data = await response.json().catch(() => null);
        if (data && (data.name || data.modelfile !== undefined)) {
          console.log('Model check successful! Model is available.');
          currentModel = retryContext.model;
          console.log('currentModel set to:', currentModel);
          hideModelConnectionDialog();
          updateOllamaStatus(true, retryContext.model);
          startConnectionMonitoring();
          updateSystemMessageButtonVisibility();
          updateRAGSettingsVisibility();
          checkForRAGs();
          resetModelContextWindow();
          updateSendButtonState();
          modelSelect.disabled = false;
        } else {
          console.error('Model check failed - Invalid or empty response');
          throw new Error('Model metadata invalid or missing');
        }
      } catch (error) {
        console.error('Model check error:', error.name, error.message, error);
        let errorMessage = '';
        if (error.name === 'AbortError') {
          console.error('Model check timed out');
          errorMessage = 'Model check timed out. Ollama may be busy or unreachable.';
        } else {
          errorMessage = `Model check failed: ${error.message}`;
        }
        showModelConnectionDialog(errorMessage, true, 'model', retryContext.model);
        currentModel = null;
        modelSelect.value = '';
        modelSelect.disabled = false;
        updateOllamaStatus(false);
        stopConnectionMonitoring();
        updateSystemMessageButtonVisibility();
        updateRAGSettingsVisibility();
        resetModelContextWindow();
        updateSendButtonState();
      }
    }
  });
}

// Connection monitoring
function startConnectionMonitoring() {
  // Clear any existing monitoring
  stopConnectionMonitoring();
  
  // Check connection every 5 seconds
  connectionMonitorInterval = setInterval(async () => {
    if (!currentModel) {
      stopConnectionMonitoring();
      return;
    }

    const url = ollamaUrlInput.value.trim();
    try {
      // Quick check to see if model is still accessible
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(`${url}/api/show`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: currentModel
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('Connection check failed');
      }

      // Connection is still good
      updateOllamaStatus(true, currentModel);
    } catch (error) {
      // Connection interrupted
      updateOllamaStatus(false);
      currentModel = null;
      modelSelect.value = '';
      showModelConnectionDialog('Connection to Ollama interrupted.', true, 'ollama');
      stopConnectionMonitoring();
      updateSystemMessageButtonVisibility();
      updateRAGSettingsVisibility(); // Hide RAG settings when connection is lost
      updateSendButtonState(); // Disable send button
    }
  }, 5000); // Check every 5 seconds
}

function stopConnectionMonitoring() {
  if (connectionMonitorInterval) {
    clearInterval(connectionMonitorInterval);
    connectionMonitorInterval = null;
  }
}

// Connect button handler
connectButton.addEventListener('click', async () => {
  const url = ollamaUrlInput.value.trim();
  if (!url) {
    showModelConnectionDialog('Please enter an Ollama URL', true);
    return;
  }

  connectButton.disabled = true;
  connectButton.textContent = 'Connecting...';
  showModelConnectionDialog('Connecting to Ollama...', false);
  stopConnectionMonitoring(); // Stop any existing monitoring
  
  try {
    // Check if Ollama is accessible
    const response = await fetch(`${url}/api/tags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.models && data.models.length > 0) {
      // Populate model dropdown
      modelSelect.innerHTML = '<option value="">Select a model...</option>';
      data.models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = model.name;
        modelSelect.appendChild(option);
      });
      
      modelGroup.style.display = 'block';
      hideModelConnectionDialog(); // Close dialog on successful connection
      updateOllamaStatus(false); // Keep red until model is verified
      localStorage.setItem('ollamaUrl', url);
      updateConnectButtonState(); // Disable button when model menu appears
      // Don't restore model - always default to "Select a model..."
    } else {
      showModelConnectionDialog('Connected but no models found.', true, 'ollama'); // Show error if no models
      updateOllamaStatus(false);
      modelGroup.style.display = 'none'; // Ensure model menu is hidden
      updateConnectButtonState(); // Re-enable button since no models found
    }
  } catch (error) {
    showModelConnectionDialog(`Connection failed: ${error.message}`, true, 'ollama');
    updateOllamaStatus(false);
    modelGroup.style.display = 'none';
    stopConnectionMonitoring();
    updateConnectButtonState(); // Re-enable button on error
  } finally {
    connectButton.textContent = 'Connect';
    updateConnectButtonState(); // Update button state (will disable if model menu is visible)
  }
});

// RAG settings functionality
const ragSettingsSection = document.getElementById('ragSettingsSection');
const ragServerUrlInput = document.getElementById('ragServerUrl');
const ragThresholdInput = document.getElementById('ragThreshold');
const ragGroup = document.getElementById('ragGroup');
const ragSelect = document.getElementById('ragSelect');
let selectedRAGCollections = (() => {
  try {
    const raw = localStorage.getItem('ragCollections');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (_) {}
  return [];
})();

const RAG_THRESHOLD_DEFAULT = 0.6;

// Function to update RAG settings visibility (only show when model is connected - green status)
function updateRAGSettingsVisibility() {
  // Only show RAG settings when we have a model selected (green status)
  if (currentModel) {
    ragSettingsSection.style.display = 'block';
  } else {
    ragSettingsSection.style.display = 'none';
    ragGroup.style.display = 'none';
    selectedRAGCollections = [];
    if (ragSelect) Array.from(ragSelect.options).forEach(opt => { opt.selected = false; });
  }
  updateCitedDocsButtonVisibility();
}

// Show cited-docs button when model is connected (same as RAG settings)
function updateCitedDocsButtonVisibility() {
  if (citedDocsButton) {
    citedDocsButton.style.display = currentModel ? 'flex' : 'none';
  }
}

// Load saved RAG server URL or derive from Ollama URL
const currentOllamaUrl = ollamaUrlInput.value.trim() || defaultOllamaUrl;
const defaultRAGServerUrl = deriveRAGUrlFromOllama(currentOllamaUrl);
const savedRAGServerUrl = localStorage.getItem('ragServerUrl');
// Use saved RAG URL if it exists, otherwise derive from Ollama URL
ragServerUrlInput.value = savedRAGServerUrl || defaultRAGServerUrl;

// RAG threshold: default 0.6, persist when changed
if (ragThresholdInput) {
  const savedThreshold = localStorage.getItem('ragThreshold');
  ragThresholdInput.value = savedThreshold !== null && savedThreshold !== '' ? savedThreshold : RAG_THRESHOLD_DEFAULT;
  ragThresholdInput.addEventListener('change', () => {
    const v = parseFloat(ragThresholdInput.value);
    if (!Number.isNaN(v) && v >= 0 && v <= 1) {
      localStorage.setItem('ragThreshold', String(v));
    }
  });
}

// Save RAG server URL when changed
ragServerUrlInput.addEventListener('change', () => {
  localStorage.setItem('ragServerUrl', ragServerUrlInput.value);
  // Re-check for RAGs if model is connected
  if (currentModel) {
    checkForRAGs();
  }
});

// Check for available RAG collections
async function checkForRAGs() {
  const ragUrl = ragServerUrlInput.value.trim();
  if (!ragUrl) {
    ragGroup.style.display = 'none';
    selectedRAGCollections = [];
    return;
  }

  try {
    console.log('📤 Checking for RAG collections:');
    console.log(`   URL: ${ragUrl}/rags`);
    
    const response = await fetch(`${ragUrl}/rags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`📥 Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorData = await response.text().catch(() => 'Unknown error');
      console.error('❌ RAG collections check failed:', errorData);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('📥 RAG collections response:', JSON.stringify(data, null, 2));

    if (data.collections && data.collections.length > 0) {
      console.log(`✅ Found ${data.collections.length} RAG collections:`, data.collections);
      const saved = loadSelectedRAGCollections().filter(c => data.collections.includes(c));
      ragSelect.innerHTML = '';
      data.collections.forEach(collection => {
        const option = document.createElement('option');
        option.value = collection;
        option.textContent = collection;
        option.selected = saved.includes(collection);
        ragSelect.appendChild(option);
      });
      selectedRAGCollections = Array.from(ragSelect.selectedOptions).map(opt => opt.value);
      localStorage.setItem('ragCollections', JSON.stringify(selectedRAGCollections));
      ragGroup.style.display = 'block';
      localStorage.setItem('ragServerUrl', ragUrl);
    } else {
      console.log('⚠️ No RAG collections found');
      ragGroup.style.display = 'none';
      selectedRAGCollections = [];
    }
  } catch (error) {
    console.error('❌ Failed to check for RAG collections:', error);
    ragGroup.style.display = 'none';
    selectedRAGCollections = [];
  }
}

function loadSelectedRAGCollections() {
  try {
    const raw = localStorage.getItem('ragCollections');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (_) {}
  return [];
}

function saveSelectedRAGCollections() {
  if (!ragSelect) return;
  const selected = Array.from(ragSelect.selectedOptions).map(opt => opt.value).filter(Boolean);
  selectedRAGCollections = selected;
  localStorage.setItem('ragCollections', JSON.stringify(selected));
  console.log('RAG collections selected:', selected.length ? selected : '(none)');
}

ragSelect.addEventListener('change', saveSelectedRAGCollections);

// Make Ollama URL and model accessible globally
window.getOllamaUrl = () => ollamaUrlInput.value.trim();
window.getCurrentModel = () => currentModel;
window.setOllamaUrl = (url) => {
  ollamaUrlInput.value = url;
  localStorage.setItem('ollamaUrl', url);
};

// Make RAG functions accessible globally
window.getRAGServerUrl = () => ragServerUrlInput.value.trim();
window.getRAGThreshold = () => {
  if (!ragThresholdInput || ragThresholdInput.value === '') return RAG_THRESHOLD_DEFAULT;
  const v = parseFloat(ragThresholdInput.value);
  return (!Number.isNaN(v) && v >= 0 && v <= 1) ? v : RAG_THRESHOLD_DEFAULT;
};
window.getSelectedRAGCollections = () => selectedRAGCollections.length ? [...selectedRAGCollections] : [];
window.isRAGEnabled = () => selectedRAGCollections.length > 0;

// System Message functionality
const promptSettingsSection = document.getElementById('promptSettingsSection');
const systemMessageButton = document.getElementById('systemMessageButton');
const systemMessageDialog = document.getElementById('systemMessageDialog');
const systemMessageTextarea = document.getElementById('systemMessageTextarea');
const systemMessageHistory = document.getElementById('systemMessageHistory');
const systemMessageSave = document.getElementById('systemMessageSave');
const systemMessageCancel = document.getElementById('systemMessageCancel');
const systemMessageDelete = document.getElementById('systemMessageDelete');
const deleteSystemMessageDialog = document.getElementById('deleteSystemMessageDialog');
const deleteSystemMessageCancel = document.getElementById('deleteSystemMessageCancel');
const deleteSystemMessageConfirm = document.getElementById('deleteSystemMessageConfirm');

// Verify elements exist
if (!promptSettingsSection) {
  console.error('promptSettingsSection element not found!');
}
if (!systemMessageButton) {
  console.error('systemMessageButton element not found!');
}

// System message history management
function getSystemMessageHistory() {
  const historyJson = localStorage.getItem('systemMessageHistory');
  return historyJson ? JSON.parse(historyJson) : [];
}

function saveSystemMessageHistory(history) {
  localStorage.setItem('systemMessageHistory', JSON.stringify(history));
}

function addToSystemMessageHistory(message) {
  if (!message || !message.trim()) return;
  
  const history = getSystemMessageHistory();
  // Remove if already exists (to avoid duplicates)
  const filtered = history.filter(m => m !== message.trim());
  // Add to beginning
  filtered.unshift(message.trim());
  // Keep only last 20 messages
  const limited = filtered.slice(0, 20);
  saveSystemMessageHistory(limited);
}

function removeFromSystemMessageHistory(message) {
  const history = getSystemMessageHistory();
  const filtered = history.filter(m => m !== message.trim());
  saveSystemMessageHistory(filtered);
}

function populateSystemMessageHistoryDropdown() {
  if (!systemMessageHistory) return;
  
  const history = getSystemMessageHistory();
  systemMessageHistory.innerHTML = '<option value="">-- Select a previous message --</option>';
  
  history.forEach((msg, index) => {
    const option = document.createElement('option');
    // Truncate for display (first 60 chars)
    const displayText = msg.length > 60 ? msg.substring(0, 60) + '...' : msg;
    option.value = index;
    option.textContent = displayText;
    option.title = msg; // Full text in tooltip
    systemMessageHistory.appendChild(option);
  });
}

// Load saved system message
if (systemMessageTextarea) {
  const savedSystemMessage = localStorage.getItem('systemMessage') || '';
  systemMessageTextarea.value = savedSystemMessage;
  // Add current message to history if it exists and isn't already there
  if (savedSystemMessage) {
    const history = getSystemMessageHistory();
    if (!history.includes(savedSystemMessage)) {
      addToSystemMessageHistory(savedSystemMessage);
    }
  }
}

// Show system message section when model is selected
function updateSystemMessageButtonVisibility() {
  console.log('updateSystemMessageButtonVisibility called');
  console.log('  currentModel:', currentModel);
  console.log('  promptSettingsSection exists:', !!promptSettingsSection);
  console.log('  systemMessageButton exists:', !!systemMessageButton);
  
  if (promptSettingsSection) {
    if (currentModel) {
      console.log('  -> Showing prompt settings section (currentModel is set)');
      promptSettingsSection.style.display = 'block';
      // Also ensure button is visible (remove inline style if present)
      if (systemMessageButton) {
        systemMessageButton.style.display = 'block';
        console.log('  -> System message button displayed');
      }
    } else {
      console.log('  -> Hiding prompt settings section (no currentModel)');
      promptSettingsSection.style.display = 'none';
    }
  } else {
    console.error('  -> ERROR: promptSettingsSection not found, cannot update visibility');
  }
}

// Open dialog
if (systemMessageButton) {
  systemMessageButton.addEventListener('click', () => {
    if (systemMessageDialog) {
      systemMessageDialog.style.display = 'flex';
      // Load current saved message
      if (systemMessageTextarea) {
        systemMessageTextarea.value = localStorage.getItem('systemMessage') || '';
        systemMessageTextarea.focus();
      }
      // Populate history dropdown
      populateSystemMessageHistoryDropdown();
      // Reset dropdown selection
      if (systemMessageHistory) {
        systemMessageHistory.value = '';
        updateDeleteButtonVisibility();
      }
    }
  });
}

// Close dialog
function closeSystemMessageDialog() {
  if (systemMessageDialog) {
    systemMessageDialog.style.display = 'none';
  }
}

// History dropdown selection
if (systemMessageHistory) {
  systemMessageHistory.addEventListener('change', () => {
    const selectedIndex = systemMessageHistory.value;
    if (selectedIndex !== '' && systemMessageTextarea) {
      const history = getSystemMessageHistory();
      const selectedMessage = history[parseInt(selectedIndex)];
      if (selectedMessage) {
        systemMessageTextarea.value = selectedMessage;
        systemMessageTextarea.focus();
      }
    }
    updateDeleteButtonVisibility();
  });
}

// Update delete button visibility based on dropdown selection
function updateDeleteButtonVisibility() {
  if (systemMessageDelete && systemMessageHistory) {
    systemMessageDelete.style.display = systemMessageHistory.value !== '' ? 'block' : 'none';
  }
}

// Delete button
if (systemMessageDelete) {
  systemMessageDelete.addEventListener('click', () => {
    const selectedIndex = systemMessageHistory.value;
    if (selectedIndex !== '') {
      // Show confirmation dialog
      if (deleteSystemMessageDialog) {
        deleteSystemMessageDialog.style.display = 'flex';
      }
    }
  });
}

// Delete confirmation handlers
if (deleteSystemMessageCancel) {
  deleteSystemMessageCancel.addEventListener('click', () => {
    if (deleteSystemMessageDialog) {
      deleteSystemMessageDialog.style.display = 'none';
    }
  });
}

if (deleteSystemMessageConfirm) {
  deleteSystemMessageConfirm.addEventListener('click', () => {
    const selectedIndex = systemMessageHistory.value;
    if (selectedIndex !== '' && systemMessageHistory) {
      const history = getSystemMessageHistory();
      const messageToDelete = history[parseInt(selectedIndex)];
      
      if (messageToDelete) {
        // Remove from history
        removeFromSystemMessageHistory(messageToDelete);
        
        // If this was the current saved message, clear it
        const currentMessage = localStorage.getItem('systemMessage') || '';
        if (currentMessage === messageToDelete) {
          localStorage.setItem('systemMessage', '');
        }
        
        // Clear textarea
        if (systemMessageTextarea) {
          systemMessageTextarea.value = '';
        }
        
        // Reset dropdown and repopulate
        systemMessageHistory.value = '';
        populateSystemMessageHistoryDropdown();
        updateDeleteButtonVisibility();
      }
    }
    
    // Close confirmation dialog
    if (deleteSystemMessageDialog) {
      deleteSystemMessageDialog.style.display = 'none';
    }
  });
}

// Close delete confirmation dialog on overlay click
if (deleteSystemMessageDialog) {
  deleteSystemMessageDialog.addEventListener('click', (e) => {
    if (e.target === deleteSystemMessageDialog) {
      deleteSystemMessageDialog.style.display = 'none';
    }
  });
}

// Cancel button
if (systemMessageCancel) {
  systemMessageCancel.addEventListener('click', () => {
    // Restore saved message (discard changes)
    if (systemMessageTextarea) {
      systemMessageTextarea.value = localStorage.getItem('systemMessage') || '';
    }
    // Reset dropdown
    if (systemMessageHistory) {
      systemMessageHistory.value = '';
      updateDeleteButtonVisibility();
    }
    closeSystemMessageDialog();
  });
}

// Save button
if (systemMessageSave) {
  systemMessageSave.addEventListener('click', () => {
    if (systemMessageTextarea) {
      const message = systemMessageTextarea.value.trim();
      localStorage.setItem('systemMessage', message);
      // Add to history if not empty
      if (message) {
        addToSystemMessageHistory(message);
      }
    }
    closeSystemMessageDialog();
  });
}

// Close dialog when clicking outside
if (systemMessageDialog) {
  systemMessageDialog.addEventListener('click', (e) => {
    if (e.target === systemMessageDialog) {
      // Restore saved message (discard changes)
      if (systemMessageTextarea) {
        systemMessageTextarea.value = localStorage.getItem('systemMessage') || '';
      }
      // Reset dropdown
      if (systemMessageHistory) {
        systemMessageHistory.value = '';
        updateDeleteButtonVisibility();
      }
      closeSystemMessageDialog();
    }
  });
}

// Close dialog with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (systemMessageDialog && systemMessageDialog.style.display === 'flex') {
      // Restore saved message (discard changes)
      if (systemMessageTextarea) {
        systemMessageTextarea.value = localStorage.getItem('systemMessage') || '';
      }
      // Reset dropdown
      if (systemMessageHistory) {
        systemMessageHistory.value = '';
        updateDeleteButtonVisibility();
      }
      closeSystemMessageDialog();
    } else if (deleteSystemMessageDialog && deleteSystemMessageDialog.style.display === 'flex') {
      deleteSystemMessageDialog.style.display = 'none';
    }
  }
});

// Initialize button visibility and state on page load
updateSystemMessageButtonVisibility();
updateRAGSettingsVisibility(); // Hide RAG settings initially
updateConnectButtonState(); // Set initial connect button state

// Chat text size controls (upper left)
const CHAT_FONT_MIN = 10;
const CHAT_FONT_MAX = 24;
const CHAT_FONT_DEFAULT = 14;
const CHAT_FONT_STEP = 2;

const mainContent = document.getElementById('mainContent');
const chatFontSmaller = document.getElementById('chatFontSmaller');
const chatFontLarger = document.getElementById('chatFontLarger');

function getChatFontSize() {
  const raw = localStorage.getItem('chatFontSize');
  if (raw !== null && raw !== '') {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= CHAT_FONT_MIN && n <= CHAT_FONT_MAX) return n;
  }
  return CHAT_FONT_DEFAULT;
}

function setChatFontSize(px) {
  const clamped = Math.max(CHAT_FONT_MIN, Math.min(CHAT_FONT_MAX, px));
  if (mainContent) mainContent.style.setProperty('--chat-font-size', `${clamped}px`);
  localStorage.setItem('chatFontSize', String(clamped));
  return clamped;
}

if (mainContent) setChatFontSize(getChatFontSize());
if (chatFontSmaller) {
  chatFontSmaller.addEventListener('click', () => setChatFontSize(getChatFontSize() - CHAT_FONT_STEP));
}
if (chatFontLarger) {
  chatFontLarger.addEventListener('click', () => setChatFontSize(getChatFontSize() + CHAT_FONT_STEP));
}

// Chat functionality
const chatContainer = document.getElementById('chatContainer');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendButton');
let chatHistory = []; // Array of {role: 'user'|'assistant', content: string}
// RAG citations: single source of truth on window so dialog and RAG code always see the same array
if (!window.__conversationCitations) window.__conversationCitations = [];
let isWaitingForResponse = false;

// Model context window cache
let modelContextWindow = null;

// Estimate tokens (rough approximation: 1 token ≈ 4 characters for English)
// This is a conservative estimate - actual tokens may vary
function estimateTokens(text) {
  // Better approximation: account for spaces and punctuation
  // Average is about 4 chars per token, but can be 3-5 depending on content
  return Math.ceil(text.length / 4);
}

// Get model context window from Ollama API
async function getModelContextWindow() {
  // Return cached value if available
  if (modelContextWindow !== null) {
    return modelContextWindow;
  }

  const ollamaUrl = window.getOllamaUrl();
  const model = window.getCurrentModel();
  
  if (!ollamaUrl || !model) {
    // Default fallback
    return 4096;
  }

  try {
    console.log('📤 Fetching model context window:');
    console.log(`   URL: ${ollamaUrl}/api/show`);
    console.log(`   Model: ${model}`);
    
    const requestBody = { name: model };
    console.log('📤 Request body:', JSON.stringify(requestBody, null, 2));
    
    // Query Ollama for model information
    const response = await fetch(`${ollamaUrl}/api/show`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`📥 Response status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();
      // Log sanitized response (omit license, modelfile, tensors — huge and noisy)
      const sanitized = { ...data };
      delete sanitized.license;
      delete sanitized.modelfile;
      delete sanitized.tensors;
      console.log('📥 Model show (sanitized):', JSON.stringify(sanitized, null, 2));
      // Ollama reports context length: top-level, or model_info with flat keys e.g. "llama.context_length"
      let ctx = data.context_length;
      if (typeof ctx !== 'number' || ctx <= 0) {
        const info = data.model_info || {};
        ctx = info['llama.context_length'] ?? info['gemma3.context_length'] ?? info['context_length'];
        if (typeof ctx !== 'number' || ctx <= 0) {
          const contextKey = Object.keys(info).find(k => k.endsWith('.context_length') || k === 'context_length');
          if (contextKey) ctx = info[contextKey];
        }
      }
      if (typeof ctx === 'number' && ctx > 0) {
        modelContextWindow = ctx;
        console.log(`Model context window: ${modelContextWindow}`);
        return modelContextWindow;
      }
      // parameters string e.g. "num_ctx 32768\n..."
      if (data.parameters && typeof data.parameters === 'string') {
        const numCtxMatch = data.parameters.match(/num_ctx\s+(\d+)/i);
        if (numCtxMatch) {
          modelContextWindow = parseInt(numCtxMatch[1], 10);
          console.log(`Model context window (from parameters): ${modelContextWindow}`);
          return modelContextWindow;
        }
      }
      if (data.modelfile) {
        const contextMatch = data.modelfile.match(/PARAMETER\s+context_length\s+(\d+)/i);
        if (contextMatch) {
          modelContextWindow = parseInt(contextMatch[1], 10);
          return modelContextWindow;
        }
      }
    }
  } catch (error) {
    console.warn('Could not fetch model context window:', error);
  }

  // Fallback: Use model-specific defaults based on common model sizes
  const modelName = model.toLowerCase();
  if (modelName.includes('llama2') || modelName.includes('mistral')) {
    modelContextWindow = 4096;
  } else if (modelName.includes('llama3') || modelName.includes('qwen')) {
    modelContextWindow = 8192;
  } else if (modelName.includes('gpt') || modelName.includes('claude')) {
    modelContextWindow = 4096; // Conservative default
  } else {
    modelContextWindow = 4096; // Safe default for most models
  }

  console.log(`Using default context window for ${model}: ${modelContextWindow}`);
  return modelContextWindow;
}

// Reset context window cache when model changes
function resetModelContextWindow() {
  modelContextWindow = null;
}

// Show summarizing indicator in chat
function showSummarizingIndicator() {
  const indicatorDiv = document.createElement('div');
  indicatorDiv.className = 'chat-message assistant';
  indicatorDiv.id = 'summarizingIndicator';
  
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble summarizing-bubble';
  bubble.innerHTML = '<span class="summarizing-text">📝 Summarizing conversation history...</span>';
  
  indicatorDiv.appendChild(bubble);
  chatContainer.appendChild(indicatorDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Remove summarizing indicator
function removeSummarizingIndicator() {
  const indicator = document.getElementById('summarizingIndicator');
  if (indicator) {
    indicator.remove();
  }
}

// Summarize history when it exceeds token limit
async function summarizeHistory() {
  if (chatHistory.length === 0) return;

  const ollamaUrl = window.getOllamaUrl();
  const model = window.getCurrentModel();
  if (!ollamaUrl || !model) {
    console.warn('Cannot summarize history: Ollama URL or model not available');
    return;
  }

  console.log('🔄 Starting history summarization...');
  console.log(`📊 Current history length: ${chatHistory.length} messages`);
  
  // Show visual indicator
  showSummarizingIndicator();

  // Create a summary prompt from prior turns only (exclude current user message so we don't fold it into the summary and then repeat it in the prompt)
  const historyForSummary = chatHistory.slice(0, -1);
  const historyText = historyForSummary.length > 0
    ? historyForSummary.map(msg => `${msg.role}: ${msg.content}`).join('\n\n')
    : '';
  const summaryPrompt = historyText
    ? `Please provide a concise summary of the following conversation history:\n\n${historyText}\n\nSummary:`
    : '';

  if (!summaryPrompt) {
    console.warn('⚠️ No prior history to summarize; skipping summarization');
    removeSummarizingIndicator();
    return;
  }

  console.log('📤 Sending summarization request to Ollama:');
  console.log(`   URL: ${ollamaUrl}/api/generate`);
  console.log(`   Model: ${model}`);
  console.log(`   Prompt length: ${summaryPrompt.length} characters`);

  try {
    const requestBody = {
      model: model,
      prompt: summaryPrompt,
      stream: false
    };
    
    console.log('📤 Request body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`📥 Response status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();
      console.log('📥 Response data:', JSON.stringify(data, null, 2));
      
      const summary = data.response || '';
      console.log('✅ Summarization complete!');
      console.log('📝 Summary received:', summary);
      console.log(`📏 Summary length: ${summary.length} characters`);
      
      // Replace history with summary, but keep the current user message so the rebuilt prompt includes both
      const oldHistoryLength = chatHistory.length;
      const lastMessage = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
      const currentUserMessage = lastMessage && lastMessage.role === 'user' ? lastMessage : null;
      chatHistory = [
        {
          role: 'assistant',
          content: `[Previous conversation summarized: ${summary}]`
        }
      ];
      if (currentUserMessage) {
        chatHistory.push(currentUserMessage);
        console.log(`🔄 History replaced: ${oldHistoryLength} messages → 1 summary + current user message`);
      } else {
        console.log(`🔄 History replaced: ${oldHistoryLength} messages → 1 summary message`);
      }
      
      // Update visual indicator
      removeSummarizingIndicator();
      const summaryDiv = document.createElement('div');
      summaryDiv.className = 'chat-message assistant';
      const summaryBubble = document.createElement('div');
      summaryBubble.className = 'chat-bubble summarizing-bubble';
      summaryBubble.innerHTML = `<span class="summarizing-text">✅ Conversation history summarized</span>`;
      summaryDiv.appendChild(summaryBubble);
      chatContainer.appendChild(summaryDiv);
      chatContainer.scrollTop = chatContainer.scrollHeight;
      
      // Remove the summary indicator after a few seconds
      setTimeout(() => {
        summaryDiv.style.opacity = '0';
        summaryDiv.style.transition = 'opacity 0.5s ease';
        setTimeout(() => summaryDiv.remove(), 500);
      }, 3000);
    } else {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('❌ Summarization failed:', errorData);
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(errorData)}`);
    }
  } catch (error) {
    console.error('❌ Failed to summarize history:', error);
    removeSummarizingIndicator();
    
    // If summarization fails, clear old history but keep recent messages
    if (chatHistory.length > 10) {
      const keptMessages = chatHistory.slice(-5);
      console.log(`⚠️ Summarization failed, keeping last 5 messages (${chatHistory.length} → ${keptMessages.length})`);
      chatHistory = keptMessages;
    }
    
    // Show error indicator
    const errorDiv = document.createElement('div');
    errorDiv.className = 'chat-message assistant';
    const errorBubble = document.createElement('div');
    errorBubble.className = 'chat-bubble summarizing-bubble error';
    errorBubble.innerHTML = `<span class="summarizing-text">⚠️ Failed to summarize history</span>`;
    errorDiv.appendChild(errorBubble);
    chatContainer.appendChild(errorDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

// Check and manage token limit
async function manageTokenLimit(fullPrompt = null) {
  // If fullPrompt is provided, use it (includes system message, RAG context, history, and current message)
  // Otherwise, fall back to old behavior for backwards compatibility
  let totalTokens;
  
  if (fullPrompt) {
    // Calculate tokens from the complete final prompt
    totalTokens = estimateTokens(fullPrompt);
    
    console.log('🔍 Checking token usage (based on full prompt):');
    console.log(`   Full prompt length: ${fullPrompt.length} characters`);
    console.log(`   Estimated tokens: ${totalTokens}`);
  } else {
    // Fallback: calculate from components (old behavior)
    const systemMessage = window.getSystemMessage() || '';
    const systemTokens = estimateTokens(systemMessage);
    
    console.log('🔍 Checking token usage:');
    console.log(`   System message tokens: ${systemTokens}`);
    
    // Calculate total tokens in history
    totalTokens = systemTokens;
    let historyBreakdown = [];
    for (const msg of chatHistory) {
      const msgTokens = estimateTokens(msg.content);
      totalTokens += msgTokens;
      historyBreakdown.push(`${msg.role}: ${msgTokens} tokens`);
    }
    
    console.log(`   History messages: ${chatHistory.length}`);
    console.log(`   History breakdown:`, historyBreakdown);
    console.log(`   Total history tokens: ${totalTokens - systemTokens}`);
  }
  
  // Get actual model context window (async)
  const contextWindow = await getModelContextWindow();
  const reservedTokens = 500; // Reserve tokens for response generation
  const availableTokens = contextWindow - reservedTokens;
  
  console.log(`📊 Token usage summary:`);
  console.log(`   Total tokens: ${totalTokens}`);
  console.log(`   Context window: ${contextWindow}`);
  console.log(`   Reserved for response: ${reservedTokens}`);
  console.log(`   Available: ${availableTokens}`);
  console.log(`   Usage: ${((totalTokens / availableTokens) * 100).toFixed(1)}%`);
  
  if (totalTokens > availableTokens) {
    console.log('⚠️ Token limit exceeded!');
    console.log(`   ${totalTokens} tokens > ${availableTokens} available tokens`);
    console.log('🔄 Triggering history summarization...');
    await summarizeHistory();
    return true; // Indicate that prompt needs to be rebuilt
  } else {
    console.log('✅ Token usage within limits');
    return false; // No rebuild needed
  }
}

// Treat prompt as substantive for RAG: skip trivial/short prompts when there's no history
function isSubstantivePrompt(message) {
  const trimmed = (message || '').trim();
  if (trimmed.length < 15) return false;
  const trivial = /^(hi|hello|hey|ok|okay|thanks|thank you|yes|no|\?|!|\.|nope|yep|yup|sup|yo|hiya|howdy|greetings|good (morning|afternoon|evening)|bye|goodbye|lol|lmao)$/i;
  if (trivial.test(trimmed)) return false;
  return true;
}

// Strip "Some related resources" section from assistant content when building prompt history
function contentForPrompt(msg) {
  if (msg.role !== 'assistant' || typeof msg.content !== 'string') return msg.content;
  const marker = '\n\nSome related resources:\n';
  const idx = msg.content.indexOf(marker);
  if (idx === -1) return msg.content;
  return msg.content.slice(0, idx).trimEnd();
}

// Add message to chat
function addMessageToChat(role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${role}`;
  
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  if (role === 'assistant') {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-message-text markdown-body';
    wrapper.innerHTML = renderMarkdown(content);
    bubble.appendChild(wrapper);
  } else {
    bubble.textContent = content;
  }
  
  messageDiv.appendChild(bubble);
  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Show typing indicator
function showTypingIndicator() {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'chat-message assistant';
  typingDiv.id = 'typingIndicator';
  
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('div');
    dot.className = 'typing-dot';
    indicator.appendChild(dot);
  }
  
  typingDiv.appendChild(indicator);
  chatContainer.appendChild(typingDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Remove typing indicator
function removeTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) {
    indicator.remove();
  }
}

// Send message
async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message || isWaitingForResponse) return;

  const ollamaUrl = window.getOllamaUrl();
  const model = window.getCurrentModel();
  if (!ollamaUrl || !model) {
    alert('Please connect to Ollama and select a model first.');
    return;
  }

  // Add user message to chat
  addMessageToChat('user', message);
  chatHistory.push({ role: 'user', content: message });
  
  // Clear input
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendButton.disabled = true;
  isWaitingForResponse = true;

  // Show typing indicator
  showTypingIndicator();

  // Build conversation history string for RAG (if needed)
  // Format: "User: message\nAssistant: response\nUser: message..."
  let conversationHistory = '';
  for (const msg of chatHistory.slice(0, -1)) { // Exclude the current message
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    conversationHistory += `${roleLabel}: ${msg.content}\n`;
  }

  // Check if RAG is enabled and query RAG server with history
  const ragEnabled = window.isRAGEnabled();
  const ragCollections = window.getSelectedRAGCollections();
  const ragServerUrl = window.getRAGServerUrl();
  const hasHistory = chatHistory.length > 1; // more than just the current user message
  const shouldQueryRAG = ragEnabled && ragCollections.length > 0 && ragServerUrl && (isSubstantivePrompt(message) || hasHistory);

  let ragContext = '';
  let ragSourceUrls = []; // Track unique source URLs for this response
  if (!ragEnabled || ragCollections.length === 0 || !ragServerUrl) {
    if (ragEnabled || ragCollections.length > 0 || ragServerUrl) {
      console.log('⚠️ RAG skipped: missing', !ragEnabled ? 'enabled' : '', ragCollections.length === 0 ? 'collections' : '', !ragServerUrl ? 'RAG server URL' : '');
    }
  } else if (!shouldQueryRAG) {
    console.log('⚠️ RAG skipped: prompt not substantive and no conversation history');
  }
  if (shouldQueryRAG) {
    try {
      // Build RAG request with prompt, groups (array), threshold, and optional history
      const threshold = window.getRAGThreshold();
      const ragRequestBody = {
        prompt: message,
        group: ragCollections,
        threshold,
        limit_chunk_role: true
      };

      // Add conversation history if available (for better query expansion)
      if (conversationHistory.trim()) {
        ragRequestBody.history = conversationHistory;
      }

      console.log('📤 Querying RAG server:');
      console.log(`   URL: ${ragServerUrl}/query`);
      console.log(`   Collections: ${ragCollections.join(', ')}`);
      console.log(`   Threshold: ${threshold}`);
      console.log(`   Prompt: ${message}`);
      if (conversationHistory) {
        console.log(`   History length: ${conversationHistory.length} characters`);
      }
      console.log('📤 RAG request body:', JSON.stringify(ragRequestBody, null, 2));

      // Query RAG server
      const ragResponse = await fetch(`${ragServerUrl}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(ragRequestBody)
      });

      console.log(`📥 RAG response status: ${ragResponse.status} ${ragResponse.statusText}`);

      if (ragResponse.ok) {
        const ragData = await ragResponse.json();
        console.log('📥 RAG response: count =', ragData.count ?? ragData.results?.length ?? 0);
        
        if (ragData.results && ragData.results.length > 0) {
          console.log(`✅ Found ${ragData.results.length} RAG results`);
          const first = ragData.results[0];
          console.log(`📋 First result keys:`, first ? Object.keys(first) : 'none');
          console.log(`📋 First result source_url:`, first?.source_url ?? first?.sourceUrl ?? '(none)');
          
          // Sort by similarity (descending) and take top 8
          const sortedResults = [...ragData.results].sort((a, b) => {
            const simA = a.similarity || 0;
            const simB = b.similarity || 0;
            return simB - simA; // Descending order
          });
          const topResults = sortedResults.slice(0, 8);
          
          console.log(`📊 Using top ${topResults.length} results by similarity:`);
          topResults.forEach((result, idx) => {
            console.log(`   ${idx + 1}. ${result.source_name} (similarity: ${result.similarity?.toFixed(4) || 'N/A'})`);
          });
          
          // Build context from top 8 RAG results and collect sources for Relevant Resources dialog
          ragContext = '\n\nRelevant context retrieved from documents appears below. Use it in developing your answer, but don\'t refer to the documents either individually or as a group in any way.\n\n';
          const sourceMap = new Map(); // key -> { url, sourceName, similarity }
          const baseUrl = (ragServerUrl || '').replace(/\/$/, '');
          console.log(`🔗 RAG baseUrl for links:`, baseUrl);
          topResults.forEach((result, idx) => {
            ragContext += `${idx + 1}. ${result.text}\n\n`;
            
            const sourceName = result.source_name || result.sourceName || result.source || 'Unknown';
            let path = result.source_url || result.sourceUrl || '';
            if (!path && result.group && sourceName !== 'Unknown') {
              path = `/fetch/${encodeURIComponent(result.group)}/${encodeURIComponent(sourceName)}`;
            }
            const fullUrl = path ? `${baseUrl}/${path.replace(/^\//, '')}` : '#';
            const key = fullUrl !== '#' ? fullUrl : sourceName;
            const sim = typeof result.similarity === 'number' ? result.similarity : 0;
            if (!sourceMap.has(key)) {
              sourceMap.set(key, { url: fullUrl, sourceName, similarity: sim });
            } else {
              const existing = sourceMap.get(key);
              if (sim > existing.similarity) existing.similarity = sim;
            }
          });
          ragSourceUrls.push(...sourceMap.values());
          
          if (ragSourceUrls.length > 0) {
            console.log(`🔗 First citation URL:`, ragSourceUrls[0].url);
          }
          console.log(`🔗 Collected ${ragSourceUrls.length} unique source URLs:`, ragSourceUrls);
          
          window.__previousCitedOrder = getCitedOrderKeys(window.__conversationCitations || []);
          window.__previousCitedEntries = getCitedOrderEntries(window.__conversationCitations || []);
          const turnIndex = window.__citationTurnIndex || 0;
          for (const source of ragSourceUrls) {
            window.__conversationCitations.push({
              sourceName: source.sourceName,
              url: source.url,
              turnIndex,
              similarity: typeof source.similarity === 'number' ? source.similarity : null
            });
          }
          window.__citationTurnIndex = turnIndex + 1;
          console.log(`🔗 Recorded ${ragSourceUrls.length} citations (total: ${window.__conversationCitations.length})`);
          
          console.log(`📝 RAG context length: ${ragContext.length} characters`);
        } else {
          console.log('⚠️ No RAG results found');
        }
      } else {
        const responseText = await ragResponse.text();
        console.error('❌ RAG query failed:', ragResponse.status, ragResponse.statusText);
        try {
          const errorData = JSON.parse(responseText);
          console.error('❌ RAG error body:', errorData);
        } catch {
          console.error('❌ RAG response body (first 500 chars):', responseText.slice(0, 500));
        }
      }
    } catch (error) {
      console.error('❌ RAG query error:', error);
    }
  }

  // Build prompt with system message, history, RAG context, and current message
  const systemMessage = window.getSystemMessage() || '';
  let fullPrompt = '';
  
  if (systemMessage) {
    fullPrompt += `System: ${systemMessage}\n\n`;
  }

  // Add RAG context before history if available
  if (ragContext) {
    fullPrompt += ragContext;
  }

  // Add conversation history (exclude "Some related resources" links from assistant messages)
  for (const msg of chatHistory.slice(0, -1)) { // Exclude the current message
    const content = contentForPrompt(msg);
    fullPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${content}\n\n`;
  }

  // Add current user message and instruct model how to respond
  fullPrompt += `Use all of the above context (system instructions, conversation history, and any retrieved information) to respond thoughtfully to the user's latest prompt, which is below. Provide an integrated response written in your established coaching voice. Do not label speakers. When appropriate, connect the response to earlier insights or tensions already identified in the conversation.\n\nUser: ${message}\n\nAssistant:`;

  // Manage token limit - check AFTER RAG context is added, based on total final prompt
  const needsRebuild = await manageTokenLimit(fullPrompt);
  
  // If history was summarized, rebuild the prompt with updated history
  if (needsRebuild) {
    console.log('🔄 Rebuilding prompt after history summarization...');
    
    // Rebuild full prompt with updated history
    fullPrompt = '';
    
    if (systemMessage) {
      fullPrompt += `System: ${systemMessage}\n\n`;
    }
    
    // Add RAG context (already retrieved, no need to query again)
    if (ragContext) {
      fullPrompt += ragContext;
    }
    
    // Add conversation history (now with summarized history; exclude "Some related resources" from assistant)
    for (const msg of chatHistory.slice(0, -1)) { // Exclude the current message
      const content = contentForPrompt(msg);
      fullPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${content}\n\n`;
    }
    
    // Add current user message and instruct model how to respond
    fullPrompt += `Use all of the above context (system instructions, conversation history, and any retrieved information) to respond thoughtfully to the user's latest prompt, which is below. Provide an integrated response written in your established coaching voice. Do not label speakers. When appropriate, connect the response to earlier insights or tensions already identified in the conversation.\n\nUser: ${message}\n\nAssistant:`;
    
    console.log('✅ Prompt rebuilt with summarized history');
    console.log(`   New prompt length: ${fullPrompt.length} characters`);
    console.log(`   Estimated tokens: ${estimateTokens(fullPrompt)}`);
  }

  console.log('📤 Sending message to Ollama:');
  console.log(`   URL: ${ollamaUrl}/api/generate`);
  console.log(`   Model: ${model}`);
  console.log(`   Prompt length: ${fullPrompt.length} characters`);
  console.log(`   Estimated tokens: ${estimateTokens(fullPrompt)}`);
  if (ragContext) {
    console.log(`   RAG context included: ${ragContext.length} characters`);
  }
  console.log('📝 FULL PROMPT:');
  console.log('='.repeat(80));
  console.log(fullPrompt);
  console.log('='.repeat(80));

  try {
    const requestBody = {
      model: model,
      prompt: fullPrompt,
      stream: true
    };
    console.log('📤 Request body (streaming):', JSON.stringify({ ...requestBody, prompt: '[Full prompt logged above]' }, null, 2));
    
    // Send to Ollama
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`📥 Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('❌ Ollama request failed:', errorData);
      throw new Error(`HTTP error! status: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    // Remove typing indicator
    removeTypingIndicator();

    // Stream response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMessage = '';
    let messageDiv = null;
    let bubble = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.trim() === '') continue;
        try {
          const data = JSON.parse(line);
          if (data.response) {
            assistantMessage += data.response;
            
            // Create message div on first chunk
            if (!messageDiv) {
              messageDiv = document.createElement('div');
              messageDiv.className = 'chat-message assistant';
              bubble = document.createElement('div');
              bubble.className = 'chat-bubble';
              const wrapper = document.createElement('div');
              wrapper.className = 'chat-message-text markdown-body';
              bubble.appendChild(wrapper);
              messageDiv.appendChild(bubble);
              chatContainer.appendChild(messageDiv);
            }
            
            // Update markdown content
            const wrapper = bubble.querySelector('.chat-message-text');
            if (wrapper) {
              wrapper.innerHTML = renderMarkdown(assistantMessage);
            } else {
              bubble.textContent = assistantMessage;
            }
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }
          if (data.done) {
            break;
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    }

    // Add assistant message to history (trim leading space, final markdown render)
    if (assistantMessage) {
      assistantMessage = assistantMessage.trimStart();
      if (bubble) {
        const wrapper = bubble.querySelector('.chat-message-text');
        if (wrapper) wrapper.innerHTML = renderMarkdown(assistantMessage);
      }
      console.log('✅ Response received:');
      console.log(`   Length: ${assistantMessage.length} characters`);
      console.log(`   Estimated tokens: ${estimateTokens(assistantMessage)}`);
      console.log('📝 FULL RESPONSE:');
      console.log('='.repeat(80));
      console.log(assistantMessage);
      console.log('='.repeat(80));
      chatHistory.push({ role: 'assistant', content: assistantMessage });
    } else {
      console.warn('⚠️ No response content received');
    }

  } catch (error) {
    removeTypingIndicator();
    console.error('Error sending message:', error);
    addMessageToChat('assistant', `Error: ${error.message}`);
  } finally {
    isWaitingForResponse = false;
    updateSendButtonState(); // Update send button state
  }
}

// Send button click
sendButton.addEventListener('click', sendMessage);

// Enter key to send (Shift+Enter for new line)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  
  // Update send button state
  updateSendButtonState();
});

// Update send button state when model connection changes
function updateSendButtonState() {
  if (!sendButton || !chatInput) return;
  const hasModel = window.getCurrentModel() !== null;
  const hasText = chatInput.value.trim().length > 0;
  sendButton.disabled = !hasModel || !hasText || isWaitingForResponse;
  console.log(`Send button state: hasModel=${hasModel}, hasText=${hasText}, isWaiting=${isWaitingForResponse}, disabled=${sendButton.disabled}`);
}

// Update send button when model connection changes
function onModelConnectionChange() {
  updateSendButtonState();
}

// Hook into model connection updates by wrapping the existing function
(function() {
  const originalUpdateOllamaStatus = updateOllamaStatus;
  window.updateOllamaStatus = function(connected, modelName) {
    originalUpdateOllamaStatus(connected, modelName);
    if (typeof updateSendButtonState === 'function') {
      updateSendButtonState();
    }
  };
})();

// Initial state - ensure send button is disabled initially
updateSendButtonState();

// Make system message accessible globally (if not already defined)
if (!window.getSystemMessage) {
  window.getSystemMessage = () => localStorage.getItem('systemMessage') || '';
}
