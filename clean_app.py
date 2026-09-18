with open('frontend/app.js', 'r') as f:
    content = f.read()
import re
# Remove the first occurrence of weightTimeout (lines 531-542 roughly)
content = re.sub(r'let weightTimeout = null;\ndocument\.getElementById\(\'realWeightSlider\'\)\.addEventListener\(\'input\', \(e\) => \{.*?\n\}\);\n', '', content, flags=re.DOTALL)
with open('frontend/app.js', 'w') as f:
    f.write(content)
