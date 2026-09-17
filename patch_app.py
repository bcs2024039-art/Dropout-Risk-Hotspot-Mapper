with open('frontend/app.js', 'r') as f:
    content = f.read()

ai_logic = """
// AI Query Logic
document.getElementById('aiInput').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const query = e.target.value.trim();
    if (!query) return;
    
    document.getElementById('aiLoading').style.display = 'block';
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      console.log('AI Action:', data);
      
      if (data.action === 'top_hotspots') {
         const n = data.n || 5;
         // Simulate sorting/filtering top N
         if (hotspots && hotspots.length > 0) {
           const topN = hotspots.slice(0, n);
           alert(`AI found ${n} top hotspots. Selecting the worst one: District ${topN[0].district}.`);
           selectHotspot(topN[0].cluster_id);
         }
      } else if (data.action === 'filter_district') {
         document.getElementById('searchInput').value = data.district;
         applyFilters();
         alert(`AI applied filter for district: ${data.district}`);
      } else if (data.action === 'explain_score') {
         document.getElementById('searchInput').value = data.school_id;
         applyFilters();
         alert(`AI mapping school ID: ${data.school_id}`);
      } else if (data.action === 'clarify') {
         alert('AI: ' + data.message);
      } else {
         alert('AI did not return a valid action.');
      }
    } catch(err) {
      console.error(err);
      alert('Error querying AI');
    } finally {
      document.getElementById('aiLoading').style.display = 'none';
      e.target.value = '';
    }
  }
});
"""

content += "\n" + ai_logic

with open('frontend/app.js', 'w') as f:
    f.write(content)
