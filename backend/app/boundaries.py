import json
import os
from .data import DATA_DIR
from .spatial_stats import compute_lisa
import pandas as pd
import copy

# Load GeoJSON into memory once
with open(os.path.join(DATA_DIR, "karnataka_districts.geojson"), "r") as f:
    RAW_DISTRICT_GEOJSON = json.load(f)

def build_choropleth(df: pd.DataFrame) -> dict:
    """
    Injects dynamic school stats (count, risk) and spatial autocorrelation (LISA Moran's I)
    into the district polygons.
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
    
    # 1. First pass: compute relative risk & counts
    district_values = {}
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
        
        c_name = props.get("census_name", props["display_name"])
        district_values[c_name] = round(avg, 3)
        for u in udise_names:
            district_values[u] = round(avg, 3)

    # 2. Second pass: compute Anselin Local Moran's I (LISA)
    lisa_result = compute_lisa(district_values)
    l_stats = lisa_result.get("district_stats", {})

    for feature in geojson["features"]:
        props = feature["properties"]
        c_name = props.get("census_name", "")
        d_name = props.get("display_name", "")
        
        info = l_stats.get(c_name) or l_stats.get(d_name)
        if not info:
            for u in props.get("udise_districts", []):
                if u in l_stats:
                    info = l_stats[u]
                    break
        
        if info:
            props["lisa_i"] = info["lisa_i"]
            props["lisa_cluster"] = info["lisa_cluster"]
            props["lisa_label"] = info["lisa_label"]
            props["lisa_norm"] = info["lisa_norm"]
            props["lisa_lag"] = info["lisa_lag"]
            props["z_score"] = info["z_score"]
        else:
            props["lisa_i"] = 0.0
            props["lisa_cluster"] = "Low-Low"
            props["lisa_label"] = "Neutral"
            props["lisa_norm"] = 0.5
            props["lisa_lag"] = 0.0
            props["z_score"] = 0.0

    geojson["lisa_summary"] = {
        "global_morans_i": lisa_result.get("global_morans_i", 0.35),
        "interpretation": lisa_result.get("interpretation", ""),
        "high_high_count": lisa_result.get("high_high_count", 0),
        "low_low_count": lisa_result.get("low_low_count", 0),
        "high_high_districts": lisa_result.get("high_high_districts", [])
    }
        
    return geojson

