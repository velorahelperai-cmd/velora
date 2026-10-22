"""Prepare merge objects in Git's object database, without a second working copy."""
import json
import os
from pathlib import Path
import subprocess
from preserve import ROOT, git
from inventory import OUT, MAIN, tree

def run(args, **kwargs):
    return subprocess.run(['git',*args],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,**kwargs)

def main():
    run(['status','--porcelain'])
    run(['rev-parse','--show-toplevel'])
    subprocess.run(['node','scripts/consolidation/guard.mjs'],cwd=ROOT,check=True)
    pr=json.loads((OUT/'pr8-patches.json').read_text(encoding='utf-8'))
    base=tree(MAIN)
    chunks=[]
    for row in pr['patches']:
        p=row['filename']
        assert row['patch'], f'Missing remote patch: {p}'
        chunks.append(f'diff --git a/{p} b/{p}\n'+('new file mode 100644\n' if p not in base else '')+f'--- {"a/"+p if p in base else "/dev/null"}\n+++ b/{p}\n'+row['patch'].rstrip('\n')+'\n')
    patch=OUT/'pr8.patch'
    patch.write_text(''.join(chunks),encoding='utf-8',newline='\n')
    index=OUT/'pr8.index'
    assert not index.exists(),'Do not overwrite a prepared index'
    env={**os.environ,'GIT_INDEX_FILE':str(index)}
    run(['read-tree',MAIN],env=env)
    run(['apply','--cached','--check','--whitespace=nowarn',str(patch)],env=env)
    run(['apply','--cached','--whitespace=nowarn',str(patch)],env=env)
    candidate=run(['write-tree'],env=env).stdout.decode().strip()
    (OUT/'pr8-tree.json').write_text(json.dumps({'base':MAIN,'head':pr['head'],'tree':candidate,'paths':len(pr['patches']),'method':'Git index only; no second working tree'},indent=2))
    print(json.dumps({'tree':candidate,'paths':len(pr['patches'])}))

if __name__=='__main__':main()
