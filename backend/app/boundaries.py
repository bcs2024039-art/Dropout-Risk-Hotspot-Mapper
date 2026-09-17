import json
import os
from .data import DATA_DIR
import pandas as pd
import copy

# Load GeoJSON into memory once
with open(os.path.join(DATA_DIR, "karnataka_districts.geojson"), "r") as f:
    RAW_DISTRICT_GEOJSON = json.load(f)

def build_choropleth(df: pd.DataFrame) -> dict:
    """
    Injects dynamic school stats (count, risk) into the district polygons.
    """
    geojson = copy.deepcopy(RAW_DISTRICT_GEOJSON)
    if len(df) == 0:
        return geojson
        
    state_avg_risk = df["demo_risk_score"].mean()
    
    # Aggregate stats by district name
    d_stats = df.groupby("dtname").agg(
        school_count=("schcd", "count"),
        avg_risk=("demo_risk_score", "mean"),
        high_risk_count=("risk_tier", lambda x: (x == "High").sum())
    ).to_dict(orient="index")
    
    # The geojson uses 'census_name' or a list 'udise_districts'
    for feature in geojson["features"]:
        props = feature["properties"]
        udise_names = props.get("udise_districts", [props.get("census_name", "")])
        
        t_schools = 0
        t_risk = 0.0
        t_high = 0
        
        for n in udise_names:
            if n in d_stats:
                st = d_stats[n]
                c = st["school_count"]
                t_schools += c
                t_risk += st["avg_risk"] * c
                t_high += st["high_risk_count"]
                
        if t_schools > 0:
            avg = t_risk / t_schools
        else:
            avg = state_avg_risk
            
        props["school_count"] = t_schools
        props["avg_risk"] = round(avg, 3)
        props["high_risk_count"] = t_high
        props["risk_lift"] = round(avg - state_avg_risk, 3)
        props["display_name"] = " / ".join(udise_names) if len(udise_names) > 1 else udise_names[0]
        
    return geojson
