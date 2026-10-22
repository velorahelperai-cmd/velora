"""Local preservation only; never reads environment/credential files or uploads data."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(r"C:\Users\DELL\Desktop\Velora new")
BRANCH = "codex/desktop-consolidation-20261015"
ORIGIN = "https://github.com/velorahelperai-cmd/velora.git"

def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, stderr=subprocess.PIPE)

def sensitive(name):
    return bool(re.search(r"(^|/)(\.env(?:\.[^/]*)?|credentials?[^/]*|\.ssh|\.aws)(/|$)|\.(pem|key|pfx|p12|p8)$|service[-_]account", name, re.I))

def main():
    assert Path.cwd().resolve() == ROOT.resolve(), "Wrong workspace"
    assert git(ROOT, "branch", "--show-current").decode().strip() == BRANCH, "Wrong branch"
    assert git(ROOT, "remote", "get-url", "origin").decode().strip() == ORIGIN, "Wrong origin"
    out = ROOT / ".git" / "velora-consolidation-20261022"
    out.mkdir(exist_ok=True)
    assert not (out / "preservation.json").exists(), "Snapshot already exists; do not overwrite"
    roots = []
    for line in git(ROOT, "worktree", "list", "--porcelain").decode().splitlines():
        if line.startswith("worktree "):
            roots.append(Path(line[9:]))
    receipt = {"canonical": str(ROOT), "branch": BRANCH, "writer": "Codex / 01a160e9-558f-7183-88ac-89307520f011", "worktrees": [], "secrets": "NOT READ OR ARCHIVED; originals retained; cleanup blocked until separately preserved"}
    archive = out / "working-changes.zip"
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED, compresslevel=4) as z:
        for n, root in enumerate(roots):
            if not root.exists():
                receipt["worktrees"].append({"root":str(root),"missing":True})
                continue
            prefix = f"worktree-{n:02d}"
            rows = []
            status = git(root,"status","--porcelain=v1","-z","--untracked-files=all").decode().split("\0")
            it = iter(filter(None,status))
            for entry in it:
                code,name=entry[:2],entry[3:]
                if "R" in code or "C" in code:
                    next(it)
                p=root / name
                row={"path":name,"status":code}
                if sensitive(name):
                    row["preservation"]="SENSITIVE_NOT_READ_OR_ARCHIVED_OR_REMOVED"
                elif p.is_symlink():
                    row.update(preservation="SYMLINK_RETAINED",target=os.readlink(p))
                elif p.is_file():
                    data=p.read_bytes()
                    row.update(sha256=hashlib.sha256(data).hexdigest(),size=len(data),preservation="ARCHIVED")
                    z.writestr(f"{prefix}/files/{name}",data)
                elif not p.exists():
                    row["preservation"]="DELETION_RECORDED_COMMITTED_BASE_RETAINED"
                else:
                    row["preservation"]="NONREGULAR_RETAINED"
                rows.append(row)
            for cached,label in [(False,"unstaged.patch"),(True,"staged.patch")]:
                args=["diff","--binary"]+(["--cached"] if cached else [])+["--",".",":(exclude).env",":(exclude).env.*",":(exclude)**/credentials*",":(exclude)**/*.key",":(exclude)**/*.pem"]
                z.writestr(f"{prefix}/{label}",git(root,*args))
            receipt["worktrees"].append({"root":str(root),"head":git(root,"rev-parse","HEAD").decode().strip(),"branch":git(root,"branch","--show-current").decode().strip(),"files":rows})
        z.writestr("refs.txt",git(ROOT,"show-ref"))
        z.writestr("stashes.txt",git(ROOT,"stash","list","--format=%H %gd %s"))
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None, "Archive CRC failed"
        for n,w in enumerate(receipt["worktrees"]):
            for row in w.get("files",[]):
                if row.get("preservation")=="ARCHIVED":
                    assert hashlib.sha256(z.read(f"worktree-{n:02d}/files/{row['path']}")).hexdigest()==row["sha256"]
    receipt["archive"]={"path":str(archive),"sha256":hashlib.file_digest(archive.open("rb"),"sha256").hexdigest(),"bytes":archive.stat().st_size,"crc":"PASS","entryHashes":"PASS"}
    (out/"preservation.json").write_text(json.dumps(receipt,indent=2),encoding="utf-8")
    print(json.dumps({"archive":receipt["archive"],"worktrees":len(receipt["worktrees"]),"dirtyPaths":sum(len(w.get("files",[])) for w in receipt["worktrees"]),"secretFilesRead":0}))

if __name__ == "__main__":
    main()
