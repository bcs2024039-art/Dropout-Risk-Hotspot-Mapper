import httpx
import os
import asyncio

async def main():
    key = os.environ.get('CARTO_API_KEY', '')
    url = f"https://a.basemaps.cartocdn.com/dark_nolabels/7/91/58.png"
    if key:
        url += f"?key={key}"
    print(f"Fetching: {url}")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url)
            print(f"Status: {r.status_code}")
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(main())
