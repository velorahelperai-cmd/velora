"""Merge preserved deltas into Git objects; conflicts stay outside the application."""
import json
from pathlib import Path
import subprocess
import zipfile
from inventory import OUT, MAIN, tree, blob_hash
from preserve import ROOT, git

def data(oid):
    return git(ROOT,'cat-file','blob',oid) if oid else b''

def put(content):
    return subprocess.check_output(['git','hash-object','-w','--stdin'],cwd=ROOT,input=content).decode().strip()

def main():
    subprocess.run(['node','scripts/consolidation/guard.mjs'],cwd=ROOT,check=True)
    inventory=json.loads((OUT/'inventory.json').read_text(encoding='utf-8'))
    pr=json.loads((OUT/'pr8-tree.json').read_text(encoding='utf-8'))
    target=tree(pr['tree'])
    main_tree=tree(MAIN)
    remote_paths={r['filename'] for r in json.loads((OUT/'pr8-patches.json').read_text(encoding='utf-8'))['patches']}
    review_base=tree('204d7a07efb4857cd81897b8e4f72ace76c1e4b8')
    decisions=[]
    conflicts=[]
    archive=zipfile.ZipFile(OUT/'working-changes.zip')
    for worktree_number,w in enumerate(inventory['worktrees']):
        canonical=w['root']==str(ROOT)
        release=w['root'].endswith('task\\release-clean')
        if not canonical and not release:continue
        head=tree(w['head'])
        for r in w['files']:
            p=r['path']
            if r['classification']!='UNIQUE_LOCAL_DELTA':continue
            include=p.startswith('src/') or p.startswith('supabase/migrations/') or p in ['scripts/integration/paymob-owned-next-native.optin.mjs','docs/es02-branch-hours-contract.md']
            reason=None
            if not include:reason='PRESERVED_ARTIFACT_DOC_MEDIA_OR_TOOL_NOT_PRODUCT_DELTA'
            elif canonical and p!='src/components/app/account-logout.test.tsx':reason='PRESERVED_SUPERSEDED_MAIN_FIXTURE_OR_UNFINISHED_LOGGING'
            elif canonical and p in remote_paths:reason='SUPERSEDED_BY_REVIEWED_PR8'
            elif release and p in remote_paths and p not in ['src/lib/answers/runtime/admin-actions.ts','src/lib/answers/runtime/admin-monthly-action.test.ts']:reason='SUPERSEDED_BY_REVIEWED_PR8'
            elif p=='src/lib/customer/service-inbox-actions.ts':reason='PARKED_UNFINISHED_INBOX_LOGGING'
            elif release and p in ['src/components/app/account-chrome.tsx','src/components/app/account-session-response.test.tsx','src/components/app/prepayment-preparation.tsx']:reason='PRESERVE_NEWER_PUBLISHED_LOGIN_AND_LOADING_UI'
            if reason:
                decisions.append({'source':w['root'],'path':p,'decision':reason})
                continue
            archived=archive.read(f"worktree-{worktree_number:02d}/files/{p}")
            incoming=subprocess.check_output(['git','hash-object','-w','--path',p,'--stdin'],cwd=w['root'],input=archived,stderr=subprocess.PIPE).decode().strip()
            assert incoming==r['blob'], 'Preserved content hash mismatch'
            ours=target.get(p)
            base=(review_base if release and p in remote_paths else head).get(p)
            theirs=r['blob']
            if ours==theirs:decision='ALREADY_INCLUDED'
            elif theirs==base:decision='OLD_UNCHANGED_COPY'
            elif ours==base or ours is None:
                target[p]=theirs
                decision='APPLY_UNIQUE_DELTA'
            else:
                # Exact base-aware merge; never copy an old complete file over newer fixes.
                paths=[OUT/'merge-current',OUT/'merge-base',OUT/'merge-incoming']
                for f,oid in zip(paths,[ours,base,theirs]):f.write_bytes(data(oid))
                result=subprocess.run(['git','merge-file','-p',*map(str,paths)],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                if result.returncode==0:
                    target[p]=put(result.stdout)
                    decision='THREE_WAY_MERGE'
                else:
                    conflict_path=OUT/'conflicts'/p
                    conflict_path.parent.mkdir(parents=True,exist_ok=True)
                    conflict_path.write_bytes(result.stdout)
                    conflicts.append({'path':p,'source':w['root'],'base':base,'ours':ours,'theirs':theirs,'artifact':str(conflict_path)})
                    decision='NEEDS_SEMANTIC_RESOLUTION'
            decisions.append({'source':w['root'],'path':p,'decision':decision})
    (OUT/'merge-plan.json').write_text(json.dumps({'base':MAIN,'pr8':pr,'target':target,'decisions':decisions,'conflicts':conflicts},indent=2),encoding='utf-8')
    counts={k:sum(r['decision']==k for r in decisions) for k in {r['decision'] for r in decisions}}
    print(json.dumps({'counts':counts,'conflicts':[r['path'] for r in conflicts]},indent=2))

if __name__=='__main__':main()
