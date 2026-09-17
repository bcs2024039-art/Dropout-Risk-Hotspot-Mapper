with open('frontend/index.html', 'r') as f:
    content = f.read()

print_btn = """
        <button id="printReportBtn" class="action-btn" title="Print District Report" style="display: none;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
        </button>
"""

content = content.replace('<button id="exportCsvBtn"', print_btn + '\n        <button id="exportCsvBtn"')

print_section = """
<div id="printSection" style="display: none;">
    <h1 id="printTitle">District Report</h1>
    <div id="printStats" style="margin-bottom: 2rem;"></div>
    <h2>Hotspot Details</h2>
    <div id="printHotspots"></div>
</div>
"""

content = content.replace('</body>', print_section + '\n</body>')

with open('frontend/index.html', 'w') as f:
    f.write(content)
