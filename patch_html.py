with open('frontend/index.html', 'r') as f:
    content = f.read()

ai_box = """
        <div class="topbar-search ai-search" style="flex: 1; max-width: 400px; display: flex; align-items: center; background: rgba(255,255,255,0.05); border-radius: 4px; padding: 0 8px; border: 1px solid rgba(255,255,255,0.1);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#56cc9d" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            <input type="text" id="aiInput" placeholder="Ask AI (e.g. 'show top 5 hotspots')..." style="flex: 1; background: transparent; border: none; color: white; padding: 8px; outline: none;" />
            <div id="aiLoading" style="display: none; width: 12px; height: 12px; border: 2px solid #56cc9d; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        </div>
"""

content = content.replace('<div class="topbar-actions">', '<div class="topbar-actions" style="width: 100%; display: flex; gap: 8px;">\n' + ai_box)

with open('frontend/index.html', 'w') as f:
    f.write(content)
