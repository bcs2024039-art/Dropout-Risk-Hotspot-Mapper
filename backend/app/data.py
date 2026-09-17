import pandas as pd
import os

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

def load_schools() -> pd.DataFrame:
    df = pd.read_csv(os.path.join(DATA_DIR, "karnataka_schools.csv"), low_memory=False)
    # Clean basic coordinates
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    df = df.dropna(subset=["latitude", "longitude"])
    
    # Map raw numeric codes if they exist (UDISE standard)
    if "rururb" in df.columns:
        df["rururb_label"] = df["rururb"].map({1: "Rural", 2: "Urban"}).fillna("Unknown")
    else:
        df["rururb_label"] = "Unknown"
        
    return df

def load_district_infra() -> pd.DataFrame:
    """Loads 2019-20 district level infrastructure gap scores."""
    df = pd.read_csv(os.path.join(DATA_DIR, "karnataka_district_infra_2019-20.csv"))
    # Normalize names for joining
    df["district_join_key"] = df["district_name"].str.strip().str.upper()
    return df
