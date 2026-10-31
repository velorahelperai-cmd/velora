// Apply reviewed lint dependency compatibility patches without running package lifecycle scripts.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const patches=['eslint-plugin-import+2.32.0.patch','eslint-plugin-react+7.37.5.patch','eslint-plugin-jsx-a11y+6.10.2.patch'];
for(const name of patches){
 const patch=resolve(root,'patches',name);
 const git=(args)=>spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});
 if(git(['apply','--check',patch]).status===0){const result=git(['apply',patch]);if(result.status!==0)throw Error(`Could not apply ${name}: ${result.stderr}`);}
 else if(git(['apply','--reverse','--check',patch]).status!==0)throw Error(`Cannot apply or verify ${name}; dependency contents may have changed`);
}
