with open('backend/app/main.py', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if line.startswith('app = FastAPI('):
        lines.insert(i, 'from . import ask\n')
        break

for i, line in enumerate(lines):
    if 'app.add_middleware(' in line:
        # insert after the block
        pass
        
with open('backend/app/main.py', 'w') as f:
    f.writelines(lines)
