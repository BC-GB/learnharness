"""Scan immutable image code without starting it or attaching live volumes.

Only explicit code directories are copied. Tar members are read as data, never
extracted. This is code-artifact coverage, not an audit of the image's entire OS.
"""
import argparse, importlib.util, json, re, subprocess, tarfile, time, uuid
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--docker', required=True)
    p.add_argument('--image', required=True)
    p.add_argument('--code-path', required=True, choices=['/app', '/broker-code', '/native'])
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--tooling', type=Path, required=True)
    p.add_argument('--reference', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', a.image):
        raise ValueError('Exact local image ID required')
    a.out.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location('audit_scanner', Path(__file__).with_name('scan.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    audit = mod.Audit(argparse.Namespace(root=a.root, out=a.out, tooling=a.tooling, fetch_deps=False))
    known = {}
    for manifest in [a.reference/'files.jsonl', a.reference.parent/(a.reference.name+'-supplement')/'files.jsonl']:
        if not manifest.exists():
            continue
        with manifest.open() as stream:
            for line in stream:
                row = json.loads(line)
                known.setdefault(row['sha256'], []).append(row['path'])
    result = {'image': a.image, 'codePath': a.code_path, 'time': time.time(),
              'status': 'incomplete', 'startedImage': False, 'attachedLiveVolumes': False,
              'limits': 'Code-directory snapshot only. Hash equality is not a benignness verdict; generated bundles lack source provenance unless independently reproduced.'}
    name = 'lh-code-audit-'+uuid.uuid4().hex[:12]
    created = False
    relationships, links = [], []
    packaging_findings = set()
    archive_path = a.out/'code.tar'
    try:
        def docker(*args):
            return subprocess.run([a.docker, *args], check=True, capture_output=True, text=True, timeout=30).stdout.strip()
        actual = docker('image', 'inspect', a.image, '--format', '{{.Id}}')
        if actual != a.image:
            raise RuntimeError('Image identity mismatch')
        docker('create', '--name', name, '--pull', 'never', '--network', 'none', '--read-only',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--entrypoint', '/bin/false', a.image)
        created = True
        # Binary output to disk: PowerShell must not transcode the tar stream.
        with archive_path.open('wb') as output:
            proc = subprocess.Popen([a.docker, 'cp', name+':'+a.code_path, '-'], stdout=output, stderr=subprocess.PIPE)
            deadline = time.monotonic()+180
            try:
                while proc.poll() is None:
                    if time.monotonic()>deadline or archive_path.stat().st_size>4*1024**3:
                        raise RuntimeError('Image snapshot time/size bound exceeded')
                    time.sleep(.2)
                if proc.returncode:
                    raise RuntimeError('Docker code snapshot failed: '+proc.stderr.read(1000).decode(errors='replace'))
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=10)
        total = 0
        with tarfile.open(archive_path, 'r|') as archive:
            for number, member in enumerate(archive):
                if number>200000:
                    raise RuntimeError('Image member count bound exceeded')
                if member.isdir():
                    continue
                if member.name.startswith(('app/.git/', 'app/data/')):
                    packaging_findings.add('/'+('/'.join(member.name.split('/')[:2])))
                if member.issym() or member.islnk():
                    links.append({'path': member.name, 'target': member.linkname, 'type': 'symlink' if member.issym() else 'hardlink'})
                    continue
                if not member.isfile():
                    audit.error(member.name, 'Special member not scanned')
                    continue
                total += member.size
                if total>4*1024**3:
                    raise RuntimeError('Image expanded byte bound exceeded')
                if member.size>256*1024**2:
                    audit.error(member.name, 'Image file size bound exceeded')
                    continue
                body = archive.extractfile(member).read(256*1024**2+1)
                if len(body)!=member.size:
                    raise RuntimeError('Truncated image member')
                path = 'image/'+member.name
                digest = mod.sha(body)
                try:
                    audit.scan(path, body, 'deployed-image-code')
                except Exception as e:
                    audit.error(path, e)
                references = known.get(digest, [])
                relationships.append({'path': path, 'sha256': digest, 'matchingReferencePaths': references[:10],
                                      'referenceMatchCount': len(references), 'classification': 'byte-identical reference' if references else 'unmatched: review or generated artifact'})
        result.update(status='signature-scan-complete' if not audit.errors else 'incomplete', **audit.counts,
                      referenceMatched=sum(bool(x['referenceMatchCount']) for x in relationships),
                      unmatched=sum(not x['referenceMatchCount'] for x in relationships),
                      linksInventoried=len(links), rulesAndScannerHash=audit.identity,
                      unnecessaryEmbeddedPaths=sorted(packaging_findings))
    except Exception as e:
        result['error'] = str(e)[:500]
    finally:
        audit.manifest.close()
        if created:
            try:
                subprocess.run([a.docker, 'rm', '-v', name], check=True, capture_output=True, timeout=30)
            except Exception as e:
                result['cleanupError'] = str(e)[:500]
                result['status'] = 'incomplete'
        for filename, value in [('image-summary.json', result), ('matches.json', audit.rows), ('gaps.json', audit.errors),
                                ('reference-comparison.json', relationships), ('links.json', links)]:
            mod.save(a.out/filename, value)
    print(json.dumps(result))
    return 0 if result['status']=='signature-scan-complete' else 2


if __name__=='__main__':
    raise SystemExit(main())
