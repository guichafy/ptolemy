/** Exercise the shipped launcher + executor with bundled Bun, outside the repository. */
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {extensionLauncherPaths} from "../src/bun/extensions/hooks";
const bundle=resolve(process.argv[2]??"build/dev-macos-arm64/ptolemy-dev.app");
const root=await mkdtemp(join(tmpdir(),"ptolemy-bundled-extension-")),cwd=join(root,"workspace");await mkdir(cwd);
try{
 const paths=extensionLauncherPaths(join(bundle,"Contents/MacOS/bun"));assert(paths.executable.startsWith(`${bundle}/`));assert(paths.launcher.startsWith(`${bundle}/`));
 const spec={cwd,root:cwd,data:cwd,event:"PreToolUse",timeout:5,command:`echo yes > inside; /bin/sh -c 'echo no > ../outside'; printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"}}'`};
 const child=Bun.spawn([paths.executable,paths.launcher,Buffer.from(JSON.stringify(spec)).toString("base64url")],{cwd,env:{PATH:"/usr/bin:/bin"},stdin:new Blob(['{"tool_name":"Bash"}']),stdout:"pipe",stderr:"pipe"});
 const output=await new Response(child.stdout).text();assert.equal(await child.exited,0);assert.equal(JSON.parse(output).hookSpecificOutput.permissionDecision,"deny");assert.equal(await readFile(join(cwd,"inside"),"utf8"),"yes\n");assert.equal(await readFile(join(root,"outside"),"utf8").catch(()=>null),null);
 const readonly=Bun.spawn([paths.executable,paths.launcher,Buffer.from(JSON.stringify({...spec,readOnly:true,command:"echo no > readonly-file"})).toString("base64url")],{cwd,env:{PATH:"/usr/bin:/bin"},stdin:new Blob(['{}']),stdout:"pipe",stderr:"pipe"});assert.equal(await readonly.exited,2);assert.equal(await readFile(join(cwd,"readonly-file"),"utf8").catch(()=>null),null);
 const cancellation=join(root,"cancel.mjs");
 await writeFile(cancellation,`
  import assert from "node:assert/strict";
  import {readFile} from "node:fs/promises";
  import {executeRestricted} from ${JSON.stringify(join(dirname(paths.launcher),"extension-executor.mjs"))};
  const cwd=${JSON.stringify(cwd)},controller=new AbortController();
  const running=executeRestricted({cwd,root:cwd,data:cwd,timeout:5,command:"echo started > started; (sleep .3; echo late > late) & wait"},"",controller.signal).catch(()=>null);
  const deadline=Date.now()+5000;
  while(!await readFile(cwd+"/started").then(()=>true,()=>false)){if(Date.now()>deadline)throw Error("Missing child marker");await Bun.sleep(1);}
  controller.abort();await running;await Bun.sleep(400);assert.equal(await readFile(cwd+"/late").catch(()=>null),null);
 `);
 const cancelled=Bun.spawn([paths.executable,cancellation],{cwd,env:{PATH:"/usr/bin:/bin"},stdout:"pipe",stderr:"pipe"});
 const cancellationError=await new Response(cancelled.stderr).text();assert.equal(await cancelled.exited,0,cancellationError);
 console.log(`Bundled extension launcher, executor and Bun verified: ${paths.launcher}`);
}finally{await rm(root,{recursive:true,force:true});}
