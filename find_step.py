import json

with open(r'C:\Users\Admin\.gemini\antigravity\brain\dcf57fa7-2e18-4e07-8a50-96389f96f7bd\.system_generated\logs\transcript_full.jsonl', 'r', encoding='utf-8') as f:
    for line in f:
        if 'Sleek Decongested Telemetry Dock' in line:
            obj = json.loads(line)
            content = obj.get('content', '')
            if 'Lock className' in content:
                i = content.find('Sleek Decongested Telemetry Dock')
                print("ORIGINAL DOCK:\n", content[i:i+1500])
