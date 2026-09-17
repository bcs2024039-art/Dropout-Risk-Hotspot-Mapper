import pandas as pd
from typing import Tuple

def find_hotspots(df: pd.DataFrame, min_schools: int = 15, top_n: int = 20) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Find contiguous spatial hotspots where average risk is significantly higher than state average.
    Uses simple grid aggregation (~8km resolution).
    """
    if len(df) == 0:
        return df, pd.DataFrame()
        
    state_avg_risk = df["demo_risk_score"].mean()
    
    # Grid cells (0.08 degrees is roughly 8km x 8km in Karnataka)
    GRID_DEG = 0.08
    df_cluster = df.copy()
    df_cluster["cell_lat"] = (df_cluster["latitude"] // GRID_DEG) * GRID_DEG
    df_cluster["cell_lon"] = (df_cluster["longitude"] // GRID_DEG) * GRID_DEG
    df_cluster["cell_id"] = df_cluster["cell_lat"].astype(str) + "_" + df_cluster["cell_lon"].astype(str)
    
    # Aggregate
    cell_stats = df_cluster.groupby("cell_id").agg(
        school_count=("schcd", "count"),
        avg_risk=("demo_risk_score", "mean"),
        high_risk_count=("risk_tier", lambda x: (x == "High").sum()),
        centroid_lat=("latitude", "mean"),
        centroid_lon=("longitude", "mean"),
        district=("dtname", lambda x: x.mode()[0] if not x.empty else "Unknown")
    ).reset_index()
    
    # Filter to dense cells with elevated risk
    eligible = cell_stats[
        (cell_stats["school_count"] >= min_schools) & 
        (cell_stats["avg_risk"] > state_avg_risk)
    ].copy()
    
    eligible["risk_lift"] = eligible["avg_risk"] - state_avg_risk
    
    # Take top N by risk lift
    hotspots = eligible.sort_values("risk_lift", ascending=False).head(top_n).copy()
    hotspots["cluster_id"] = range(len(hotspots))
    
    # Join cluster_id back to schools
    if "cluster_id" in df_cluster.columns:
        df_cluster = df_cluster.drop(columns=["cluster_id"])
        
    if len(hotspots) > 0:
        df_cluster = df_cluster.merge(hotspots[["cell_id", "cluster_id"]], on="cell_id", how="left")
        df_cluster["cluster_id"] = df_cluster["cluster_id"].fillna(-1).astype(int)
    else:
        df_cluster["cluster_id"] = -1
        
    return df_cluster, hotspots
