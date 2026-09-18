# Dropout-Risk Hotspot Mapper — Karnataka demo

Built for Horizon Round 1 (theme: AI with Education). Finds geographic
concentrations of schools facing elevated dropout risk, so an
administrator can see where to route support — a mobile tutoring unit,
an extra teacher posting, a transport subsidy — instead of spreading
resources evenly.

**Submitting?** See `submission/` for the project description, demo
video script, and a checklist against Round 1's actual requirements.

**Read this before presenting any number from this tool as fact:**
locations, school attributes, and the infrastructure signal behind the
risk score are all real UDISE+ government data (two independent
pulls — see "What's real" below). What's *not* independently verified
is the rule for how those signals combine into one score, and the
infra signal is real but district-level, not school-level. Treat the
combined `demo_risk_score` as a transparent, honestly-sourced proxy —
not a validated dropout-probability model — until you can get
school-level report data behind it.

## What's real vs. what's a modeling choice

| Layer | Status | Source |
|---|---|---|
| School name, location, category, management, rural/urban flag | **Real** | [`datameet/udise_schools`](https://github.com/datameet/udise_schools), filtered to Karnataka (74,309 schools) |
| Rural flag, "terminal primary" transition flag, govt-management flag | **Real, rule-based** | Derived directly from the fields above |
| Functional-toilet / library / computer / internet gap, per district | **Real**, 2019-20, district-level | [`thejeshgn/udise-report-data-downloader`](https://github.com/thejeshgn/udise-report-data-downloader)'s cached UDISE+ Public Report JSON — see `scripts/build_district_infra.py` |
| `demo_risk_score`, `risk_tier` | **Real inputs, chosen weighting** | `risk.py::compute_risk` blends the two rows above 50/50 — a documented choice, not a fitted model |

Two independently-sourced, real datasets, joined cleanly on all 34
Karnataka districts (see "Real-data cross-check" below for a sanity
check that they agree with each other and with outside research).

## Why grid cells instead of point clustering

The first pass ran DBSCAN directly on high-risk school *locations* —
a direct port of a patrol-hotspot pipeline. It doesn't transfer well:
parking violations are events, so violation *density* means "more
problems here." Schools are fixed infrastructure, so school *density*
mostly just means "more people live here," independent of risk. A
loose radius chained almost every rural school into one 53,000-school
"cluster"; a tight radius just rediscovered normal village school
spacing as ~1,900 meaningless micro-clusters.

The fix (`clustering.py::find_hotspots`): aggregate into fixed ~8km
grid cells (roughly taluk-scale) and rank cells by *relative* risk —
average score vs. the state-wide average — with a minimum school count
per cell so a couple of unlucky schools can't outrank a real
concentration. Same idea as the district-level LISA approach in the
closest published precedent ([Venkatesan & Mappillairaju, PLOS ONE
2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC9844897/)), just at
finer, sub-district granularity. DBSCAN is still used, just one level
down — grouping a single hotspot cell's schools for the drill-down
list (`clustering.py::schools_in_hotspot`).

## Real-data cross-check

The district infra numbers come from real UDISE+ cohort-flow data.
That same source lets you compute an actual number worth sanity-
checking against outside research: Karnataka's real 2019-20
secondary-level dropout rate comes out to **17.8%** (primary: 1.2%).
Separately, during this project's research, a 2023 PLOS ONE study
put *national* secondary dropout at **~17%** for a nearby year. Two
independently-obtained numbers, same ballpark — a reasonable
sanity check, not a proof the model is right.

## Architecture

```
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI application & API endpoints
│   │   ├── data.py          # School dataset loading & caching
│   │   ├── risk.py          # Multidimensional dropout-risk scoring model
│   │   ├── clustering.py    # Spatial grid hotspot aggregation & DBSCAN
│   │   ├── spatial_stats.py # Anselin Local Moran's I (LISA) autocorrelation
│   │   ├── optimizer.py     # Maximal Covering Location Problem (MCLP/MILP)
│   │   ├── whatif.py        # What-if infrastructure intervention simulation
│   │   ├── fairness.py      # Demographic parity & fairness audit
│   │   ├── boundaries.py    # District boundary polygon & live metrics joiner
│   │   └── ask.py           # Natural language query assistant
│   ├── data/
│   │   ├── karnataka_schools.csv               # 74k geocoded schools
│   │   ├── karnataka_district_infra_2019-20.csv # District infrastructure gap
│   │   └── karnataka_districts.geojson          # District polygon boundaries
│   └── requirements.txt     # Python backend dependencies
├── frontend/
│   ├── index.html           # Main single-page application dashboard
│   ├── style.css            # Dark glassmorphism UI styles
│   ├── app.js               # Interactive map, charts, filters & analysis
│   └── vendor/              # Local vendor assets (Leaflet, Leaflet Draw)
├── server.js                # Express dev/production reverse proxy
├── metadata.json            # Application configuration metadata
└── package.json             # Node.js project manifest & start script
```

No build step on the frontend on purpose — one less thing to break
five minutes before you present.

## Running it

```bash
# backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# frontend, in a second terminal
cd frontend
python3 -m http.server 5173
# open http://localhost:5173
```

First load takes a few seconds — it scores and clusters all 74k
schools once at startup, then serves from memory.

## State-wide choropleth

The hotspot map now has a district-shaded base layer underneath the
hotspot circles — the "zoomed-out view" from the stretch list is done.
Districts are colored by real average risk score; clicking one zooms
to its bounds, same interaction as clicking a hotspot circle.

**Real boundaries, reconciled against a differently-shaped real
dataset.** The polygons are 2011 Census district boundaries
([`datameet/maps`](https://github.com/datameet/maps), CC BY 2.5
India). That's a genuinely different source from the UDISE+ school
data, with a genuinely different district split: 30 Census districts
vs. 34 UDISE+ districts, because UDISE+ splits four populous districts
(Bengaluru Urban, Belgaum, Tumkur, Uttara Kannada) into two education-
districts each, with no matching boundary available here. Where that
happens, `scripts/build_district_boundaries.py` tags one polygon with
both UDISE+ names, and `boundaries.py` averages their live stats onto
it, school-count-weighted — one shaded region, an honest combined
number, not a false sub-division. Everywhere else it's a straight
rename (Bangalore → Bengaluru, Mysore → Mysuru, Gulbarga → Kalburgi —
Karnataka officially Kannada-ized several district names around 2014,
after this 2011 data's names were fixed). All 34 UDISE+ district names
resolve to exactly one of the 30 polygons — checked at build time, not
assumed.

**Stats stay live, geometry stays static.** `build_district_boundaries.py`
only outputs geometry and a name mapping — no risk numbers. `boundaries.py`
joins that onto whatever `risk.py` currently computes, at server
startup. Change the scoring model and the choropleth updates with it
automatically; there's no second copy of the scoring logic to keep in
sync.

**API:** `GET /api/districts/geojson` — a GeoJSON FeatureCollection,
each feature's `properties` carrying `school_count`, `avg_risk`,
`high_risk_count`, `risk_lift`, and `display_name`.

## Deploy units: resource-placement optimizer

A second tab in the frontend answers a different question than the
hotspot map: not just *where* is risk concentrated, but *where should
a limited number of mobile-tutoring units be based* to cover as much
of it as possible.

This is a **Maximal Covering Location Problem (MCLP)** — the standard
OR formulation behind siting ambulances, patrol cars, or (in the
ParkSight precedent) patrol beats. Solved with [PuLP](https://coin-or.github.io/pulp/)
+ the bundled CBC solver.

**Why a third, coarser grid.** `clustering.py` uses an ~8km grid to
*find* hotspots. This feature uses a separate ~28km, taluk-scale grid
(`optimizer.py::GRID_DEG`) to decide *where to base a van* — a van
serves a wider catchment than a hotspot cell, so candidate sites (301
of them, each needing ≥10 schools to count) are deliberately coarser.
Same "match the unit to the decision" reasoning as the hotspot-grid
fix, applied one level up.

**Why an ILP instead of just greedy.** Greedy (repeatedly add whichever
site covers the most remaining weighted demand) is a strong heuristic
here and ships as a baseline for comparison — on the plain version of
this problem it lands at or within a hair of the ILP's answer almost
every time, which is an honest property of greedy on coverage problems,
not a shortcoming of the comparison. The gap opens up once a realistic
constraint is added: a **max-units-per-district cap**, so a state
doesn't dump every unit into the two or three districts with the most
schools. Greedy has no clean way to look ahead around a cap like that;
the ILP takes it as one more linear constraint. At the default `k=20`
with a 1-unit-per-district cap on the real Karnataka data, the ILP
covers +54.0 weighted-risk-units more than greedy, solved in well
under half a second — small in relative terms, but a real, provable
gap on real data, not an asserted one. Both numbers are shown in the
UI for whatever K and radius you pick.

**Honest caveats**, also shown in-app: coverage radius is straight-line
(haversine) distance, not road travel time, and every unit is assumed
to cost the same. Both are simplifications worth replacing with real
routing/cost data before this plan drives an actual budget.

**API:** `GET /api/optimize?k=20&radius_km=20&equity=true&max_per_district=1`
— returns the chosen sites, ILP vs. greedy coverage, and solve time.
No extra setup: `pulp` is in `requirements.txt` and bundles CBC, so
`pip install -r requirements.txt` is still the only step.

## Reproducing or updating the real infra data

`backend/data/karnataka_district_infra_2019-20.csv` was built once
from `thejeshgn/udise-report-data-downloader`'s cached UDISE+ Public
Report JSON (a live scrape wasn't reachable from the sandbox this was
built in — see `scripts/build_district_infra.py`'s docstring for
exactly why and how). To rebuild it, or pull a newer year once the
upstream repo has one:

```bash
git clone https://github.com/thejeshgn/udise-report-data-downloader.git
cd udise-report-data-downloader
python /path/to/scripts/build_district_infra.py /path/to/backend/data/karnataka_district_infra_2019-20.csv
```

Going to real *school-level* infra data (rather than district-level)
would mean pulling from the live `udiseplus.gov.in` report dashboard
directly instead of the cached repo — worth doing before this drives
a real budget, not needed for the demo.

## Extending past Karnataka

`data.py` filters `datameet/udise_schools`' national CSV down to one
state, and `scripts/build_district_infra.py` filters to UDISE state
code 29. Change both filters and re-run to point the whole pipeline at
any other state — nothing else in the pipeline is Karnataka-specific.

## Stretch (not built yet)

- Real routing distance (instead of straight-line) for the deploy-units coverage radius.
- School-level (not just district-level) infra data, once reachable.
