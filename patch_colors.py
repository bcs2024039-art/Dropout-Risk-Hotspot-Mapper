import re
with open('frontend/app.js', 'r') as f:
    content = f.read()

# Make RISK_* mutable
content = content.replace("const RISK_LOW =", "let RISK_LOW =")
content = content.replace("const RISK_MID =", "let RISK_MID =")
content = content.replace("const RISK_HIGH =", "let RISK_HIGH =")

replacement = """
let useColorblindMode = false;

const PALETTES = {
  default: {
    low: [86, 204, 157],
    mid: [255, 204, 0],
    high: [255, 107, 107]
  },
  colorblind: {
    low: [69, 117, 180], // #4575b4
    mid: [255, 255, 191], // #ffffbf
    high: [215, 48, 39] // #d73027
  }
};

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('toggleColorblindBtn');
    if (btn) {
        btn.addEventListener('click', () => {
          useColorblindMode = !useColorblindMode;
          const p = useColorblindMode ? PALETTES.colorblind : PALETTES.default;
          RISK_LOW = p.low;
          RISK_MID = p.mid;
          RISK_HIGH = p.high;
          
          TIER_COLOR = { Low: colorForT(0), Medium: colorForT(0.5), High: colorForT(1) };
          
          const swatches = document.querySelectorAll('.swatch');
          if(swatches.length >= 3) {
              swatches[0].style.backgroundColor = TIER_COLOR.Low;
              swatches[1].style.backgroundColor = TIER_COLOR.Medium;
              swatches[2].style.backgroundColor = TIER_COLOR.High;
          }
          
          if (hotspots && hotspots.length) { drawHotspots(); drawLedger(); }
          loadDistrictChoropleth();
          if (activeClusterId) selectHotspot(activeClusterId);
        });
    }
});
"""

content = re.sub(r'let useColorblindMode = false;.*?if \(activeClusterId\) selectHotspot\(activeClusterId\);\n        \}\);\n    \}\n\}\);\n', replacement, content, flags=re.DOTALL)
content = content.replace("let TIER_COLOR = COLOR_SCALES.default;", "let TIER_COLOR = { Low: colorForT(0), Medium: colorForT(0.5), High: colorForT(1) };")

with open('frontend/app.js', 'w') as f:
    f.write(content)
