import re

with open('backend/app/main.py', 'r') as f:
    content = f.read()

# Remove the top level definitions
content = re.sub(r'_schools = compute_risk\(load_schools\(\)\)\n_schools, _hotspots = find_hotspots\(_schools\)\n_district_geojson = boundaries\.build_choropleth\(_schools\)\n', '', content)

cache_logic = """
from .data import QA_STATS

_state_cache = {}
def get_state(real_weight: float = 0.5):
    if real_weight not in _state_cache:
        s = compute_risk(load_schools(), real_weight=real_weight)
        s, h = find_hotspots(s)
        g = boundaries.build_choropleth(s)
        _state_cache[real_weight] = (s, h, g)
    return _state_cache[real_weight]
"""

content = content.replace("def _school_row(row) -> dict:", cache_logic + "\ndef _school_row(row) -> dict:")

# Update endpoints
def replacer(match):
    return match.group(0).replace("def stats(", "def stats(real_weight: float = 0.5, ")

content = content.replace("def stats(", "def stats(real_weight: float = 0.5, ")
content = content.replace("def hotspots(", "def hotspots(real_weight: float = 0.5, ")
content = content.replace("def schools(\n", "def schools(\n    real_weight: float = 0.5,\n")
content = content.replace("def districts(", "def districts(real_weight: float = 0.5")
content = content.replace("def districts_geojson(", "def districts_geojson(real_weight: float = 0.5, ")
content = content.replace("def optimize_curve(", "def optimize_curve(real_weight: float = 0.5, ")

content = content.replace("_schools", "get_state(real_weight)[0]")
content = content.replace("_hotspots", "get_state(real_weight)[1]")
content = content.replace("_district_geojson", "get_state(real_weight)[2]")

# Expose QA stats
content = content.replace(
    '"karnataka_2019_20_reference": KARNATAKA_2019_20_REFERENCE,',
    '"karnataka_2019_20_reference": KARNATAKA_2019_20_REFERENCE,\n        "data_quality": QA_STATS,'
)

# For optimize endpoint
content = content.replace(
    "class OptimizeRequest(BaseModel):\n",
    "class OptimizeRequest(BaseModel):\n    real_weight: float = 0.5\n"
)
content = content.replace("df = get_state(real_weight)[0]", "df = get_state(req.real_weight)[0]")

with open('backend/app/main.py', 'w') as f:
    f.write(content)
