"""Classify working changes against the live-verified main without accepting old trees."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile
from preserve import ROOT, git, sensitive

OUT=ROOT/'.git/velora-consolidation-20261022'
MAIN='8597fb9848bb33e8cecb6859ff9489b4cdc408ec'

def tree(ref):
    result={}
    for entry in git(ROOT,'ls-tree','-rz','--full-tree',ref).split(b'\0'):
        if entry:
            meta,name=entry.split(b'\t',1)
            result[name.decode()]=meta.split()[2].decode()
    return result

def blob_hash(data):
    return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()

def main():
    baseline=tree(MAIN)
    receipt=json.loads((OUT/'preservation.json').read_text())
    result=[]
    with zipfile.ZipFile(OUT/'working-changes.zip') as z:
        secret_names=[n for n in z.namelist() if '/files/' in n and sensitive(n.split('/files/',1)[1])]
        assert not secret_names, 'Sensitive filenames in archive; stop and inspect names only'
        for n,w in enumerate(receipt['worktrees']):
            if w.get('missing'): continue
            head=tree(w['head'])
            rows=[]
            for r in w['files']:
                p=r['path']
                if r.get('preservation')!='ARCHIVED':
                    classification=r['preservation']
                    blob=None
                else:
                    data=z.read(f'worktree-{n:02d}/files/{p}')
                    # Git normalizes CRLF for tracked text; hash-object applies repository attributes.
                    blob=subprocess.check_output(['git','hash-object','--path',p,'--stdin'],cwd=w['root'],input=data,stderr=subprocess.PIPE).decode().strip()
                    classification='MATCHES_MAIN' if blob==baseline.get(p) else 'OLDER_HEAD_COPY' if blob==head.get(p) else 'UNIQUE_LOCAL_DELTA'
                rows.append({**r,'classification':classification,'blob':blob,'mainBlob':baseline.get(p),'headBlob':head.get(p)})
            counts={c:sum(r['classification']==c for r in rows) for c in sorted({r['classification'] for r in rows})}
            result.append({'root':w['root'],'head':w['head'],'branch':w['branch'],'counts':counts,'files':rows})
    (OUT/'inventory.json').write_text(json.dumps({'main':MAIN,'worktrees':result},indent=2),encoding='utf-8')
    print(json.dumps([{'root':w['root'],'counts':w['counts']} for w in result if w['files']],indent=2))

if __name__=='__main__': main()
