"""Produce bounded source context for human review; never execute target code."""
import argparse, base64, hashlib, io, json, tarfile
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--run', type=Path, required=True)
    p.add_argument('--rule', action='append', default=[])
    p.add_argument('--package')
    p.add_argument('--limit', type=int, default=20)
    a = p.parse_args()
    root = a.root.resolve()
    groups = {}
    for path, entry in json.loads((root/'package-lock.json').read_text())['packages'].items():
        if path and entry.get('resolved'):
            label = (entry.get('name') or path.split('node_modules/')[-1])+'@'+str(entry.get('version'))
            groups[label] = entry
    rows = json.loads((a.run/'review-queue.json').read_text())
    selected = [x for x in rows if (not a.package or x['package']==a.package) and
                (not a.rule or any(m['rule'] in a.rule for m in x['matches']))][:a.limit]
    for row in selected:
        try:
            if row['package']=='first-party':
                path = (root/row['path'].removeprefix('source/')).resolve()
                if not path.is_relative_to(root) or path.stat().st_size>64*1024**2:
                    raise ValueError('Unsafe source path or size')
                body = path.read_bytes()
            else:
                entry = groups[row['package']]
                archive_path = a.run.parent/'cache/archives'/(hashlib.sha256(entry['resolved'].encode()).hexdigest()+'.tgz')
                if archive_path.stat().st_size>256*1024**2:
                    raise ValueError('Archive too large')
                data = archive_path.read_bytes()
                token = next(x for x in entry['integrity'].split() if x.startswith(('sha512-', 'sha256-')))
                algorithm, expected = token.split('-', 1)
                if base64.b64encode(hashlib.new(algorithm, data).digest()).decode()!=expected:
                    raise ValueError('Archive integrity mismatch')
                member_path = row['path'].removeprefix('npm/'+row['package']+'/')
                with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as t:
                    member = t.getmember(member_path)
                    if not member.isfile() or member.size>64*1024**2:
                        raise ValueError('Unsupported member type or size')
                    body = t.extractfile(member).read(64*1024**2+1)
            if hashlib.sha256(body).hexdigest()!=row['sha256']:
                raise ValueError('Review source differs from scanned hash')
            contexts = []
            for match in row['matches']:
                if a.rule and match['rule'] not in a.rule:
                    continue
                for location in match['locations']:
                    offset = location['offset']
                    contexts.append({'rule': match['rule'], 'line': location['line'],
                                     'context': body[max(0, offset-180):offset+500].decode('utf-8', errors='replace')})
            print(json.dumps({'path': row['path'], 'sha256': row['sha256'], 'contexts': contexts}))
        except Exception as e:
            print(json.dumps({'path': row['path'], 'reviewError': str(e)}))


if __name__=='__main__':
    main()
