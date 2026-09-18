import re

with open('frontend/app.js', 'r') as f:
    content = f.read()

# 1. Add currentFilters.real_weight
content = content.replace("let currentFilters = { management: 'all', category: 'all', q: '', risk_tier: 'all' };", "let currentFilters = { management: 'all', category: 'all', q: '', risk_tier: 'all', real_weight: 0.5 };")

# 2. Add real_weight to fetchWithFilters
content = re.sub(
    r"if\s*\(currentFilters\.risk_tier[^;]+;",
    lambda m: m.group(0) + "\n  params.append('real_weight', currentFilters.real_weight);",
    content
)

# 3. Colorblind Mode
cb_logic = """
let useColorblindMode = false;
const COLOR_SCALES = {
  default: { Low: "#56cc9d", Medium: "#ffce67", High: "#ff7851" },
  colorblind: { Low: "#4575b4", Medium: "#ffffbf", High: "#d73027" } // Blue to Orange/Red
};
let TIER_COLOR = COLOR_SCALES.default;

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('toggleColorblindBtn');
    if (btn) {
        btn.addEventListener('click', () => {
          useColorblindMode = !useColorblindMode;
          TIER_COLOR = useColorblindMode ? COLOR_SCALES.colorblind : COLOR_SCALES.default;
          
          const swatches = document.querySelectorAll('.swatch');
          if(swatches.length >= 3) {
              swatches[0].style.backgroundColor = TIER_COLOR.Low;
              swatches[1].style.backgroundColor = TIER_COLOR.Medium;
              swatches[2].style.backgroundColor = TIER_COLOR.High;
          }
          
          if (hotspots && hotspots.length) drawHotspots();
          loadDistrictChoropleth();
          if (activeClusterId) selectHotspot(activeClusterId);
        });
    }
});
"""
content = content.replace('const TIER_COLOR = { Low: "#56cc9d", Medium: "#ffce67", High: "#ff7851" };', cb_logic)

# 4. Model Weight Slider Event Listener
weight_logic = """
let weightTimeout = null;
document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('realWeightSlider');
    if(slider) {
        slider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          document.getElementById('weightValue').innerText = val.toFixed(2);
          currentFilters.real_weight = val;
          
          if (weightTimeout) clearTimeout(weightTimeout);
          weightTimeout = setTimeout(() => {
            applyFilters();
          }, 300);
        });
    }
});
"""
content = content + "\n" + weight_logic

# 5. QA Stats Display
qa_logic = """
  if (data.data_quality) {
    if(document.getElementById('qaDup')) document.getElementById('qaDup').innerText = data.data_quality.duplicate_schcd || 0;
    if(document.getElementById('qaOob')) document.getElementById('qaOob').innerText = data.data_quality.out_of_bounds_coords || 0;
    if(document.getElementById('qaMiss')) document.getElementById('qaMiss').innerText = data.data_quality.missing_fields || 0;
  }
"""
content = content.replace("document.getElementById('statDistricts').innerText = data.districts;", "document.getElementById('statDistricts').innerText = data.districts;\n" + qa_logic)

with open('frontend/app.js', 'w') as f:
    f.write(content)
