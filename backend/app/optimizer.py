import pandas as pd
import numpy as np
from pulp import LpProblem, LpMaximize, LpVariable, lpSum, PULP_CBC_CMD, LpStatus
import time
from typing import Optional, NamedTuple
from dataclasses import dataclass

@dataclass
class OptimizerResult:
    status: str
    solve_seconds: float
    k: int
    radius_km: float
    total_demand: float
    ilp_coverage: float
    greedy_coverage: float
    sites: pd.DataFrame

def haversine_dist(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = np.sin(dlat / 2)**2 + np.cos(np.radians(lat1)) * np.cos(np.radians(lat2)) * np.sin(dlon / 2)**2
    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    return R * c

def solve(
    df: pd.DataFrame, 
    k: int = 10, 
    radius_km: float = 20.0,
    max_per_district: Optional[int] = None,
) -> OptimizerResult:
    t0 = time.time()
    
    if len(df) == 0:
        return OptimizerResult("No Data", 0.0, k, radius_km, 0.0, 0.0, 0.0, pd.DataFrame())

    # Aggregate to grid to reduce ILP size (MCLP scales poorly with 74k points)
    GRID_DEG = 0.25 # ~25km macro grid for candidate sites
    df_grid = df.copy()
    df_grid["cell_lat"] = (df_grid["latitude"] // GRID_DEG) * GRID_DEG
    df_grid["cell_lon"] = (df_grid["longitude"] // GRID_DEG) * GRID_DEG
    df_grid["site_id"] = df_grid["cell_lat"].astype(str) + "_" + df_grid["cell_lon"].astype(str)
    
    sites = df_grid.groupby("site_id").agg(
        school_count=("schcd", "count"),
        high_risk_count=("risk_tier", lambda x: (x == "High").sum()),
        demand=("demo_risk_score", "sum"),
        lat=("latitude", "mean"),
        lon=("longitude", "mean"),
        district=("dtname", lambda x: x.mode()[0] if not x.empty else "Unknown")
    ).reset_index()
    
    # Filter out empty areas to speed up solve
    sites = sites[sites["school_count"] >= 10].reset_index(drop=True)
    n = len(sites)
    
    if n == 0:
        return OptimizerResult("No Valid Sites", 0.0, k, radius_km, 0.0, 0.0, 0.0, sites)
        
    total_demand = sites["demand"].sum()

    # Precompute coverage matrix (i covers j)
    # A_ij = 1 if distance(site i, site j) <= radius
    A = np.zeros((n, n), dtype=int)
    lat = sites["lat"].values
    lon = sites["lon"].values
    for i in range(n):
        dist = haversine_dist(lat[i], lon[i], lat, lon)
        A[i, :] = (dist <= radius_km).astype(int)

    # Fast Greedy Baseline
    covered = np.zeros(n, dtype=bool)
    greedy_chosen = []
    dist_counts = {d: 0 for d in sites["district"].unique()}
    
    for _ in range(min(k, n)):
        best_gain = -1
        best_idx = -1
        for j in range(n):
            if j in greedy_chosen: continue
            
            d = sites.loc[j, "district"]
            if max_per_district and dist_counts[d] >= max_per_district:
                continue
                
            new_cover = A[:, j] == 1
            gain = sites.loc[new_cover & ~covered, "demand"].sum()
            
            if gain > best_gain:
                best_gain = gain
                best_idx = j
                
        if best_idx == -1 or best_gain == 0:
            break
            
        greedy_chosen.append(best_idx)
        covered |= (A[:, best_idx] == 1)
        dist_counts[sites.loc[best_idx, "district"]] += 1
        
    greedy_coverage = sites.loc[covered, "demand"].sum()

    # ILP Solver (MCLP)
    prob = LpProblem("MCLP", LpMaximize)
    
    # Variables
    # y[j] = 1 if facility built at site j
    y = [LpVariable(f"y_{j}", cat="Binary") for j in range(n)]
    # x[i] = 1 if demand node i is covered
    x = [LpVariable(f"x_{i}", cat="Binary") for i in range(n)]
    
    # Objective: maximize covered demand
    prob += lpSum(sites.loc[i, "demand"] * x[i] for i in range(n))
    
    # Constraint 1: Build exactly k facilities
    prob += lpSum(y[j] for j in range(n)) <= k
    
    # Constraint 2: Equity (max per district)
    if max_per_district is not None:
        for d in sites["district"].unique():
            prob += lpSum(y[j] for j in range(n) if sites.loc[j, "district"] == d) <= max_per_district
    
    # Constraint 3: Coverage linkage
    # x[i] can only be 1 if at least one covering facility y[j] is built
    for i in range(n):
        prob += x[i] <= lpSum(y[j] for j in range(n) if A[i, j] == 1)
        
    # Solve
    prob.solve(PULP_CBC_CMD(msg=False, timeLimit=5))
    
    ilp_coverage = sum(sites.loc[i, "demand"] for i in range(n) if x[i].varValue and x[i].varValue > 0.5)
    
    # Mark chosen
    sites["chosen"] = False
    for j in range(n):
        if y[j].varValue and y[j].varValue > 0.5:
            sites.at[j, "chosen"] = True
            
    status = LpStatus[prob.status]
            
    return OptimizerResult(
        status=status,
        solve_seconds=time.time() - t0,
        k=k,
        radius_km=radius_km,
        total_demand=total_demand,
        ilp_coverage=ilp_coverage,
        greedy_coverage=greedy_coverage,
        sites=sites
    )

def solve_curve(
    df: pd.DataFrame,
    k_max: int = 40,
    radius_km: float = 20.0,
    max_per_district: Optional[int] = None,
    step: int = 2
) -> list:
    if len(df) == 0:
        return []

    GRID_DEG = 0.25
    df_grid = df.copy()
    df_grid["cell_lat"] = (df_grid["latitude"] // GRID_DEG) * GRID_DEG
    df_grid["cell_lon"] = (df_grid["longitude"] // GRID_DEG) * GRID_DEG
    df_grid["site_id"] = df_grid["cell_lat"].astype(str) + "_" + df_grid["cell_lon"].astype(str)

    sites = df_grid.groupby("site_id").agg(
        school_count=("schcd", "count"),
        demand=("demo_risk_score", "sum"),
        lat=("latitude", "mean"),
        lon=("longitude", "mean"),
        district=("dtname", lambda x: x.mode()[0] if not x.empty else "Unknown")
    ).reset_index()

    sites = sites[sites["school_count"] >= 10].reset_index(drop=True)
    n = len(sites)
    if n == 0:
        return []

    total_demand = sites["demand"].sum() or 1.0

    A = np.zeros((n, n), dtype=int)
    lat = sites["lat"].values
    lon = sites["lon"].values
    for i in range(n):
        dist = haversine_dist(lat[i], lon[i], lat, lon)
        A[i, :] = (dist <= radius_km).astype(int)

    districts = sites["district"].unique() if max_per_district is not None else []
    dist_indices = {d: [j for j in range(n) if sites.loc[j, "district"] == d] for d in districts}
    cov_indices = [[j for j in range(n) if A[i, j] == 1] for i in range(n)]

    results = []
    solver = PULP_CBC_CMD(msg=False, timeLimit=3)
    for k in range(step, k_max + 1, step):
        prob = LpProblem("MCLP_Curve", LpMaximize)
        y = [LpVariable(f"y_{j}", cat="Binary") for j in range(n)]
        x = [LpVariable(f"x_{i}", cat="Binary") for i in range(n)]

        prob += lpSum(sites.loc[i, "demand"] * x[i] for i in range(n))
        prob += lpSum(y[j] for j in range(n)) <= k

        if max_per_district is not None:
            for d, indices in dist_indices.items():
                prob += lpSum(y[j] for j in indices) <= max_per_district

        for i in range(n):
            prob += x[i] <= lpSum(y[j] for j in cov_indices[i])

        prob.solve(solver)
        cov = sum(sites.loc[i, "demand"] for i in range(n) if x[i].varValue and x[i].varValue > 0.5)
        results.append({
            "k": k,
            "ilp_coverage_pct": round(100.0 * cov / total_demand, 2)
        })

    return results
