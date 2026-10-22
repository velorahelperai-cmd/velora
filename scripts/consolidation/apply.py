"""Materialize the reviewed merge in the canonical working directory only."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from inventory import OUT, MAIN, tree
from preserve import ROOT, BRANCH, git, sensitive

def main():
    subprocess.run(['node','scripts/consolidation/guard.mjs'],cwd=ROOT,check=True)
    plan=json.loads((OUT/'merge-plan.json').read_text(encoding='utf-8'))
    assert not plan['conflicts'],'Unresolved merge conflicts'
    assert not (OUT/'application.json').exists(),'Already applied; do not repeat'
    old_head=git(ROOT,'rev-parse','HEAD').decode().strip()
    assert old_head=='5a6d2e4d007202f9bd99b260889c078382a0767b'
    if not (OUT/'original.index').exists():
        shutil.copy2(ROOT/'.git/index',OUT/'original.index')
    before={}
    written=[]
    parked=[]
    target=plan['target']
    # Governance and current shared Brain remain the freshly edited canonical files.
    protected={'AGENTS.md','PROJECT_STATE.md','GEMINI.md'}
    for name,oid in target.items():
        if sensitive(name) or name in protected:continue
        p=ROOT/name
        assert p.resolve().is_relative_to(ROOT.resolve()),'Path escape'
        if p.is_file():
            current=p.read_bytes()
            variants=[current,current.replace(b'\r\n',b'\n')]
            if any(hashlib.sha1(b'blob '+str(len(v)).encode()+b'\0'+v).hexdigest()==oid for v in variants):continue
        content=git(ROOT,'cat-file','blob',oid)
        before[name]=hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
        p.parent.mkdir(parents=True,exist_ok=True)
        p.write_bytes(content)
        written.append(name)
    # Park only source paths absent from the reviewed target; keep them recoverable.
    for p in (ROOT/'src').rglob('*'):
        if not p.is_file():continue
        name=p.relative_to(ROOT).as_posix()
        if name not in target:
            destination=OUT/'parked-source'/name
            destination.parent.mkdir(parents=True,exist_ok=True)
            assert not destination.exists(),'Park destination exists'
            shutil.move(str(p),str(destination))
            parked.append(name)
    # Advance the SAME existing development ref with CAS; preserve working files.
    # The old tip remains in original.index, preservation refs.txt and Git reflog.
    subprocess.run(['git','update-ref','-m','Velora canonical consolidation onto verified main',f'refs/heads/{BRANCH}',MAIN,old_head],cwd=ROOT,check=True)
    subprocess.run(['git','read-tree',MAIN],cwd=ROOT,check=True)
    receipt={'oldHead':old_head,'newBase':MAIN,'branch':BRANCH,'written':written,'parkedSource':parked,'beforeHashes':before,'secretsTouched':False,'commitPushDeploy':False}
    (OUT/'application.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps({'base':MAIN,'written':len(written),'parkedSource':parked,'branch':BRANCH}))

if __name__=='__main__':main()
