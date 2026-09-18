with open('frontend/app.js', 'r') as f:
    content = f.read()

import re
# Collapse consecutive identical real_weight appends
content = re.sub(r"(  params\.append\('real_weight', currentFilters\.real_weight\);\n)+", r"  params.append('real_weight', currentFilters.real_weight);\n", content)

with open('frontend/app.js', 'w') as f:
    f.write(content)
