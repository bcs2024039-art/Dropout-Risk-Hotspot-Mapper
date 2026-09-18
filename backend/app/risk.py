import pandas as pd
from .data import load_district_infra
import numpy as np

# Historical reference metrics from the 2019-20 Karnataka dataset
KARNATAKA_2019_20_REFERENCE = {
    "primary_dropout_pct": 1.18,
    "primary_promotion_pct": 98.49,
    "secondary_dropout_pct": 17.83,
    "secondary_promotion_pct": 81.71,
    "source": "UDISE+ cohort data via thejeshgn/udise-report-data-downloader"
}

def compute_risk(df: pd.DataFrame, real_weight: float = 0.5) -> pd.DataFrame:
    infra_df = load_district_infra()
    
    # 1. School-level deterministic signals (simulated from UDISE codes)
    df["is_rural"] = (df["rururb_label"] == "Rural").astype(int)
    # Terminal primary schools (no upper grades to transition to in the same school)
    df["is_terminal_primary"] = df["school_cat"].isin(["Primary", "Upper Primary only"]).astype(int)
    # Government management often correlates with resource constraints in this dataset
    df["is_govt"] = df["management"].str.contains("Government|Department of Education", case=False, na=False).astype(int)
    
    # Simple weighted risk signal (0 to 1)
    df["real_signal"] = (
        0.50 * df["is_rural"] + 
        0.35 * df["is_terminal_primary"] + 
        0.15 * df["is_govt"]
    )
    
    # 2. Join with district infrastructure gap
    df["district_join_key"] = df["dtname"].str.strip().str.upper()
    df = df.merge(infra_df[["district_join_key", "infra_gap_score"]], on="district_join_key", how="left")
    
    # Impute missing infra scores with mean
    mean_infra = df["infra_gap_score"].mean()
    df["infra_gap_score"] = df["infra_gap_score"].fillna(mean_infra)
    
    # Confidence drops if school signal strongly contradicts district infra context
    df["confidence"] = np.where(abs(df["real_signal"] - df["infra_gap_score"]) > 0.4, "Low", "High")
    
    # 3. Final Demo Risk Score
    # Blend the school's structural features with the district's infrastructure deficit
    df["demo_risk_score"] = real_weight * df["real_signal"] + (1.0 - real_weight) * df["infra_gap_score"]
    
    # Cap and floor
    df["demo_risk_score"] = df["demo_risk_score"].clip(0, 1)
    
    # 4. Tiers
    df["risk_tier"] = pd.cut(
        df["demo_risk_score"], 
        bins=[-0.1, 0.4, 0.6, 1.1], 
        labels=["Low", "Medium", "High"]
    )
    
    return df
