with open('backend/app/main.py', 'r') as f:
    content = f.read()

content = content.replace("filteredget_state(real_weight)[1]", "filtered_hotspots")
content = content.replace("totalget_state(real_weight)[0]", "total_schools")

with open('backend/app/main.py', 'w') as f:
    f.write(content)
