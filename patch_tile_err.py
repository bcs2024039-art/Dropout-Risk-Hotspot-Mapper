with open('backend/app/main.py', 'r') as f:
    content = f.read()

content = content.replace('print(f"Error fetching tile {z}/{x}/{y}: {e}")', 'print(f"Error fetching tile {z}/{x}/{y}: {type(e)} {e}")')

with open('backend/app/main.py', 'w') as f:
    f.write(content)
