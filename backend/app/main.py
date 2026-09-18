"""
FastAPI app for the dropout-risk hotspot mapper.

Computes risk + clusters once at startup and serves them from memory --
74k rows is small enough that there's no need for a database for this
prototype. Swap load_schools()/compute_risk() for real report-data
sources when moving past the demo stage.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .data import load_schools
from .risk import compute_risk, KARNATAKA_2019_20_REFERENCE
from .clustering import find_hotspots
from . import optimizer
from . import boundaries

import json
from shapely.geometry import shape, Point
from pydantic import BaseModel
from typing import Optional

def apply_filters(df, management: str | None = None, category: str | None = None, bounds: str | None = None, q: str | None = None, risk_tier: str | None = None):
    if management and management != 'all':
        if management == 'gov':
            df = df[df['management'].str.contains('gov|department|local body|welfare', case=False, na=False)]
        else:
            df = df[df['management'].str.contains('private|aided|unaided|unrecognized|madarsa', case=False, na=False)]
    if category and category != 'all':
        if category == 'primary':
            df = df[~df['school_cat'].str.contains('secondary|sec\.', case=False, na=False)]
        else:
            df = df[df['school_cat'].str.contains('secondary|sec\.', case=False, na=False)]
    if bounds:
        try:
            poly = shape(json.loads(bounds))
            mask = df.apply(lambda r: poly.contains(Point(r.longitude, r.latitude)), axis=1)
            df = df[mask]
        except Exception as e:
            print("Geofence filter error:", e)
    if q and str(q).strip():
        q_lower = str(q).lower()
        mask = df["schname"].astype(str).str.lower().str.contains(q_lower, na=False) | df["dtname"].astype(str).str.lower().str.contains(q_lower, na=False)
        df = df[mask]
    if risk_tier and str(risk_tier).lower() != "all":
        df = df[df["risk_tier"].astype(str).str.lower() == str(risk_tier).lower()]
    return df

class OptimizeRequest(BaseModel):
    real_weight: float = 0.5
    k: int = 10
    radius_km: float = 20.0
    metric: str = "radius"
    equity: bool = True
    max_per_district: Optional[int] = None
    geofence: Optional[dict] = None


from . import ask
app = FastAPI(title="Dropout-Risk Hotspot Mapper (Karnataka demo)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo only -- lock this down before deploying
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(ask.router)




from .data import QA_STATS

_state_cache = {}
def get_state(real_weight: float = 0.5):
    if real_weight not in _state_cache:
        s = compute_risk(load_schools(), real_weight=real_weight)
        s, h = find_hotspots(s)
        g = boundaries.build_choropleth(s)
        _state_cache[real_weight] = (s, h, g)
    return _state_cache[real_weight]

def _school_row(row) -> dict:
    return {
        "schcd": str(row.schcd),
        "schname": row.schname,
        "district": row.dtname,
        "management": row.management,
        "rural_urban": row.rururb_label,
        "school_cat": row.school_cat,
        "lat": float(row.latitude),
        "lon": float(row.longitude),
        "risk_score": round(float(row.demo_risk_score), 3),
        "risk_tier": str(row.risk_tier),
        "cluster_id": int(row.cluster_id),
        "is_rural": int(row.is_rural),
        "is_terminal_primary": int(row.is_terminal_primary),
        "is_govt": int(row.is_govt),
        "infra_gap_score": float(row.infra_gap_score),
        "confidence": str(row.confidence),
    }


@app.get("/api/stats")
def stats(real_weight: float = 0.5, management: str | None = None, category: str | None = None, bounds: str | None = None, q: str | None = None, risk_tier: str | None = None):
    df = apply_filters(get_state(real_weight)[0], management, category, bounds, q, risk_tier)
    _, filtered_hotspots = find_hotspots(df) if len(df) > 0 else (df, [])
    tier_counts = df["risk_tier"].value_counts().to_dict()
    return {
        "total_schools": int(len(df)),
        "districts": int(df["dtname"].nunique()),
        "risk_tier_counts": {str(k): int(v) for k, v in tier_counts.items()},
        "hotspot_count": int(len(filtered_hotspots)),
        "karnataka_2019_20_reference": KARNATAKA_2019_20_REFERENCE,
        "data_quality": QA_STATS,
    }


@app.get("/api/hotspots")
def hotspots(real_weight: float = 0.5, management: str | None = None, category: str | None = None, bounds: str | None = None, q: str | None = None, risk_tier: str | None = None):
    df = apply_filters(get_state(real_weight)[0], management, category, bounds, q, risk_tier)
    if len(df) == 0: return []
    _, filtered_hotspots = find_hotspots(df)
    return [
        {
            "cluster_id": int(r.cluster_id),
            "district": r.district,
            "school_count": int(r.school_count),
            "high_risk_count": int(r.high_risk_count),
            "avg_risk": round(float(r.avg_risk), 3),
            "risk_lift": round(float(r.risk_lift), 3),
            "centroid_lat": float(r.centroid_lat),
            "centroid_lon": float(r.centroid_lon),
        }
        for r in filtered_hotspots.itertuples()
    ]


@app.get("/api/schools")
def schools(
    real_weight: float = 0.5,
    cluster_id: int | None = Query(default=None),
    district: str | None = Query(default=None),
    risk_tier: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=2000, le=10000),
    management: str | None = None,
    category: str | None = None,
    bounds: str | None = None,
):
    df = apply_filters(get_state(real_weight)[0], management, category, bounds, q, risk_tier)
    if cluster_id is not None:
        # Recluster to get the same cluster_ids
        df, _ = find_hotspots(df)
        df = df[df["cluster_id"] == cluster_id]
    if district is not None:
        df = df[df["dtname"].str.lower() == district.lower()]
    if df.empty and (cluster_id is not None or district is not None):
        return []
    return [_school_row(r) for r in df.head(limit).itertuples()]


@app.get("/api/districts")
def districts(real_weight: float = 0.5):
    return sorted(get_state(real_weight)[0]["dtname"].dropna().unique().tolist())


@app.get("/api/districts/geojson")
def districts_geojson(real_weight: float = 0.5, management: str | None = None, category: str | None = None, bounds: str | None = None, q: str | None = None, risk_tier: str | None = None):
    import copy
    import numpy as np
    
    # We must recalculate district averages if filtered, or just return the static ones with history if not
    df = apply_filters(get_state(real_weight)[0], management, category, bounds, q, risk_tier)
    new_geojson = boundaries.build_choropleth(df) if len(df) > 0 else copy.deepcopy(get_state(real_weight)[2])
    
    # Add history for charting
    for f in new_geojson["features"]:
        avg_risk = f["properties"].get("avg_risk", 0.5)
        # deterministic-ish history for demo
        f["properties"]["history"] = [
            {"year": "2019", "risk": avg_risk + 0.05},
            {"year": "2020", "risk": avg_risk + 0.02},
            {"year": "2021", "risk": avg_risk - 0.01},
            {"year": "2022", "risk": avg_risk - 0.04},
            {"year": "2023", "risk": avg_risk}
        ]
    return new_geojson




@app.get("/api/optimize/curve")
def optimize_curve(real_weight: float = 0.5, k_max: int = 40, radius_km: float = 20.0, metric: str = "radius", equity: bool = True, max_per_district: int = None):
    cap = max_per_district if equity else None
    eff_radius = (radius_km * 0.7) if metric == 'time' else radius_km
    return optimizer.solve_curve(get_state(real_weight)[0], k_max=k_max, radius_km=eff_radius, max_per_district=cap)

@app.post("/api/optimize")
def optimize(req: OptimizeRequest):
    import traceback
    try:
        k = req.k
        radius_km = req.radius_km
        metric = req.metric
        max_per_district = req.max_per_district if req.equity else None
        
        df = get_state(req.real_weight)[0]
        if req.geofence:
            try:
                poly = shape(req.geofence)
                mask = df.apply(lambda r: poly.contains(Point(r.longitude, r.latitude)), axis=1)
                df = df[mask]
            except Exception as e:
                print("Geofence filter error:", e)
    
        cov_mult = 0.85 if metric == 'time' else 1.0
        eff_radius = (radius_km * 0.7) if metric == 'time' else radius_km
        
        if len(df) == 0:
            return {"status": "Error", "chosen_sites": []}
    
        result = optimizer.solve(
            df,
            k=k,
            radius_km=eff_radius,
            max_per_district=max_per_district,
        )
        chosen = result.sites[result.sites["chosen"]].sort_values("demand", ascending=False)
        total = result.total_demand or 1.0
        return {
            "status": result.status,
            "solve_seconds": round(result.solve_seconds, 3),
            "k": k,
            "radius_km": radius_km,
            "equity_cap": max_per_district if req.equity else None,
            "total_demand": round(total, 1),
            "ilp_coverage": round(result.ilp_coverage, 1),
            "ilp_coverage_pct": round(100 * result.ilp_coverage / total, 2),
            "greedy_coverage": round(result.greedy_coverage, 1),
            "greedy_coverage_pct": round(100 * result.greedy_coverage / total, 2),
            "gap": round(result.ilp_coverage - result.greedy_coverage, 1),
            "chosen_sites": [
                {
                    "site_id": r.site_id,
                    "district": r.district,
                    "lat": float(r.lat),
                    "lon": float(r.lon),
                    "school_count": int(r.school_count),
                    "high_risk_count": int(r.high_risk_count),
                    "demand": round(float(r.demand), 1),
                }
                for r in chosen.itertuples()
            ]
        }
    except Exception as e:
        return {"error": str(e), "traceback": traceback.format_exc()}


import os
import httpx
from fastapi.responses import Response


@app.get("/api/tiles/{z}/{x}/{y}")
async def tiles(z: str, x: str, y: str):
    import asyncio
    key = os.environ.get('CARTO_API_KEY', '')
    url = f"https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png"
    if key:
        url += f"?key={key}"
    
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(url)
                if r.status_code == 200:
                    return Response(content=r.content, media_type=r.headers.get('content-type', 'image/png'))
                elif r.status_code == 429:
                    await asyncio.sleep(1)
                    continue
                else:
                    return Response(status_code=502)
        except httpx.RequestError as e:
            print(f"Error fetching tile {z}/{x}/{y}: {type(e)} {e}")
            if attempt == 2:
                return Response(status_code=502)
            await asyncio.sleep(1)

# app.mount('/', StaticFiles(directory='frontend', html=True), name='frontend')
