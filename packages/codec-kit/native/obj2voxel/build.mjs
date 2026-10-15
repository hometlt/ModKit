/** Build the A2 offline candidate from manifest-verified bytes; no Git, fetch or caller job input.
 * Requires an installed Emscripten 6.0.10 SDK with its system cache already populated.
 * This staging script is not a codec-kit runtime entrypoint or a production build registration.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync} from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const provenance=JSON.parse(readFileSync(join(root,'PROVENANCE.json'),'utf8'));
const packageRoot=resolve(root,'../..');
for(const entry of provenance.files) assert.equal(sha(readFileSync(join(packageRoot,entry.path))),entry.sha256,'source drift: '+entry.path);
const listed=new Set(provenance.files.map(entry=>entry.path));
/** Reject extra headers/TUs and symlinks, not merely missing or changed listed files. */
function checkTree(directory,relative) {
 for(const name of readdirSync(directory)) {
  const path=join(directory,name),key=relative+'/'+name,stat=lstatSync(path);
  assert(!stat.isSymbolicLink(),'unlisted symlink '+key);
  if(stat.isDirectory())checkTree(path,key);
  else assert(listed.has(key),'unlisted upstream build input '+key);
 }
}
checkTree(join(root,'upstream'),'native/obj2voxel/upstream');
const em=process.env.MODKIT_EMXX??'C:/Apps/emsdk/upstream/emscripten/em++.exe';
const version=execFileSync(em,['--version'],{encoding:'utf8'});
assert(version.includes('6.0.10 (d6c521a7f05449857c76bd99e396895583cf2083)'), 'compiler pin mismatch');
const upstream=join(root,'upstream/obj2voxel'),output=resolve(process.argv[2]??join(root,'build'));
mkdirSync(output,{recursive:true});mkdirSync(join(output,'tmp'),{recursive:true});
const env={...process.env,EM_FROZEN_CACHE:'1',TMP:join(output,'tmp'),TEMP:join(output,'tmp'),TMPDIR:join(output,'tmp')};
const source=[join(root,'modkit_voxel.cpp'),...['voxelization.cpp','io.cpp','obj2voxel.cpp'].map(name=>join(upstream,'src',name))];
for(const folder of ['voxelio/src','voxelio/src/format','voxelio/src/3rd_party']) {
 const prefix='native/obj2voxel/upstream/obj2voxel/'+folder+'/';
 for(const entry of provenance.files.filter(entry=>entry.compiledTranslationUnit&&entry.path.startsWith(prefix)&&!entry.path.slice(prefix.length).includes('/')).sort((a,b)=>a.path.localeCompare(b.path)))source.push(join(packageRoot,entry.path));
}
assert.equal(source.length,33);
const flags=['-I'+join(upstream,'include'),'-I'+join(upstream,'voxelio/include'),'-std=c++17','-O2','-DVXIO_RELEASE','-DNDEBUG','-fexceptions','-include','ios','-ffile-prefix-map='+root+'=/modkit/native/obj2voxel','-fdebug-prefix-map='+root+'=/modkit/native/obj2voxel'];
const commands=[];
/** Execute only the pinned compiler; failure is fatal, never an EXE/network fallback. */
function run(args) {
 commands.push(args);
 const result=spawnSync(em,args,{cwd:root,env,encoding:'utf8',maxBuffer:16*1024**2});
 if(result.error)throw result.error;
 if(result.status!==0){process.stderr.write(result.stderr??'');throw Error('Emscripten failed: '+result.status);}
}
for(const [i,path] of source.entries()) {console.log('compile '+(i+1)+'/33');run([...flags,'-c',path,'-o',join(output,i+'.o')]);}
const linkFlags=['-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=web,worker','-sFILESYSTEM=0','-sDYNAMIC_EXECUTION=0','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=33554432','-sMAXIMUM_MEMORY=134217728','-sSTACK_SIZE=1048576','-sABORTING_MALLOC=1','-sEXPORTED_FUNCTIONS=["_malloc","_free","_proof_run","_proof_output","_proof_count"]','-sEXPORTED_RUNTIME_METHODS=["HEAPU8","HEAPF32","HEAPU32"]'];
run([...source.map((_,i)=>join(output,i+'.o')),...flags,...linkFlags,'-o',join(output,'obj2voxel.mjs')]);
const glue=readFileSync(join(output,'obj2voxel.mjs'),'utf8');
assert(!glue.includes('node:')&&!glue.includes('require('),'Node loader residue');
const hashes=Object.fromEntries(['obj2voxel.mjs','obj2voxel.wasm'].map(name=>[name,sha(readFileSync(join(output,name)))]));
writeFileSync(join(output,'build-result.json'),JSON.stringify({scope:'A2 source-offline candidate, not production acceptance',compiler:version,compilerExecutableSha256:sha(readFileSync(em)),flags,linkFlags,commands,sourceCount:source.length,builderHasNoGitOrFetchCommands:true,networkIsolationVerified:false,installedSdkFullyHashPinned:false,frozenSdkCache:true,hashes},null,2)+'\n');
console.log(JSON.stringify(hashes,null,2));
