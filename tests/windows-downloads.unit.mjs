import test from 'node:test';
import assert from 'node:assert/strict';
import {checkWindowsDownloads} from '../scripts/check-windows-downloads.mjs';
const hash='a'.repeat(64),release={tag_name:'v1.3.69',draft:false,prerelease:false,assets:[{name:'Ularn.windows.exe',digest:`sha256:${hash}`},{name:'Ularn.windows.exe.sha256'}]};
const requests=[];
const server=({checksum=`${hash}  Ularn.windows.exe\n`,exe='MZ',status=200}={})=>async(url,options)=>{
 requests.push({url,options});
 return url.endsWith('.txt')?new Response(checksum):new Response(exe,{status});
};
test('both public links serve the published executable and its matching checksum',async()=>{
 requests.length=0;
 assert.equal(await checkWindowsDownloads(release,server()),'v1.3.69');
 assert.deepEqual(requests.map(r=>r.url),['https://ularn-3d.vercel.app/downloads/SHA256SUMS.txt','https://ularn-3d.vercel.app/downloads/Ularn.windows.exe']);
 assert.equal(requests[1].options.headers.Range,'bytes=0-1');
});
test('a missing or wrong checksum is detected',async()=>{
 await assert.rejects(checkWindowsDownloads(release,server({checksum:'Not found'})),/checksum link/);
});
test('a download that returns HTML or a 404 is detected',async()=>{
 await assert.rejects(checkWindowsDownloads(release,server({exe:'<html>error</html>'})),/instead of a Windows/);
 await assert.rejects(checkWindowsDownloads(release,server({status:404})),/download link failed/);
});
test('an incomplete or draft release cannot pass the public link check',async()=>{
 await assert.rejects(checkWindowsDownloads({...release,draft:true},server()),/latest release is missing/);
 await assert.rejects(checkWindowsDownloads({...release,assets:[]},server()),/latest release is missing/);
});
test('the executable header can arrive in separate network chunks',async()=>{
 const fetcher=async url=>url.endsWith('.txt')?new Response(`${hash}  Ularn.windows.exe\n`):
  new Response(new ReadableStream({start(controller){controller.enqueue(Uint8Array.of(77));controller.enqueue(Uint8Array.of(90));controller.close();}}));
 assert.equal(await checkWindowsDownloads(release,fetcher),'v1.3.69');
});
