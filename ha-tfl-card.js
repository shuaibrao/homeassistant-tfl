// TfL Live Tube Status Custom Card for Home Assistant
// Authentic TfL branding, accordion expandable details, and dual-mode data loading.

const LINE_METADATA = {
  // Tube Lines
  'bakerloo': { name: 'Bakerloo', color: '#B26300', mode: 'tube' },
  'central': { name: 'Central', color: '#DC241F', mode: 'tube' },
  'circle': { name: 'Circle', color: '#FFD329', text_color: '#00205B', mode: 'tube' },
  'district': { name: 'District', color: '#007D32', mode: 'tube' },
  'dlr': { name: 'DLR', color: '#00AFAD', mode: 'dlr' },
  'elizabeth': { name: 'Elizabeth line', color: '#5D3792', mode: 'elizabeth-line' },
  'hammersmith-city': { name: 'Hammersmith & City', color: '#F4A9BE', text_color: '#00205B', mode: 'tube' },
  'jubilee': { name: 'Jubilee', color: '#A1A5A7', mode: 'tube' },
  'metropolitan': { name: 'Metropolitan', color: '#9B0058', mode: 'tube' },
  'northern': { name: 'Northern', color: '#000000', mode: 'tube' },
  'piccadilly': { name: 'Piccadilly', color: '#0019A8', mode: 'tube' },
  'victoria': { name: 'Victoria', color: '#0098D8', mode: 'tube' },
  'waterloo-city': { name: 'Waterloo & City', color: '#93CEBA', text_color: '#00205B', mode: 'tube' },
  
  // Tram
  'tram': { name: 'Tram', color: '#00BD19', mode: 'tram' },
  
  // London Overground Lines
  'london-overground': { name: 'London Overground', color: '#EF7B10', mode: 'overground' },
  'liberty': { name: 'Liberty', color: '#676767', mode: 'overground' },
  'lioness': { name: 'Lioness', color: '#F1B41C', text_color: '#00205B', mode: 'overground' },
  'mildmay': { name: 'Mildmay', color: '#437EC1', mode: 'overground' },
  'suffragette': { name: 'Suffragette', color: '#39B97A', mode: 'overground' },
  'weaver': { name: 'Weaver', color: '#893B67', mode: 'overground' },
  'windrush': { name: 'Windrush', color: '#D22730', mode: 'overground' }
};

// Global cache for direct TfL API requests to prevent rate limit issues
let globalTflCache = null;
let globalTflCacheTime = 0;
let globalTflPromise = null;

async function getCachedTflStatus(apiKey = null, cacheDurationMs = 30000) {
  const now = Date.now();
  if (globalTflCache && (now - globalTflCacheTime < cacheDurationMs)) {
    return globalTflCache;
  }
  if (globalTflPromise) {
    return globalTflPromise;
  }
  
  let url = 'https://api.tfl.gov.uk/line/mode/tube,dlr,overground,elizabeth-line,tram/status';
  if (apiKey) {
    url += `?app_key=${apiKey}`;
  }
  
  globalTflPromise = fetch(url)
    .then(async response => {
      if (!response.ok) {
        throw new Error(`TfL API error: ${response.statusText}`);
      }
      const data = await response.json();
      globalTflCache = data;
      globalTflCacheTime = Date.now();
      globalTflPromise = null;
      return data;
    })
    .catch(err => {
      globalTflPromise = null;
      throw err;
    });
    
  return globalTflPromise;
}

class TfLStatusCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._linesData = [];
    this._loading = false;
    this._error = null;
    this._expandedLines = new Set();
    this._pollInterval = null;
  }

  // Required: Called when the card configuration changes
  setConfig(config) {
    this.config = {
      title: 'Tube, DLR, London Overground, Elizabeth line and Tram',
      show_all_lines: false,
      update_interval: 60,
      ...config
    };
    
    this._expandedLines.clear();
    
    if (this._isEntityMode()) {
      this._stopPolling();
    } else {
      this._startPolling();
    }
    
    this._triggerFetch();
  }

  // Home Assistant calls this when the state changes
  set hass(hass) {
    this._hass = hass;
    if (this._isEntityMode()) {
      const newLinesData = this._parseEntityData(hass);
      // Only render if the data has actually changed (simple string comparison of states)
      const dataString = JSON.stringify(newLinesData);
      if (dataString !== this._lastDataString) {
        this._linesData = newLinesData;
        this._lastDataString = dataString;
        this._error = null;
        this._loading = false;
        this._render();
      }
    }
  }

  connectedCallback() {
    if (!this._isEntityMode()) {
      this._startPolling();
    }
    this._render();
  }

  disconnectedCallback() {
    this._stopPolling();
  }

  _isEntityMode() {
    return this.config && Array.isArray(this.config.entities) && this.config.entities.length > 0;
  }

  _startPolling() {
    this._stopPolling();
    const intervalMs = (this.config.update_interval || 60) * 1000;
    this._pollInterval = setInterval(() => this._triggerFetch(), intervalMs);
  }

  _stopPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  async _triggerFetch() {
    if (this._isEntityMode()) {
      if (this._hass) {
        this._linesData = this._parseEntityData(this._hass);
        this._render();
      }
      return;
    }
    
    this._loading = this._linesData.length === 0; // Only show main loader on first fetch
    this._render();
    
    try {
      const data = await getCachedTflStatus(this.config.api_key);
      this._linesData = this._parseApiData(data);
      this._error = null;
    } catch (err) {
      console.error("TfL Tube Card Error: ", err);
      this._error = err.message || "Failed to fetch status from TfL API";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _mapEntityToLineId(entityId) {
    const cleanId = entityId.replace('sensor.', '').toLowerCase();
    for (const lineId of Object.keys(LINE_METADATA)) {
      const normLineId = lineId.replace('-', '_');
      if (cleanId.includes(normLineId) || cleanId.includes(lineId)) {
        return lineId;
      }
    }
    if (cleanId.includes('london_underground_')) {
      const suffix = cleanId.replace('london_underground_', '');
      if (LINE_METADATA[suffix]) return suffix;
    }
    if (cleanId.includes('overground')) return 'london-overground';
    if (cleanId.includes('elizabeth')) return 'elizabeth';
    return null;
  }

  _parseEntityData(hass) {
    const lines = [];
    const entities = this.config.entities || [];
    
    for (const entityId of entities) {
      const stateObj = hass.states[entityId];
      if (!stateObj) continue;
      
      const lineId = this._mapEntityToLineId(entityId);
      if (!lineId) continue;
      
      const meta = LINE_METADATA[lineId] || { name: lineId.toUpperCase(), color: '#EF7B10', mode: 'tube' };
      const stateStr = stateObj.state || 'Unknown';
      
      const isGoodService = stateStr.toLowerCase().replace(/_/g, ' ').trim() === 'good service';
      const reason = stateObj.attributes.description || 
                     stateObj.attributes.Description || 
                     stateObj.attributes.reason || 
                     stateObj.attributes.message || 
                     '';
                     
      lines.push({
        id: lineId,
        name: meta.name,
        mode: meta.mode,
        color: meta.color,
        textColor: meta.text_color || '#FFFFFF',
        isGoodService,
        statuses: [
          {
            severityText: stateStr,
            reason: isGoodService ? '' : reason
          }
        ]
      });
    }
    return lines;
  }

  _parseApiData(apiData) {
    return apiData.map(line => {
      const meta = LINE_METADATA[line.id] || { name: line.name, color: '#EF7B10', mode: line.modeName };
      
      // Extract non-Good Service statuses (severity != 10)
      const activeStatuses = (line.lineStatuses || [])
        .filter(status => status.statusSeverity !== 10)
        .map(status => ({
          severityText: status.statusSeverityDescription,
          reason: status.reason || ''
        }));
        
      const isGoodService = activeStatuses.length === 0;
      const statuses = isGoodService 
        ? [{ severityText: 'Good service', reason: '' }] 
        : activeStatuses;
        
      return {
        id: line.id,
        name: meta.name || line.name,
        mode: meta.mode || line.modeName,
        color: meta.color,
        textColor: meta.text_color || '#FFFFFF',
        isGoodService,
        statuses
      };
    });
  }

  _getFilteredLines() {
    let lines = this._linesData;

    // Apply mode filters
    if (this.config.show_modes && Array.isArray(this.config.show_modes)) {
      const allowedModes = this.config.show_modes.map(m => m.toLowerCase());
      lines = lines.filter(line => allowedModes.includes(line.mode));
    }

    // Apply line ID filters
    if (this.config.show_lines && Array.isArray(this.config.show_lines)) {
      const allowedLines = this.config.show_lines.map(l => l.toLowerCase());
      lines = lines.filter(line => allowedLines.includes(line.id));
    }

    return lines;
  }

  _toggleExpand(lineId) {
    if (this._expandedLines.has(lineId)) {
      this._expandedLines.delete(lineId);
    } else {
      this._expandedLines.add(lineId);
    }
    this._render();
  }

  getCardSize() {
    return Math.max(2, Math.ceil(this._linesData.length / 2));
  }

  _render() {
    if (!this.shadowRoot) return;

    const title = this.config.title;
    const lines = this._getFilteredLines();
    
    // Split into disrupted and good service lines
    const disrupted = lines.filter(l => !l.isGoodService).sort((a, b) => a.name.localeCompare(b.name));
    const goodService = lines.filter(l => l.isGoodService).sort((a, b) => a.name.localeCompare(b.name));
    
    let contentHtml = '';

    if (this._loading) {
      contentHtml = `
        <div class="loader-container">
          <div class="spinner"></div>
          <div class="loader-text">Loading Tube Status...</div>
        </div>
      `;
    } else if (this._error) {
      contentHtml = `
        <div class="error-container">
          <div class="error-title">Unable to load TfL status</div>
          <div class="error-message">${this._error}</div>
          <button class="retry-btn">Retry</button>
        </div>
      `;
    } else if (lines.length === 0) {
      contentHtml = `
        <div class="empty-container">
          No lines found matching filters or entities configured.
        </div>
      `;
    } else {
      const rows = [];
      
      // Render disrupted lines
      for (const line of disrupted) {
        const isExpanded = this._expandedLines.has(line.id);
        const hasReason = line.statuses.some(s => s.reason);
        const hoverClass = hasReason ? 'interactive' : '';
        const expandedClass = isExpanded ? 'expanded' : '';
        
        rows.push(`
          <div class="tfl-row ${expandedClass} ${hoverClass}" data-line-id="${line.id}">
            <div class="tfl-row-header">
              <div class="tfl-line-name-col" style="background-color: ${line.color}; color: ${line.textColor};">
                ${line.name}
              </div>
              <div class="tfl-status-col">
                <div class="tfl-status-text">
                  ${line.statuses.map(s => `<div class="tfl-status-item">${s.severityText}</div>`).join('')}
                </div>
                ${hasReason ? `
                  <div class="tfl-chevron">
                    <svg viewBox="0 0 24 24"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
                  </div>
                ` : '<div></div>'}
              </div>
            </div>
            ${hasReason ? `
              <div class="tfl-row-details" style="max-height: ${isExpanded ? '500px' : '0'};">
                <div class="tfl-details-content">
                  ${line.statuses.map(s => s.reason ? `<div class="tfl-disruption-reason">${s.reason}</div>` : '').join('')}
                </div>
              </div>
            ` : ''}
          </div>
        `);
      }
      
      // Render Good Service lines
      if (goodService.length > 0) {
        if (this.config.show_all_lines) {
          // Display them individually
          for (const line of goodService) {
            rows.push(`
              <div class="tfl-row" data-line-id="${line.id}">
                <div class="tfl-row-header">
                  <div class="tfl-line-name-col" style="background-color: ${line.color}; color: ${line.textColor};">
                    ${line.name}
                  </div>
                  <div class="tfl-status-col">
                    <div class="tfl-status-text">
                      <div class="tfl-status-item">Good service</div>
                    </div>
                    <div></div>
                  </div>
                </div>
              </div>
            `);
          }
        } else {
          // Grouped mode (like TfL website)
          const isExpanded = this._expandedLines.has('good_service_grouped');
          const expandedClass = isExpanded ? 'expanded' : '';
          
          rows.push(`
            <div class="tfl-row ${expandedClass} interactive" data-line-id="good_service_grouped">
              <div class="tfl-row-header">
                <div class="tfl-stripes-col">
                  ${goodService.map(line => `<div class="tfl-stripe" style="background-color: ${line.color};" title="${line.name}"></div>`).join('')}
                </div>
                <div class="tfl-status-col">
                  <div class="tfl-status-text">
                    <div class="tfl-status-item">
                      ${disrupted.length === 0 ? 'Good service on all lines' : 'Good service on all other lines'}
                    </div>
                  </div>
                  <div class="tfl-chevron">
                    <svg viewBox="0 0 24 24"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
                  </div>
                </div>
              </div>
              <div class="tfl-row-details" style="max-height: ${isExpanded ? '500px' : '0'};">
                <div class="tfl-details-content">
                  <div class="good-service-detail-title">Operational Lines:</div>
                  <div class="good-service-list">
                    ${goodService.map(line => `
                      <div class="good-service-line-tag">
                        <span class="line-dot" style="background-color: ${line.color};"></span>
                        <span class="line-tag-name">${line.name}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              </div>
            </div>
          `);
        }
      }
      
      contentHtml = rows.join('');
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        .ha-tfl-card {
          font-family: var(--paper-font-body1_-_font-family), system-ui, -apple-system, sans-serif;
          color: var(--primary-text-color);
          background-color: var(--ha-card-background, var(--card-background-color, #ffffff));
          border-radius: var(--ha-card-border-radius, 12px);
          border: var(--ha-card-border, 1px solid var(--divider-color, #e0e0e0));
          box-shadow: var(--ha-card-box-shadow, none);
          overflow: hidden;
        }
        .card-header {
          padding: 16px;
          border-bottom: 1.5px solid var(--divider-color, #e0e0e0);
        }
        .card-title {
          font-size: 16px;
          font-weight: bold;
          line-height: 1.3;
          color: var(--primary-text-color);
        }
        .card-content {
          padding: 0;
          display: flex;
          flex-direction: column;
          background-color: #ffffff;
        }
        
        /* Row structure */
        .tfl-row {
          display: flex;
          flex-direction: column;
          border-bottom: 2px solid #ffffff;
          box-sizing: border-box;
          background-color: #FAF6E9;
        }
        .tfl-row:last-child {
          border-bottom: none;
        }
        .tfl-row-header {
          display: flex;
          min-height: 48px;
          align-self: stretch;
        }
        
        /* Column 1: Line Name / Stripes */
        .tfl-line-name-col {
          width: 40%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 8px 12px;
          font-weight: bold;
          font-size: 13px;
          text-align: center;
          box-sizing: border-box;
          border-right: 2px solid #ffffff;
          line-height: 1.2;
          letter-spacing: 0.2px;
          text-shadow: 0 0 1px rgba(0,0,0,0.1);
        }
        .tfl-stripes-col {
          width: 40%;
          display: flex;
          flex-direction: column;
          align-self: stretch;
          border-right: 2px solid #ffffff;
          box-sizing: border-box;
        }
        .tfl-stripe {
          flex: 1;
          width: 100%;
          border-bottom: 1px solid rgba(255, 255, 255, 0.15);
        }
        .tfl-stripe:last-child {
          border-bottom: none;
        }
        
        /* Column 2: Status Details */
        .tfl-status-col {
          width: 60%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background-color: #FAF6E9;
          color: #00205B;
          box-sizing: border-box;
          font-size: 13.5px;
          font-weight: 500;
        }
        .tfl-status-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
        }
        .tfl-status-item {
          line-height: 1.3;
        }
        
        /* Chevron */
        .tfl-chevron {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .tfl-chevron svg {
          width: 20px;
          height: 20px;
          fill: #00205B;
        }
        .tfl-row.expanded .tfl-chevron {
          transform: rotate(90deg);
        }
        
        /* Interactive feedback */
        .interactive {
          cursor: pointer;
        }
        .interactive:hover .tfl-status-col {
          background-color: #f5eed3;
        }
        
        /* Details panel styling */
        .tfl-row-details {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          background-color: #fdfbf7;
          border-top: 1.5px solid #ffffff;
        }
        .tfl-details-content {
          padding: 12px 16px;
          color: #333333;
          font-size: 12.5px;
          line-height: 1.45;
          border-bottom: 1.5px solid rgba(0, 0, 0, 0.05);
        }
        .tfl-disruption-reason {
          margin-bottom: 8px;
        }
        .tfl-disruption-reason:last-child {
          margin-bottom: 0;
        }
        
        /* Good Service Details */
        .good-service-detail-title {
          font-weight: bold;
          margin-bottom: 8px;
          color: #00205B;
          font-size: 13px;
        }
        .good-service-list {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6px 12px;
        }
        .good-service-line-tag {
          display: flex;
          align-items: center;
          font-size: 12px;
        }
        .line-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          margin-right: 6px;
          display: inline-block;
          flex-shrink: 0;
          border: 1px solid rgba(0,0,0,0.1);
        }
        .line-tag-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        /* Loading and Error states */
        .loader-container {
          padding: 24px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          background-color: #FAF6E9;
        }
        .spinner {
          width: 28px;
          height: 28px;
          border: 3px solid rgba(0, 32, 91, 0.1);
          border-top-color: #00205B;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        .loader-text {
          font-size: 13px;
          color: #00205B;
          font-weight: 500;
        }
        .error-container {
          padding: 20px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          background-color: #fdf5f5;
        }
        .error-title {
          font-weight: bold;
          color: #c0392b;
          font-size: 14px;
          margin-bottom: 4px;
        }
        .error-message {
          font-size: 12px;
          color: #7f8c8d;
          margin-bottom: 12px;
          line-height: 1.4;
        }
        .retry-btn {
          background-color: #00205B;
          color: #ffffff;
          border: none;
          padding: 6px 16px;
          border-radius: 4px;
          font-weight: bold;
          font-size: 12px;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .retry-btn:hover {
          background-color: #003688;
        }
        .empty-container {
          padding: 24px 16px;
          text-align: center;
          font-size: 13px;
          color: #7f8c8d;
          background-color: #FAF6E9;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
      <div class="ha-tfl-card">
        <div class="card-header">
          <div class="card-title">${title}</div>
        </div>
        <div class="card-content">
          ${contentHtml}
        </div>
      </div>
    `;

    // Attach click event listeners for expandable rows
    const rows = this.shadowRoot.querySelectorAll('.tfl-row.interactive');
    rows.forEach(row => {
      row.addEventListener('click', () => {
        const lineId = row.getAttribute('data-line-id');
        this._toggleExpand(lineId);
      });
    });

    // Attach click event listener for retry button
    const retryBtn = this.shadowRoot.querySelector('.retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        this._triggerFetch();
      });
    }
  }
}

customElements.define('ha-tfl-card', TfLStatusCard);

// Configure the card picker in Lovelace
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'ha-tfl-card',
  name: 'TfL Tube Status Card',
  description: 'A premium Transport for London live status card with expandable disruptions and authentic styling.',
  preview: true
});
