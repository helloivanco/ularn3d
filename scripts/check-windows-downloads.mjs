import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOWNLOAD_PATH } from './app-version.mjs';
import { selectWindowsAsset } from '../api/windows-download.js';

export async function checkWindowsDownloads(release, fetcher = fetch, origin = 'https://ularn-3d.vercel.app') {
  const executable=selectWindowsAsset(release), filename=executable.name;
  const checksum=await fetcher(`${origin}/downloads/SHA256SUMS.txt`,{signal:AbortSignal.timeout(15000)});
  if(!checksum.ok||!(await checksum.text()).trim().split(/\r?\n/).includes(`${executable.digest.slice(7)}  ${filename}`))
    throw new Error('The public checksum link does not match the published Windows executable.');
  const response=await fetcher(`${origin}${DOWNLOAD_PATH}`,{headers:{Range:'bytes=0-1'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('The public Windows download link failed.');
  if(!response.headers.get('content-disposition')?.includes(filename))
    throw new Error('The public Windows download filename does not include its release version.');
  if(!response.body)throw new Error('The public download returned no executable.');
  const reader=response.body.getReader(),header=[];
  while(header.length<2){const chunk=await reader.read();if(chunk.done)break;for(const byte of chunk.value){header.push(byte);if(header.length===2)break;}}
  await reader.cancel();
  if(header[0]!==77||header[1]!==90)throw new Error('The public download returned a page instead of a Windows executable.');
  return release.tag_name;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let lastError;
  // Positive download redirects can be cached for five minutes. Give the new
  // published release time to replace the previous complete build at the CDN.
  for(let attempt=0;attempt<25;attempt++) {
    try {
      const result=spawnSync('gh',['api','repos/helloivanco/ularn3d/releases/latest'],{encoding:'utf8'});
      if(result.status!==0)throw new Error(result.stderr||'Could not read the latest release.');
      const tag=await checkWindowsDownloads(JSON.parse(result.stdout));
      console.log(`Verified public Windows download and matching checksum: ${tag}`);lastError=null;break;
    }catch(error){lastError=error;if(attempt<24)await new Promise(resolve=>setTimeout(resolve,15000));}
  }
  if(lastError)throw lastError;
}
