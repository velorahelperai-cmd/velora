// SEC-001 release prerequisite for FLOW-001/STAGE-003; no providers or accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {isolatedEnvironment} from './safety.mjs';

test('resolved dependencies remove both known vulnerable implementations',async()=>{
 const lock=JSON.parse(await readFile(new URL('../../package-lock.json',import.meta.url),'utf8'));
 assert.equal(Object.keys(lock.packages).some(path=>/(?:^|\/)node_modules\/(?:braces|sprintf-js)$/.test(path)),false);
});

test('Next lint still discovers root directory globs and rejects internal HTML links',async()=>{
 const fixture=await mkdtemp(join(tmpdir(),'velora-lint-compat-'));
 try{
  const app=join(fixture,'apps','web');await mkdir(join(app,'pages'),{recursive:true});await writeFile(join(app,'pages','about.js'),'export default function Page(){return null;}');
  const require=createRequire(import.meta.url),plugin=require('@next/eslint-plugin-next');
  const {getRootDirs}=require('@next/eslint-plugin-next/dist/utils/get-root-dirs.js');
  const pattern=join(fixture,'apps','*');
  assert.deepEqual(getRootDirs({cwd:fixture,settings:{next:{rootDir:pattern}}}).map(path=>resolve(path)),[resolve(app)]);
  assert.deepEqual(getRootDirs({cwd:fixture,settings:{next:{rootDir:[pattern,join(fixture,'missing','*')]}}}).map(path=>resolve(path)),[resolve(app)]);
  const {ESLint}=await import('eslint');
  const eslint=new ESLint({cwd:fixture,overrideConfigFile:true,overrideConfig:[{files:['**/*.jsx'],languageOptions:{parserOptions:{ecmaFeatures:{jsx:true}}},plugins:{'@next/next':plugin},settings:{next:{rootDir:pattern}},rules:{'@next/next/no-html-link-for-pages':'error'}}]});
  const [result]=await eslint.lintText('export default function Link(){return <a href="/about">About</a>}',{filePath:join(app,'link.jsx')});
  assert.ok(result.messages.some(message=>message.ruleId==='@next/next/no-html-link-for-pages'));
 }finally{assert.equal(resolve(fixture,'..'),resolve(tmpdir()));await rm(fixture,{recursive:true,force:true});}
});

test('Mammoth library and legacy CLI both retain real DOCX extraction',async()=>{
 const fixture=await mkdtemp(join(tmpdir(),'velora-docx-compat-'));
 try{
  const require=createRequire(import.meta.url),JSZip=require('jszip'),mammoth=require('mammoth');
  const zip=new JSZip(),text='Synthetic approved menu 1.8 OMR';
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  const buffer=await zip.generateAsync({type:'nodebuffer'}),path=join(fixture,'menu.docx');await writeFile(path,buffer);
  assert.ok((await mammoth.extractRawText({buffer})).value.includes(text));
  const cwd=resolve(import.meta.dirname,'../..'),env={...isolatedEnvironment(),NODE_OPTIONS:'--require=./scripts/ci/offline-network-guard.cjs'};
  const cli=spawnSync(process.execPath,[require.resolve('mammoth/bin/mammoth'),path],{cwd,env,encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(cli.status,0,cli.stderr);assert.ok(cli.stdout.includes(text));
 }finally{assert.equal(resolve(fixture,'..'),resolve(tmpdir()));await rm(fixture,{recursive:true,force:true});}
});

test('patched lint glob consumers remain callable and reject disallowed imports',async()=>{
 const require=createRequire(import.meta.url);
 const {Linter}=require('eslint');
 const linter=new Linter();
 const rules={
  'import/extensions':['error',{ignorePackages:true,pathGroupOverrides:[{pattern:'**/*.js',action:'enforce'}]}],
  'import/no-internal-modules':['error',{forbid:['foo/**']}],
  'import/no-restricted-paths':['error',{zones:[{target:'./src/**',from:'./private/**'}]}],
  'react/jsx-pascal-case':['error',{ignore:['Other*']}],
  'jsx-a11y/label-has-associated-control':['error',{controlComponents:['Custom*']}],
 };
 const config={files:['**/*.jsx'],languageOptions:{ecmaVersion:2022,sourceType:'module',parserOptions:{ecmaFeatures:{jsx:true}}},plugins:{import:require('eslint-plugin-import'),react:require('eslint-plugin-react'),'jsx-a11y':require('eslint-plugin-jsx-a11y')},rules};
 const text="import x from 'foo/private';\nimport y from './module.js';\nconst A=()=> <><Bad_name/><label><CustomInput /></label></>;";
 const messages=linter.verify(text,config,{filename:resolve('src/test.jsx')});
 assert.deepEqual(messages.map(({ruleId})=>ruleId),['import/no-internal-modules','import/extensions','react/jsx-pascal-case','jsx-a11y/label-has-associated-control']);
});
