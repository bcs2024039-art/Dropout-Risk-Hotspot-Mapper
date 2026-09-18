import re

with open('frontend/index.html', 'r') as f:
    content = f.read()

# Add Colorblind Toggle in topbar
cb_toggle = """
        <button id="toggleColorblindBtn" class="action-btn" title="Toggle Colorblind Mode" style="margin-right: auto; margin-left: 8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
        </button>
"""
content = content.replace('<select id="filterManagement"', cb_toggle + '\n        <select id="filterManagement"')


# Add Model Weight Slider to Hotspots Panel
weight_slider = """
        <div style="padding: 12px 16px; border-bottom: 1px solid var(--border-glass);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label style="font-size: 0.85em; color: var(--text-dim);">Structural Signal Weight</label>
            <span id="weightValue" style="font-family: 'IBM Plex Mono', monospace; font-size: 0.85em;">0.50</span>
          </div>
          <input type="range" id="realWeightSlider" min="0" max="1" step="0.05" value="0.5" style="width: 100%; cursor: pointer;" />
        </div>
"""
content = content.replace('<div class="tab-panel" id="hotspotsPanel">', '<div class="tab-panel" id="hotspotsPanel">\n' + weight_slider)


# Display QA Stats in the Dashboard Header or About panel
qa_stats_ui = """
      <div id="qaStatsPanel" style="position: absolute; right: 24px; top: 72px; font-size: 0.75rem; color: var(--text-dim); background: rgba(0,0,0,0.5); padding: 8px 12px; border-radius: 4px; border: 1px solid var(--border-glass);">
        <strong style="color: #fff; margin-bottom: 4px; display: block;">Data Quality (Live)</strong>
        <div style="display: grid; grid-template-columns: 1fr auto; gap: 4px 12px;">
          <span>Duplicate IDs:</span><span id="qaDup" style="font-family: 'IBM Plex Mono';">0</span>
          <span>Out of bounds:</span><span id="qaOob" style="font-family: 'IBM Plex Mono';">0</span>
          <span>Missing fields:</span><span id="qaMiss" style="font-family: 'IBM Plex Mono';">0</span>
        </div>
      </div>
"""
content = content.replace('<div class="dashboard-header">', '<div class="dashboard-header">\n' + qa_stats_ui)

with open('frontend/index.html', 'w') as f:
    f.write(content)
