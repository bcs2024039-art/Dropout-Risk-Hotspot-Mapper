with open('backend/app/main.py', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if line.startswith('app.add_middleware('):
        idx = i
        while not lines[idx].strip() == ')':
            idx += 1
        lines.insert(idx + 1, 'app.include_router(ask.router)\n')
        break

with open('backend/app/main.py', 'w') as f:
    f.writelines(lines)
