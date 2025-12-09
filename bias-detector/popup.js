// popup.js - Handles UI interactions with new TruthDetector design

// DOM Elements
const apiKeyInput = document.getElementById('apiKey');
const saveApiKeyBtn = document.getElementById('saveApiKey');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusDiv = document.getElementById('status');
const loadingDiv = document.getElementById('loading');
const scoreSection = document.getElementById('scoreSection');
const tabs = document.getElementById('tabs');
const settingsBtn = document.getElementById('settingsBtn');
const collapseBtn = document.getElementById('collapseBtn');
const apiSection = document.getElementById('apiSection');

// Score elements
const scoreNumber = document.getElementById('scoreNumber');
const reliabilityBadge = document.getElementById('reliabilityBadge');
const heuristicBaseline = document.getElementById('heuristicBaseline');
const politicalLeaning = document.getElementById('politicalLeaning');
const confidence = document.getElementById('confidence');

// Analysis sections
const summarySection = document.getElementById('summarySection');
const summaryText = document.getElementById('summaryText');
const crossRefSection = document.getElementById('crossRefSection');
const crossRefContent = document.getElementById('crossRefContent');

// History
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistory');

// Tab management
let currentTab = 'analysis';
const analysisContent = document.getElementById('analysisContent');
const historyContent = document.getElementById('historyContent');

// Load saved API key on popup open
chrome.storage.sync.get(['geminiApiKey'], (result) => {
  if (result.geminiApiKey) {
    apiKeyInput.value = result.geminiApiKey;
    apiSection.classList.add('hidden');
  }
});

// Settings button - toggle API section
settingsBtn.addEventListener('click', () => {
  apiSection.classList.toggle('hidden');
});

// Collapse button
collapseBtn.addEventListener('click', () => {
  window.close();
});

// Save API key
saveApiKeyBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  
  if (!apiKey) {
    showStatus('Please enter an API key', 'error');
    return;
  }

  chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
    showStatus('API key saved successfully!', 'success');
    setTimeout(() => {
      apiSection.classList.add('hidden');
      hideStatus();
    }, 1500);
  });
});

// Analyze current page
analyzeBtn.addEventListener('click', async () => {
  // Check if API key exists
  const result = await chrome.storage.sync.get(['geminiApiKey']);
  
  if (!result.geminiApiKey) {
    showStatus('Please save your API key first', 'error');
    apiSection.classList.remove('hidden');
    return;
  }

  // Show loading state
  loadingDiv.style.display = 'block';
  scoreSection.classList.add('hidden');
  tabs.classList.add('hidden');
  summarySection.classList.add('hidden');
  crossRefSection.classList.add('hidden');
  analyzeBtn.disabled = true;
  showStatus('Extracting article content...', 'info');

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Send message to service worker to start analysis
    chrome.runtime.sendMessage(
      { action: 'analyzeCredibility', tabId: tab.id, url: tab.url },
      (response) => {
        loadingDiv.style.display = 'none';
        analyzeBtn.disabled = false;

        if (chrome.runtime.lastError) {
          showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
          return;
        }

        if (response.error) {
          showStatus(`Error: ${response.error}`, 'error');
          return;
        }

        // Display results
        displayResults(response.data);
        
        // Refresh history
        loadHistory();
        
        hideStatus();
      }
    );
  } catch (error) {
    loadingDiv.style.display = 'none';
    analyzeBtn.disabled = false;
    showStatus(`Error: ${error.message}`, 'error');
  }
});

// Display analysis results
function displayResults(data) {
  const { credibility_score, reasoning_summary, corroboration_analysis, confidence, political_leaning } = data;

  // Show sections
  scoreSection.classList.remove('hidden');
  tabs.classList.remove('hidden');
  summarySection.classList.remove('hidden');
  crossRefSection.classList.remove('hidden');

  // Update score
  scoreNumber.textContent = credibility_score;

  // Update reliability badge
  if (credibility_score >= 70) {
    reliabilityBadge.textContent = 'HIGH';
    reliabilityBadge.className = 'reliability-badge badge-high';
  } else if (credibility_score >= 40) {
    reliabilityBadge.textContent = 'MEDIUM';
    reliabilityBadge.className = 'reliability-badge badge-medium';
  } else {
    reliabilityBadge.textContent = 'LOW';
    reliabilityBadge.className = 'reliability-badge badge-low';
  }

  // Display reasoning summary
  summaryText.textContent = reasoning_summary;

  // Display corroborating sources
  if (corroboration_analysis && corroboration_analysis.length > 0) {
    let html = '<p style="margin-bottom: 12px; font-size: 13px;">Found ' + corroboration_analysis.length + ' related articles:</p>';
    
    corroboration_analysis.forEach((source, index) => {
      const icon = source.corroboration_score >= 70 ? '✅' : 
                   source.corroboration_score >= 40 ? '⚠️' : '❌';
      
      html += `
        <div class="corroboration-item">
          <div class="corroboration-header">
            <span class="corroboration-icon">${icon}</span>
            <span class="corroboration-title">${escapeHtml(source.title)}</span>
          </div>
          <a href="${escapeHtml(source.source_url)}" target="_blank" class="corroboration-url">
            ${escapeHtml(source.source_url)}
          </a>
          <div class="corroboration-score">
            Corroboration Score: <span class="score-value">${source.corroboration_score}/100</span>
          </div>
        </div>
      `;
    });
    
    crossRefContent.innerHTML = html;
  } else {
    crossRefContent.innerHTML = '<p style="color: #9CA3AF; font-size: 13px;">No corroborating sources found</p>';
  }

  // Update metadata with real values from API
  politicalLeaning.textContent = political_leaning || 'Neutral';
  confidence.textContent = confidence ? confidence + '%' : '75%';
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    switchTab(tabName);
  });
});

function switchTab(tabName) {
  currentTab = tabName;
  
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  // Show/hide content
  if (tabName === 'analysis') {
    analysisContent.classList.remove('hidden');
    historyContent.classList.add('hidden');
  } else if (tabName === 'history') {
    analysisContent.classList.add('hidden');
    historyContent.classList.remove('hidden');
    loadHistory();
  }
}

// Load and display history
function loadHistory() {
  chrome.storage.local.get(['analysisHistory'], (result) => {
    const history = result.analysisHistory || [];
    
    historyList.innerHTML = '';
    
    if (history.length === 0) {
      historyList.innerHTML = '<div style="text-align: center; padding: 40px 20px; color: #9CA3AF; font-size: 13px;">No analysis history yet</div>';
      return;
    }

    // Display most recent first
    history.reverse().forEach((item) => {
      const timeAgo = getTimeAgo(item.timestamp);
      const scoreColor = item.score >= 70 ? '#10B981' : item.score >= 40 ? '#F59E0B' : '#EF4444';
      
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';
      
      historyItem.innerHTML = `
        <div class="history-time">${timeAgo}</div>
        <div class="history-title">${escapeHtml(item.title || item.url)}</div>
        <div class="history-scores">
          <div class="history-score-item">
            <span>🎯</span>
            <span>AI: <strong style="color: ${scoreColor}">${item.score}/100</strong></span>
          </div>
        </div>
      `;
      
      historyItem.addEventListener('click', () => {
        chrome.tabs.create({ url: item.url });
      });
      
      historyList.appendChild(historyItem);
    });
  });
}

// Clear history
clearHistoryBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to clear all analysis history?')) {
    chrome.storage.local.set({ analysisHistory: [] }, () => {
      loadHistory();
      showStatus('History cleared', 'success');
      setTimeout(() => hideStatus(), 2000);
    });
  }
});

// Load history on popup open
loadHistory();

// Utility functions
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
}

function hideStatus() {
  statusDiv.className = 'status';
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
  if (seconds < 604800) return Math.floor(seconds / 86400) + ' days ago';
  
  return new Date(timestamp).toLocaleDateString();
}