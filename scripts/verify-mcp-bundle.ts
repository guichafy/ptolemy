/** Run after build:dev-bundle. Exercises the shipped launcher with shipped Bun,
 * a minimal PATH and an unrelated workspace; never falls back to repository code. */
import assert from "node:assert/strict";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mcpLauncherPaths } from "../src/bun/mcp/launcher-path";
const bundle=resolve(process.argv[2]??"build/dev-macos-arm64/ptolemy-dev.app");
const workspace=await mkdtemp(join(tmpdir(),"ptolemy-bundled-mcp-"));
try{
 const paths=mcpLauncherPaths(join(bundle,"Contents/MacOS/bun"),workspace);
 assert(paths.command.startsWith(`${bundle}/`));assert(paths.args[0].startsWith(`${bundle}/`));
 const fixture=join(workspace,"fixture.mjs");
 await writeFile(fixture,`import {createInterface} from 'node:readline';createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'bundle',version:'1'}}:{content:[{type:'text',text:process.env.API_KEY}]};console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`);
 const transport=new StdioClientTransport({...paths,cwd:workspace,stderr:"ignore",env:{PATH:"/usr/bin:/bin",PTOLEMY_MCP_STDIO:JSON.stringify({command:paths.command,args:[fixture],cwd:workspace,env:{PATH:"/usr/bin:/bin",API_KEY:"bundled-test-value"}})}});
 const client=new Client({name:"bundle-verification",version:"1"});
 await client.connect(transport);
 assert.deepEqual(await client.callTool({name:"echo",arguments:{}}),{content:[{type:"text",text:"bundled-test-value"}]});
 await client.close();
 console.log(`Bundled MCP launcher and Bun verified: ${paths.args[0]}`);
}finally{await rm(workspace,{recursive:true,force:true});}
