from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from google import genai
import json

router = APIRouter()

try:
    client = genai.Client()
except Exception as e:
    client = None

class AskRequest(BaseModel):
    query: str

SYSTEM_PROMPT = """You are an AI assistant for a dropout-risk hotspot mapper.
Your task is to map a user's natural language query to ONE of the following JSON actions:

1. {"action": "top_hotspots", "n": <integer>}
   Use this when the user wants to see the top N hotspots. Example: "show me the 5 worst hotspots"
2. {"action": "filter_district", "district": "<district_name>"}
   Use this when the user asks about a specific district. Example: "how is bangalore doing?"
3. {"action": "explain_score", "school_id": "<schcd>"}
   Use this when the user asks about a specific school by ID.
4. {"action": "clarify", "message": "<your_message>"}
   Use this for anything else that doesn't map cleanly. Keep it brief.

Return ONLY a valid JSON object. Do not include markdown formatting like ```json.
"""

@router.post("/api/ask")
async def ask(req: AskRequest):
    if not client:
        return {"action": "clarify", "message": "Gemini API client not initialized. Check GEMINI_API_KEY."}

    try:
        response = client.models.generate_content(
            model='gemini-3.8-flash',
            contents=req.query,
            config={
                'system_instruction': SYSTEM_PROMPT,
                'response_mime_type': 'application/json',
            }
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"GenAI Error: {e}")
        return {"action": "clarify", "message": f"I couldn't process that right now. (Error: {str(e)})"}
