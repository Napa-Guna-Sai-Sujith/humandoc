import urllib.request, json
req = urllib.request.Request('https://api.github.com/repos/Napa-Guna-Sai-Sujith/humandoc/actions/runs?per_page=5', headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        for r in data.get('workflow_runs', []):
            commit = r.get('head_commit', {})
            cid = commit.get('id', '')[:7]
            msg = commit.get('message', '').split('\n')[0][:40]
            print(f"{r['id']} | {cid} | {msg} | {r['status']} | {r['conclusion']}")
except Exception as e:
    print('Error:', e)
