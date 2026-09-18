with open('backend/app/risk.py', 'r') as f:
    content = f.read()

content = content.replace(
    "def compute_risk(df: pd.DataFrame) -> pd.DataFrame:",
    "def compute_risk(df: pd.DataFrame, real_weight: float = 0.5) -> pd.DataFrame:"
)
content = content.replace(
    "df[\"demo_risk_score\"] = 0.5 * df[\"real_signal\"] + 0.5 * df[\"infra_gap_score\"]",
    "df[\"demo_risk_score\"] = real_weight * df[\"real_signal\"] + (1.0 - real_weight) * df[\"infra_gap_score\"]"
)

with open('backend/app/risk.py', 'w') as f:
    f.write(content)
