import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {publishWindowsRelease} from '../scripts/publish-windows-release.mjs';
const digest=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fixture=(t,{badUpload=false,latest='v1.3.68',authenticationError=false}={})=>{
 const directory=mkdtempSync(join(tmpdir(),'ularn-publish-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const bytes=Buffer.from('MZ verified portable test fixture');
 writeFileSync(join(directory,'Ularn.windows.exe'),bytes);
 writeFileSync(join(directory,'Ularn.windows.exe.sha256'),`${digest(bytes).slice(7)}  Ularn.windows.exe\n`);
 const calls=[];let release=null;
 const gh=args=>{
  calls.push(args);
  if(args[0]==='api'){
   if(authenticationError)return{status:1,stderr:'HTTP 401'};
   if(args[1].endsWith('/latest'))return{status:0,stdout:JSON.stringify({tag_name:latest})};
   return release?{status:0,stdout:JSON.stringify(release)}:{status:1,stderr:'HTTP 404'};
  }
  if(args[1]==='create')release={draft:true,assets:[]};
  if(args[1]==='upload')release.assets=args.slice(3,args.indexOf('--repo')).map(path=>{
   const bytes=readFileSync(path);return{name:path.split(/[\\/]/).at(-1),state:'uploaded',size:bytes.length,digest:badUpload?'sha256:wrong':digest(bytes)};
  });
  if(args[1]==='edit')release.draft=false;
  return{status:0,stdout:''};
 };
 return{directory,calls,gh,release:()=>release};
};
const publish=f=>publishWindowsRelease({...f,version:'1.3.69',target:'a'.repeat(40)});

test('a Windows release becomes latest only after all stable and versioned files are verified',t=>{
 const f=fixture(t);publish(f);
 const mutations=f.calls.filter(args=>args[0]==='release');
 assert.deepEqual(mutations.map(args=>args[1]),['create','upload','edit']);
 assert.ok(mutations[0].includes('--draft'));
 assert.ok(mutations[0].includes('a'.repeat(40)));
 assert.ok(mutations.at(-1).includes('--draft=false'));
 assert.ok(mutations.at(-1).includes('--latest=true'));
 assert.deepEqual(f.release().assets.map(asset=>asset.name),['Ularn.windows.exe','Ularn-1.3.69.windows.exe','Ularn.windows.exe.sha256','SHA256SUMS.txt']);
 const checksum=readFileSync(join(f.directory,'Ularn.windows.exe.sha256'),'utf8');
 assert.match(checksum,/^[a-f0-9]{64}  Ularn\.windows\.exe\n$/);
 const sums=readFileSync(join(f.directory,'SHA256SUMS.txt'),'utf8');
 assert.ok(sums.includes('  Ularn.windows.exe\n')&&sums.includes('  Ularn-1.3.69.windows.exe\n'));
});

test('an incomplete or corrupted upload stays a draft, preserving the previous download',t=>{
 const f=fixture(t,{badUpload:true});assert.throws(()=>publish(f),/stays a draft/);
 assert.equal(f.release().draft,true);assert.equal(f.calls.some(args=>args[1]==='edit'),false);
});

test('a local checksum failure stops before any GitHub operation',t=>{
 const f=fixture(t);writeFileSync(join(f.directory,'Ularn.windows.exe.sha256'),'0'.repeat(64));
 assert.throws(()=>publish(f),/verified checksum/);assert.equal(f.calls.length,0);
});

test('retries do not replace already published files',t=>{
 const f=fixture(t);publish(f);f.calls.length=0;
 assert.equal(publish(f).alreadyPublished,true);
 assert.equal(f.calls.some(args=>args[0]==='release'),false);
});

test('an older delayed build does not replace the latest release',t=>{
 const f=fixture(t,{latest:'v1.3.70'});publish(f);
 assert.ok(f.calls.find(args=>args[1]==='edit').includes('--latest=false'));
});

test('authentication failure does not create a release',t=>{
 const f=fixture(t,{authenticationError:true});assert.throws(()=>publish(f),/HTTP 401/);
 assert.equal(f.calls.some(args=>args[0]==='release'),false);
});
