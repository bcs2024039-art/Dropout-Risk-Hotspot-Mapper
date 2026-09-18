with open('backend/app/main.py', 'r') as f:
    content = f.read()

import re

new_tile_logic = """
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
"""

content = re.sub(r'@app\.get\("/api/tiles/\{z\}/\{x\}/\{y\}"\)\nasync def tiles\(z: str, x: str, y: str\):.*?(?=# app\.mount)', new_tile_logic + '\n', content, flags=re.DOTALL)

with open('backend/app/main.py', 'w') as f:
    f.write(content)
