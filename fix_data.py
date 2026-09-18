import os
with open('backend/app/data.py', 'r') as f:
    content = f.read()

replacement = """
QA_STATS = {
    "duplicate_schcd": 0,
    "out_of_bounds_coords": 0,
    "missing_fields": 0
}

def load_schools() -> pd.DataFrame:
    global QA_STATS
    df = pd.read_csv(os.path.join(DATA_DIR, "karnataka_schools.csv"), low_memory=False)
    
    # QA checking
    if "schcd" in df.columns:
        QA_STATS["duplicate_schcd"] = int(df["schcd"].duplicated().sum())
        
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    
    out_of_bounds = df[
        (df["latitude"] < 11.0) | (df["latitude"] > 19.0) |
        (df["longitude"] < 73.0) | (df["longitude"] > 79.0)
    ]
    QA_STATS["out_of_bounds_coords"] = int(len(out_of_bounds))
    
    missing_mask = df.get("dtname", pd.Series(dtype=object)).isna() | df.get("school_cat", pd.Series(dtype=object)).isna() | df.get("management", pd.Series(dtype=object)).isna()
    QA_STATS["missing_fields"] = int(missing_mask.sum())

    df = df.dropna(subset=["latitude", "longitude"])
"""

import re
content = re.sub(r'def load_schools\(\) -> pd\.DataFrame:.*?df = df\.dropna\(subset=\["latitude", "longitude"\]\)', replacement, content, flags=re.DOTALL)

with open('backend/app/data.py', 'w') as f:
    f.write(content)
