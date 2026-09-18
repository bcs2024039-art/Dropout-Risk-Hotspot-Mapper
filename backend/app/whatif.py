"""
What-if simulator for educational infrastructure intervention.
Computes the risk reduction and hotspot rank change if specific infrastructure deficits
(toilets, library, computer lab, broadband internet) are eliminated (set to 0%).
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any
from .data import load_district_infra
from .clustering import find_hotspots

def normalize_dimension(dim: str) -> str:
    d = dim.strip().lower()
    if "toilet" in d:
        return "toilet_gap"
    if "lib" in d:
        return "library_gap"
    if "comp" in d:
        return "computer_gap"
    if "net" in d or "inter" in d:
        return "internet_gap"
    return d

def get_all_district_infra() -> List[Dict[str, Any]]:
    """Returns all districts with their current 4 infrastructure gap percentages."""
    infra_df = load_district_infra()
    results = []
    for _, row in infra_df.iterrows():
        d_name = str(row["district_name"]).strip().title()
        results.append({
            "district_code": int(row.get("district_code", 0)),
            "district_name": str(row["district_name"]).strip(),
            "display_name": d_name,
            "total_schools": int(row.get("total_schools_reported", 0)),
            "toilets_gap_pct": round(float(row.get("toilet_gap", 0.0)) * 100, 1),
            "library_gap_pct": round(float(row.get("library_gap", 0.0)) * 100, 1),
            "computer_gap_pct": round(float(row.get("computer_gap", 0.0)) * 100, 1),
            "internet_gap_pct": round(float(row.get("internet_gap", 0.0)) * 100, 1),
            "infra_gap_score": round(float(row.get("infra_gap_score", 0.0)), 3),
        })
    results.sort(key=lambda x: x["display_name"])
    return results

def simulate_whatif(
    state_schools_df: pd.DataFrame,
    district_query: str,
    fixed_dimensions: List[str],
    real_weight: float = 0.5
) -> Dict[str, Any]:
    """
    Simulates fixing 1 or more infrastructure dimensions in a target district:
    1. Sets chosen gap dimensions (toilets, library, computers, internet) to 0.0.
    2. Recalculates district infra_gap_score.
    3. Re-runs compute_risk for that district's schools.
    4. Calculates before/after district avg_risk, high-risk school count, and hotspot rank shift.
    """
    infra_df = load_district_infra()
    
    # Match district in infra table
    d_clean = district_query.strip().upper()
    matched_infra = infra_df[
        (infra_df["district_join_key"] == d_clean) |
        (infra_df["district_name"].str.upper() == d_clean) |
        (infra_df["district_name"].str.upper().str.contains(d_clean, na=False))
    ]
    
    if matched_infra.empty:
        # Fallback to first district or raise
        matched_infra = infra_df.iloc[[0]]
        
    infra_row = matched_infra.iloc[0]
    canonical_district = str(infra_row["district_name"]).strip()
    
    # Extract current gaps
    orig_toilet = float(infra_row.get("toilet_gap", 0.0))
    orig_library = float(infra_row.get("library_gap", 0.0))
    orig_computer = float(infra_row.get("computer_gap", 0.0))
    orig_internet = float(infra_row.get("internet_gap", 0.0))
    orig_infra_score = float(infra_row.get("infra_gap_score", (orig_toilet + orig_library + orig_computer + orig_internet) / 4.0))
    
    # Normalize dimensions to fix
    fixed_cols = [normalize_dimension(f) for f in fixed_dimensions]
    
    new_toilet = 0.0 if "toilet_gap" in fixed_cols else orig_toilet
    new_library = 0.0 if "library_gap" in fixed_cols else orig_library
    new_computer = 0.0 if "computer_gap" in fixed_cols else orig_computer
    new_internet = 0.0 if "internet_gap" in fixed_cols else orig_internet
    
    new_infra_score = (new_toilet + new_library + new_computer + new_internet) / 4.0
    
    # Find matching schools in state_schools_df
    # Match by dtname
    school_mask = state_schools_df["dtname"].str.strip().str.upper() == canonical_district.upper()
    if not school_mask.any():
        school_mask = state_schools_df["dtname"].str.strip().str.upper().str.contains(canonical_district.upper(), na=False)
    if not school_mask.any():
        first_token = canonical_district.split()[0].upper()
        school_mask = state_schools_df["dtname"].str.strip().str.upper().str.startswith(first_token)
    if not school_mask.any():
        school_mask = state_schools_df["dtname"].str.lower().str.contains(district_query.lower().strip(), na=False)
        
    target_schools = state_schools_df[school_mask]
        
    if target_schools.empty:
        # Fallback to schools matching query substring
        school_mask = state_schools_df["dtname"].str.lower().str.contains(district_query.lower().strip())
        target_schools = state_schools_df[school_mask]
        
    district_display_name = target_schools["dtname"].iloc[0] if not target_schools.empty else canonical_district.title()
    
    # Baseline stats for this district
    before_avg_risk = float(target_schools["demo_risk_score"].mean()) if not target_schools.empty else 0.5
    before_high_count = int((target_schools["risk_tier"] == "High").sum()) if not target_schools.empty else 0
    total_schools_in_district = len(target_schools)
    
    # Before hotspot ranks across state
    _, orig_hotspots = find_hotspots(state_schools_df)
    before_hotspot_rank = None
    if len(orig_hotspots) > 0:
        for idx, h in enumerate(orig_hotspots.itertuples()):
            if str(h.district).strip().lower() == str(district_display_name).strip().lower():
                before_hotspot_rank = idx + 1
                break
                
    # Recompute risk for this district's schools
    simulated_df = state_schools_df.copy()
    if not target_schools.empty:
        # Update schools for target district
        real_sig = simulated_df.loc[school_mask, "real_signal"]
        new_scores = real_weight * real_sig + (1.0 - real_weight) * new_infra_score
        new_scores = np.clip(new_scores, 0.0, 1.0)
        
        simulated_df.loc[school_mask, "demo_risk_score"] = new_scores
        simulated_df.loc[school_mask, "infra_gap_score"] = new_infra_score
        simulated_df.loc[school_mask, "risk_tier"] = pd.cut(
            new_scores,
            bins=[-0.1, 0.4, 0.6, 1.1],
            labels=["Low", "Medium", "High"]
        )
        simulated_df.loc[school_mask, "confidence"] = np.where(
            abs(real_sig - new_infra_score) > 0.4, "Low", "High"
        )
        
    after_sub = simulated_df[school_mask]
    after_avg_risk = float(after_sub["demo_risk_score"].mean()) if not after_sub.empty else before_avg_risk
    after_high_count = int((after_sub["risk_tier"] == "High").sum()) if not after_sub.empty else before_high_count
    
    # After hotspot ranks across state
    _, new_hotspots = find_hotspots(simulated_df)
    after_hotspot_rank = None
    if len(new_hotspots) > 0:
        for idx, h in enumerate(new_hotspots.itertuples()):
            if str(h.district).strip().lower() == str(district_display_name).strip().lower():
                after_hotspot_rank = idx + 1
                break

    # Hotspot rank change message
    if before_hotspot_rank is not None:
        if after_hotspot_rank is not None:
            if after_hotspot_rank > before_hotspot_rank:
                rank_change_str = f"#{before_hotspot_rank} → #{after_hotspot_rank} (dropped {after_hotspot_rank - before_hotspot_rank} places)"
                rank_improved = True
            elif after_hotspot_rank < before_hotspot_rank:
                rank_change_str = f"#{before_hotspot_rank} → #{after_hotspot_rank}"
                rank_improved = False
            else:
                rank_change_str = f"#{before_hotspot_rank} (unchanged in Top 20)"
                rank_improved = False
        else:
            rank_change_str = f"#{before_hotspot_rank} → Cleared from Top 20 Hotspots"
            rank_improved = True
    else:
        if after_hotspot_rank is not None:
            rank_change_str = f"Entered Hotspots at #{after_hotspot_rank}"
            rank_improved = False
        else:
            rank_change_str = "Not currently a Top-20 cluster"
            rank_improved = True

    # District statewide rank before vs after
    orig_district_means = state_schools_df.groupby("dtname")["demo_risk_score"].mean().sort_values(ascending=False)
    new_district_means = simulated_df.groupby("dtname")["demo_risk_score"].mean().sort_values(ascending=False)
    
    orig_dist_rank = list(orig_district_means.index).index(district_display_name) + 1 if district_display_name in orig_district_means.index else None
    new_dist_rank = list(new_district_means.index).index(district_display_name) + 1 if district_display_name in new_district_means.index else None

    risk_reduction_pct = round(((before_avg_risk - after_avg_risk) / before_avg_risk) * 100, 1) if before_avg_risk > 0 else 0.0
    high_risk_drop = before_high_count - after_high_count
    
    return {
        "district": canonical_district,
        "display_name": district_display_name,
        "total_schools": total_schools_in_district,
        "fixed_dimensions": fixed_dimensions,
        "current_gaps": {
            "toilets": round(orig_toilet * 100, 1),
            "library": round(orig_library * 100, 1),
            "computer": round(orig_computer * 100, 1),
            "internet": round(orig_internet * 100, 1),
            "infra_gap_score": round(orig_infra_score, 3)
        },
        "new_infra_gap_score": round(new_infra_score, 3),
        "infra_score_delta": round(orig_infra_score - new_infra_score, 3),
        "before": {
            "avg_risk": round(before_avg_risk, 3),
            "high_risk_count": before_high_count,
            "hotspot_rank": before_hotspot_rank,
            "district_state_rank": orig_dist_rank
        },
        "after": {
            "avg_risk": round(after_avg_risk, 3),
            "high_risk_count": after_high_count,
            "hotspot_rank": after_hotspot_rank,
            "district_state_rank": new_dist_rank
        },
        "reduction": {
            "risk_delta": round(before_avg_risk - after_avg_risk, 3),
            "risk_reduction_pct": risk_reduction_pct,
            "high_risk_prevented": high_risk_drop,
            "hotspot_rank_change": rank_change_str,
            "rank_improved": rank_improved
        }
    }
