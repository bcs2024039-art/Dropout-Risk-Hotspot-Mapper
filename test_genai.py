import os
from google import genai

client = genai.Client()
response = client.models.generate_content(
    model='gemini-3.1-pro-preview',
    contents='return a short JSON: {"action": "clarify", "message": "hello"}',
    config={
        'response_mime_type': 'application/json',
    }
)
print(response.text)
