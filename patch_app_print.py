with open('frontend/app.js', 'r') as f:
    content = f.read()

print_logic = """
// Print Logic
document.getElementById('printReportBtn').addEventListener('click', () => {
  if (!activeClusterId || !hotspots) return;
  const hotspot = hotspots.find(h => h.cluster_id === activeClusterId);
  if (!hotspot) return;

  const printSection = document.getElementById('printSection');
  document.getElementById('printTitle').innerText = `Risk Report: ${hotspot.district} District`;
  
  document.getElementById('printStats').innerHTML = `
    <p><strong>Total Schools:</strong> ${hotspot.school_count}</p>
    <p><strong>High Risk Schools:</strong> ${hotspot.high_risk_count}</p>
    <p><strong>Average Risk Score:</strong> ${hotspot.avg_risk.toFixed(2)}</p>
    <p><strong>Cluster Priority Lift:</strong> +${hotspot.risk_lift.toFixed(2)}</p>
  `;
  
  // Also collect schools if available.
  let schoolsHtml = '<p>No specific school list loaded.</p>';
  // the map's schoolLayer has the loaded schools for this district if it's selected
  let loadedSchools = [];
  schoolLayer.eachLayer(layer => {
      if (layer.feature && layer.feature.properties) {
         loadedSchools.push(layer.feature.properties);
      }
  });
  if (loadedSchools.length > 0) {
      schoolsHtml = '<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">';
      schoolsHtml += '<tr style="border-bottom: 2px solid #333;"><th style="text-align: left; padding: 4px;">School Code</th><th style="text-align: left; padding: 4px;">Name</th><th style="text-align: right; padding: 4px;">Risk Score</th></tr>';
      loadedSchools.sort((a,b) => b.risk_score - a.risk_score).forEach(s => {
          schoolsHtml += `<tr style="border-bottom: 1px solid #ccc;">
            <td style="padding: 4px;">${s.schcd}</td>
            <td style="padding: 4px;">${s.schname}</td>
            <td style="padding: 4px; text-align: right;">${s.risk_score.toFixed(2)}</td>
          </tr>`;
      });
      schoolsHtml += '</table>';
  }
  document.getElementById('printHotspots').innerHTML = schoolsHtml;

  printSection.style.display = 'block';
  window.print();
  printSection.style.display = 'none';
});
"""

# Also show the print button in selectHotspot and hide in resetView
content = content.replace('setActiveLedgerRow(clusterId);', "setActiveLedgerRow(clusterId);\n  document.getElementById('printReportBtn').style.display = 'inline-flex';")
content = content.replace("resetBtn.hidden = true;", "resetBtn.hidden = true;\n  document.getElementById('printReportBtn').style.display = 'none';")
content += "\n" + print_logic

with open('frontend/app.js', 'w') as f:
    f.write(content)
