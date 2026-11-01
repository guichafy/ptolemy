/** Exercise the shipped launcher + executor with bundled Bun, outside the repository. */
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {extensionLauncherPaths} from "../src/bun/extensions/hooks";
const bundle=resolve(process.argv[2]??"build/dev-macos-arm64/ptolemy-dev.app");
const root=await mkdtemp(join(tmpdir(),"ptolemy-bundled-extension-")),cwd=join(root,"workspace");await mkdir(cwd);
try{
 const paths=extensionLauncherPaths(join(bundle,"Contents/MacOS/bun"));assert(paths.executable.startsWith(`${bundle}/`));assert(paths.launcher.startsWith(`${bundle}/`));
 const spec={cwd,root:cwd,data:cwd,event:"PreToolUse",timeout:5,command:`echo yes > inside; /bin/sh -c 'echo no > ../outside'; printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"}}'`};
 const child=Bun.spawn([paths.executable,paths.launcher,Buffer.from(JSON.stringify(spec)).toString("base64url")],{cwd,env:{PATH:"/usr/bin:/bin"},stdin:new Blob(['{"tool_name":"Bash"}']),stdout:"pipe",stderr:"pipe"});
 const output=await new Response(child.stdout).text();assert.equal(await child.exited,0);assert.equal(JSON.parse(output).hookSpecificOutput.permissionDecision,"deny");assert.equal(await readFile(join(cwd,"inside"),"utf8"),"yes\n");assert.equal(await readFile(join(root,"outside"),"utf8").catch(()=>null),null);
 console.log(`Bundled extension launcher, executor and Bun verified: ${paths.launcher}`);
}finally{await rm(root,{recursive:true,force:true});}
