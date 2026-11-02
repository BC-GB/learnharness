"""Compare installed npm bytes with the correct package/version/archive path.

Consumes read-only manifests; content matching another package is insufficient.
"""
import argparse,json
from pathlib import Path


def add_reference(reference,row):
    label=row.get('package');prefix='npm/'+str(label)+'/'
    if not row['path'].startswith(prefix):return
    member=row['path'][len(prefix):]
    if '/' not in member:return
    # npm strips the first tar directory. DefinitelyTyped archives often use
    # the library name rather than "package" for that directory.
    normalized=prefix+'package/'+member.split('/',1)[1]
    digest=row['sha256']
    if normalized in reference and reference[normalized]!=digest:reference[normalized]=None
    else:reference[normalized]=digest


def compare(lock, installed, reference):
    checked=0;generated=[];differences=[]
    for row in installed:
        prefix='image/app/node_modules/'
        if not row['path'].startswith(prefix):continue
        path=row['path'].removeprefix('image/app/')
        if path=='node_modules/.package-lock.json':
            generated.append(path);continue
        owner=path.rsplit('/',1)[0]
        while owner and not lock.get(owner,{}).get('resolved'):
            owner=owner.rsplit('/',1)[0] if '/' in owner else ''
        entry=lock.get(owner)
        if not entry:
            differences.append({'path':path,'reason':'No archived lockfile owner'});continue
        label=(entry.get('name') or owner.split('node_modules/')[-1])+'@'+str(entry.get('version'))
        expected='npm/'+label+'/package/'+path[len(owner)+1:]
        if reference.get(expected)!=row['sha256']:
            differences.append({'path':path,'expectedReference':expected,'reason':'Missing reference or changed bytes'})
        else:checked+=1
    return {'byteIdenticalAtExpectedPackagePath':checked,'generatedMetadata':generated,
            'differences':differences,'passed':not differences and checked>0,
            'limits':'Regular installed npm files only; native behavior and image OS packages are not established by hash equality.'}


def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True)
    p.add_argument('--image-run',type=Path,required=True);p.add_argument('--reference',type=Path,required=True)
    a=p.parse_args();reference={}
    for manifest in [a.reference/'files.jsonl',a.reference.parent/(a.reference.name+'-supplement')/'files.jsonl']:
        if manifest.exists():
            for line in manifest.open():
                add_reference(reference,json.loads(line))
    lock=json.loads((a.root/'package-lock.json').read_text())['packages']
    result=compare(lock,map(json.loads,(a.image_run/'files.jsonl').read_text().splitlines()),reference)
    (a.image_run/'installed-dependencies.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({**result,'differences':len(result['differences'])}))
    return 0 if result['passed'] else 2


if __name__=='__main__':raise SystemExit(main())
