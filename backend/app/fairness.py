"""
Fairness and demographic parity audit for the Karnataka Dropout Risk scoring model.
Audits representation of demographic groups in High-risk flags vs population share,
benchmarked against the model's intentional structural weightings.
"""

import pandas as pd
import numpy as np
from typing import Dict, Any

def audit_model_fairness(df: pd.DataFrame, real_weight: float = 0.5) -> Dict[str, Any]:
    """
    Computes demographic representation and disparity ratios for key grouping variables:
    - Rural vs. Urban (is_rural)
    - Government vs. Private/Aided (is_govt)
    - Terminal Primary vs. Composite/Secondary (is_terminal_primary)
    
    Nuance: Accounts for intended model weights (0.50 rural, 0.35 terminal, 0.15 govt).
    Identifies if observed high-risk disparity exceeds what the mathematical scoring rule expects.
    """
    total_schools = len(df)
    if total_schools == 0:
        return {"groups": [], "summary": "No data available."}
        
    total_high_risk = int((df["risk_tier"] == "High").sum())
    state_high_rate = total_high_risk / total_schools if total_schools > 0 else 1.0
    state_avg_score = float(df["demo_risk_score"].mean()) if total_schools > 0 else 0.5
    
    groups_config = [
        {
            "id": "rural",
            "dimension": "Location",
            "group_name": "Rural Schools",
            "mask": df["is_rural"] == 1,
            "formula_weight": 0.50 * real_weight,
            "weight_note": f"{int(0.50 * real_weight * 100)}% structural weight by design"
        },
        {
            "id": "urban",
            "dimension": "Location",
            "group_name": "Urban Schools",
            "mask": df["is_rural"] == 0,
            "formula_weight": 0.0,
            "weight_note": "No rural vulnerability weight"
        },
        {
            "id": "govt",
            "dimension": "Management",
            "group_name": "Government Managed",
            "mask": df["is_govt"] == 1,
            "formula_weight": 0.15 * real_weight,
            "weight_note": f"{int(0.15 * real_weight * 100)}% resource constraint weight"
        },
        {
            "id": "private_aided",
            "dimension": "Management",
            "group_name": "Private / Aided",
            "mask": df["is_govt"] == 0,
            "formula_weight": 0.0,
            "weight_note": "Private / aided administration"
        },
        {
            "id": "terminal_primary",
            "dimension": "Grade Span",
            "group_name": "Terminal Primary",
            "mask": df["is_terminal_primary"] == 1,
            "formula_weight": 0.35 * real_weight,
            "weight_note": f"{int(0.35 * real_weight * 100)}% terminal grade transition risk"
        },
        {
            "id": "composite_sec",
            "dimension": "Grade Span",
            "group_name": "Composite / Upper Sec",
            "mask": df["is_terminal_primary"] == 0,
            "formula_weight": 0.0,
            "weight_note": "Continuous internal grade transitions"
        }
    ]
    
    rows = []
    watch_count = 0
    
    for g in groups_config:
        sub = df[g["mask"]]
        n = len(sub)
        if n == 0:
            continue
            
        pct_schools = (n / total_schools) * 100.0
        high_in_group = int((sub["risk_tier"] == "High").sum())
        pct_high = (high_in_group / total_high_risk * 100.0) if total_high_risk > 0 else 0.0
        
        # Observed ratio: share of High-risk flags / share of all schools
        observed_ratio = (pct_high / pct_schools) if pct_schools > 0 else 1.0
        
        # Expected ratio: what the formula weighting and infrastructure gap baseline predicts
        group_avg_score = float(sub["demo_risk_score"].mean())
        expected_ratio = (group_avg_score / state_avg_score) if state_avg_score > 0 else 1.0
        
        # Departure from intended model weighting
        departure = observed_ratio - expected_ratio
        
        # If departure is notably higher than the model formula predicts (+15%), flag for watch
        is_watch = (observed_ratio > 1.25 and departure > 0.18) or (departure > 0.25)
        if is_watch:
            watch_count += 1
            tag = "Watch"
            tag_class = "tag-watch"
            note = f"Elevated by +{round(departure, 2)} beyond documented formula weighting."
        else:
            tag = "Expected"
            tag_class = "tag-expected"
            note = "Representation conforms to intentional structural formula weights."
            
        rows.append({
            "id": g["id"],
            "dimension": g["dimension"],
            "group_name": g["group_name"],
            "school_count": n,
            "pct_of_schools": round(pct_schools, 1),
            "high_risk_count": high_in_group,
            "pct_of_high_risk": round(pct_high, 1),
            "observed_ratio": round(observed_ratio, 2),
            "expected_ratio": round(expected_ratio, 2),
            "departure": round(departure, 2),
            "tag": tag,
            "tag_class": tag_class,
            "formula_weight_note": g["weight_note"],
            "note": note
        })
        
    return {
        "groups": rows,
        "total_schools": total_schools,
        "total_high_risk": total_high_risk,
        "statewide_high_pct": round(state_high_rate * 100, 1),
        "watch_flags": watch_count,
        "conclusion": (
            "Model behavioral audit shows high-risk concentrations closely track intended structural inputs "
            "(rural geography, terminal transition points, and infrastructure gaps) with no uncalibrated demographic compounding."
            if watch_count == 0 else
            f"Audit highlighted {watch_count} demographic subgroup(s) exhibiting higher-than-expected risk compounding beyond intended weighting rules."
        )
    }
