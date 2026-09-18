from fastapi import APIRouter
from pydantic import BaseModel
from google import genai
import json
import os
import re
import time

router = APIRouter()

try:
    client = genai.Client()
except Exception as e:
    client = None

class AskRequest(BaseModel):
    query: str

SYSTEM_PROMPT = """You are an intelligent geospatial assistant for the Karnataka Dropout-Risk Hotspot Mapper.
The application analyzes 74,309 schools across 34 districts in Karnataka to identify geographic clusters with elevated dropout risk and optimize resource allocation (mobile units).

Map the user's natural language query into ONE of the following JSON structures:

1. {"action": "top_hotspots", "n": <integer>, "message": "<brief explanation>"}
   Use when the user asks for top/worst/highest hotspots or clusters (e.g., "show top 5 hotspots", "which clusters are worst?").

2. {"action": "filter_district", "district": "<district_name>", "message": "<brief explanation>"}
   Use when the user mentions or asks about a specific district in Karnataka (e.g., "how is Belagavi doing?", "show Mysore schools", "filter Bangalore").

3. {"action": "explain_score", "school_id": "<schcd>", "message": "<brief explanation>"}
   Use when the user provides or asks about a specific school code/ID.

4. {"action": "answer", "message": "<your clear, helpful explanation>"}
   Use for general questions about methodology, risk calculations, the optimizer, confidence flags, or project info.

Return ONLY a valid JSON object. Do not enclose in markdown blocks.
"""

def fallback_intent_parser(query: str) -> dict:
    """Deterministic fallback parser if external Gemini API is unreachable or rate-limited."""
    q = query.lower().strip()
    
    # Check for top hotspots
    top_match = re.search(r'(?:top|worst|highest|first)\s*(\d+)?', q)
    if 'hotspot' in q or 'cluster' in q or top_match:
        n = 5
        if top_match and top_match.group(1):
            try:
                n = int(top_match.group(1))
            except ValueError:
                n = 5
        return {
            "action": "top_hotspots",
            "n": n,
            "message": f"Identified top {n} dropout-risk hotspots across Karnataka."
        }
        
    # Check for school code
    code_match = re.search(r'\b(29\d{9})\b', q)
    if code_match or 'school' in q and re.search(r'\d{5,}', q):
        schcd = code_match.group(1) if code_match else re.search(r'\d{5,}', q).group(0)
        return {
            "action": "explain_score",
            "school_id": schcd,
            "message": f"Filtering school by UDISE code {schcd}."
        }
        
    # Known Karnataka districts
    districts = [
        "bagalkote", "ballari", "belagavi", "bengaluru rural", "bengaluru urban",
        "bidar", "chamarajanagara", "chikkaballapura", "chikkamagaluru", "chitradurga",
        "dakshina kannada", "davanagere", "dharwad", "gadag", "hassan", "haveri",
        "kalaburagi", "kodagu", "kolar", "koppal", "mandya", "mysuru", "raichur",
        "ramanagara", "shivamogga", "tumakuru", "udupi", "uttara kannada", "vijayanagara",
        "yadgir", "bangalore", "belgaum", "bellary", "gulbarga", "mysore", "shimoga"
    ]
    for d in districts:
        if d in q:
            proper = d.title()
            return {
                "action": "filter_district",
                "district": proper,
                "message": f"Filtering analysis and map view to {proper} district."
            }
            
    # Optimizer questions
    if any(w in q for w in ['optimize', 'optimizer', 'deployment', 'mobile unit', 'ilp', 'greedy']):
        return {
            "action": "answer",
            "message": "The deployment optimizer uses Integer Linear Programming (ILP) with PuLP to solve the Maximum Coverage Problem. It places K mobile units to maximize the number of risk-weighted schools covered within a specified radius, with optional equity caps per district."
        }
        
    # Fairness & Demographic Parity questions
    if any(w in q for w in ['fairness', 'demographic', 'parity', 'audit', 'gender', 'urban/rural']):
        return {
            "action": "fairness_audit",
            "message": "Opening the Model Fairness & Demographic Parity Audit across gender and urban/rural divides."
        }

    # What-if simulation questions
    if any(w in q for w in ['what-if', 'whatif', 'simulate', 'intervention', 'roi']):
        target_dist = None
        for d in districts:
            if d in q:
                target_dist = d.title()
                break
        return {
            "action": "what_if",
            "district": target_dist,
            "message": f"Opening What-If Infrastructure Simulator{f' for {target_dist}' if target_dist else ''}."
        }

    # Risk calculation questions
    if any(w in q for w in ['risk', 'formula', 'calculate', 'score', 'weight']):
        return {
            "action": "answer",
            "message": "The Demo Risk Score combines school-level structural factors (rural location, government management, terminal primary status) with district infrastructure gap scores. Use the Structural Signal Weight slider in the Hotspots tab to adjust the balance."
        }
        
    return {
        "action": "answer",
        "message": "You can ask me to find the top hotspots (e.g. 'show top 5 hotspots'), filter by district (e.g. 'Belagavi' or 'Mysuru'), locate a school by ID, or explain the risk model and optimizer."
    }

@router.post("/api/ask")
async def ask(req: AskRequest):
    query_str = (req.query or "").strip()
    if not query_str:
        return {"action": "answer", "message": "Please enter a question or query."}

    if not client:
        return fallback_intent_parser(query_str)

    candidate_models = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-1.5-flash']
    
    for model_name in candidate_models:
        for attempt in range(2):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=query_str,
                    config={
                        'system_instruction': SYSTEM_PROMPT,
                        'response_mime_type': 'application/json',
                    }
                )
                raw_text = (response.text or "").strip()
                # Clean up any potential markdown wrap
                if raw_text.startswith("```"):
                    raw_text = re.sub(r"^```(?:json)?\n?", "", raw_text)
                    raw_text = re.sub(r"\n?```$", "", raw_text)
                data = json.loads(raw_text)
                if isinstance(data, dict) and "action" in data:
                    return data
            except Exception as e:
                err_str = str(e)
                print(f"GenAI attempt {attempt+1} with {model_name} failed: {err_str}")
                time.sleep(0.4 * (attempt + 1))
                
    # If all API calls fail, fallback to deterministic parser
    return fallback_intent_parser(query_str)

