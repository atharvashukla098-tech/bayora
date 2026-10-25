import os

root = r'C:\Users\Admin\.gemini\antigravity\scratch\bayora\frontend\src'
for dirpath, _, filenames in os.walk(root):
    for fn in filenames:
        if fn.endswith(('.ts', '.tsx')):
            p = os.path.join(dirpath, fn)
            with open(p, 'r', encoding='utf-8') as f:
                c = f.read()
            if 'architecture' in c:
                matches = [l.strip() for l in c.splitlines() if 'id=' in l and 'architecture' in l]
                if matches:
                    print(f'{fn}: {matches}')
