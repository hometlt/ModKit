// Standalone reproduction of the material VAO A/B measurement; not a full-map benchmark.
// From repository root:
// node packages/scene/test/material-webgl-benchmark.mjs --out ../artifacts/optimization-2026-09-22/material-vao
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const { values } = parseArgs({
  options: {
    baseline: { type: 'string', default: '76b2053c1fa00cb716ed5306c58c27c019e7e23e' },
    out: { type: 'string' },
    'verify-only': { type: 'boolean', default: false },
  },
})
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const baseline = execFileSync('git', ['cat-file', 'blob', values.baseline], {
  cwd: root,
  encoding: 'utf8',
})
const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(path => path !== undefined && existsSync(path))
if (executablePath === undefined) throw new Error('Chrome or Edge is required')

// Same workload as the original inline measurement: 32x32, one warm-up, 12 measured frames,
// 8,000 placed primitives sharing arrays. Verification is instrumented; timings are not.
const contents = `
import { materialWebGlDraws } from './packages/scene/src/render/material-webgl.ts';
const matrix = Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1);
const camera = {viewProjection:matrix};
const material = {textures:new Map()};
const source = {
 fragmentSource: '#version 300 es\\nprecision highp float;\\nin vec4 v_vertexColor;\\nin vec2 v_uv0;\\nin vec3 v_modelNormal;\\nout vec4 materialColor;\\nvoid main(){materialColor=vec4(v_vertexColor.rgb*(0.6+0.2*v_uv0.x+0.2*abs(v_modelNormal.z)),v_vertexColor.a);}',
 textures:[],uniforms:{},defines:{uvSetCount:1,usesVertexColor:true,usesVertexAlpha:true},blend:'opaque',twoSided:true
};
function setup(instrument) {
 const canvas = document.createElement('canvas'); canvas.width=32;canvas.height=32;
 const native = canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
 if(!native) throw Error('WebGL2 required');
 native.viewport(0,0,32,32);
 const counts={}, handles={VertexArray:new Set(),Buffer:new Set(),Program:new Set()};
 const wrapped = new Map();
 const gl = !instrument ? native : new Proxy(native,{get(target,key){
  const value=target[key];
  if(typeof value!=='function')return value;
  if(!wrapped.has(key))wrapped.set(key,(...args)=>{
   counts[key]=(counts[key]??0)+1;
   const result=value.apply(target,args);
   for(const type of Object.keys(handles)){
    if(key==='create'+type && result)handles[type].add(result);
    if(key==='delete'+type && args[0])handles[type].delete(args[0]);
   }
   return result;
  });
  return wrapped.get(key);
 }});
 const renderer=materialWebGlDraws(gl,new Map(),{checkEachDraw:false});
 const mesh = {id:'quad',topology:'triangles',positions:Float32Array.of(-.8,-.8,0,.8,-.8,0,.8,.8,0,-.8,.8,0),normals:Float32Array.of(0,0,1,0,0,1,0,0,1,0,0,1),textureCoordinates:Float32Array.of(0,0,1,0,1,1,0,1),indices:Uint32Array.of(0,1,2,0,2,3)};
 const clear=()=>{gl.colorMask(true,true,true,true);gl.depthMask(true);gl.clearColor(.1,.2,.3,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT)};
 const run=(primitive=mesh,program=source,depthOnly=false)=>renderer.draw({primitive,program,material,depthOnly},camera);
 const pixels=()=>{const data=new Uint8Array(32*32*4);native.readPixels(0,0,32,32,native.RGBA,native.UNSIGNED_BYTE,data);return Array.from(data)};
 const dispose=()=>{renderer.release();renderer.release();const error=native.getError();if(error)throw Error('GL error '+error);for(const [kind,live] of Object.entries(handles))if(live.size)throw Error('leaked '+kind+': '+live.size);native.getExtension('WEBGL_lose_context')?.loseContext()};
 return {native,gl,renderer,mesh,clear,run,pixels,dispose,counts};
}
globalThis.verify=()=>{
 const a=setup(true), frames=[];
 const capture=()=>{frames.push(a.pixels());a.renderer.sweep()};
 a.clear(); a.run();capture();
 for(let i=0;i<1000;i++)a.run({...a.mesh,id:'placed'+i});
 a.clear();a.run({...a.mesh,normals:a.mesh.normals.slice()});capture();
 a.clear();a.run({...a.mesh,textureCoordinateSets:[{set:0,coordinates:Float32Array.of(1,1,0,1,0,0,1,0)}]});capture();
 a.clear();a.run({...a.mesh,indices:Uint32Array.of(3,2,1)});capture();
 a.clear();a.run({...a.mesh,indices:undefined});capture();
 const colors=Float32Array.of(1,0,0,.25,1,0,0,.25,1,0,0,1,1,0,0,1);
 const alpha={...source,blend:'alpha-test',fragmentSource:source.fragmentSource.replace(';}', ';if(materialColor.a<0.5)discard;}')};
 a.clear();a.run({...a.mesh,colors},alpha);capture();
 const transparent={...source,blend:'blend'};
 a.clear();a.run({...a.mesh,colors},transparent,true);a.run({...a.mesh,colors},transparent);capture();
 a.clear(); a.run();
 const currentProgram=a.gl.getParameter(a.gl.CURRENT_PROGRAM), loc=a.gl.getAttribLocation(currentProgram,'a_color');
 a.gl.vertexAttrib4fv(loc,Float32Array.of(0,0,0,0));a.run();capture();
 const error=a.gl.getError();if(error)throw Error('GL validation error '+error);
 const drawCalls=a.renderer.drawCalls?.();a.dispose();
 return {frames,counts:a.counts,drawCalls};
};
globalThis.benchmark=()=>{
 const a=setup(false);a.mesh.positions=Float32Array.from(a.mesh.positions,v=>v*.01);
 const draws=Array.from({length:8000},(_,i)=>({...a.mesh,id:String(i),transform:matrix}));
 a.clear();for(const mesh of draws)a.run(mesh);a.renderer.sweep();a.native.finish();
 const samples=[];
 for(let frame=0;frame<12;frame++){
  a.clear();const start=performance.now();
  for(const mesh of draws)a.run(mesh);
  const submitted=performance.now();a.renderer.sweep();a.native.finish();
  samples.push({submit:submitted-start,total:performance.now()-start});
 }
 const info=a.native.getExtension('WEBGL_debug_renderer_info');
 const gpu=info?a.native.getParameter(info.UNMASKED_RENDERER_WEBGL):a.native.getParameter(a.native.RENDERER);
 a.dispose();return {samples,gpu};
};
`

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-webgl',
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
  ],
})
try {
  const results = {}
  for (const version of ['before', 'after']) {
    const bundled = await build({
      stdin: { contents, resolveDir: root },
      bundle: true,
      write: false,
      metafile: true,
      format: 'iife',
      platform: 'browser',
      absWorkingDir: root,
      plugins:
        version === 'before'
          ? [
              {
                name: 'baseline',
                setup(builder) {
                  builder.onLoad({ filter: /[/\\]render[/\\]material-webgl\.ts$/ }, args => ({
                    contents: baseline,
                    loader: 'ts',
                    resolveDir: args.path.replace(/[/\\][^/\\]+$/, ''),
                  }))
                },
              },
            ]
          : [],
    })
    const page = await browser.newPage()
    await page.addScriptTag({ content: bundled.outputFiles[0].text })
    const verification = await page.evaluate(() => globalThis.verify())
    const benchmark = values['verify-only']
      ? undefined
      : await page.evaluate(() => globalThis.benchmark())
    const inputs = Object.fromEntries(
      Object.keys(bundled.metafile.inputs)
        .filter(path => path !== '<stdin>')
        .map(path => [
          path,
          sha256(
            version === 'before' && path.endsWith('/render/material-webgl.ts')
              ? baseline
              : readFileSync(resolve(root, path)),
          ),
        ]),
    )
    results[version] = {
      verification,
      benchmark,
      inputs,
      bundleSha256: sha256(bundled.outputFiles[0].contents),
    }
    await page.close()
  }
  assert.deepEqual(results.after.verification.frames, results.before.verification.frames)
  const summarize = value => {
    const p50 = key => value.benchmark?.samples.map(x => x[key]).sort((a, b) => a - b)[6]
    const { frames, counts, drawCalls } = value.verification
    return {
      gpu: value.benchmark?.gpu,
      submitP50Milliseconds: p50('submit'),
      frameP50Milliseconds: p50('total'),
      samples: value.benchmark?.samples,
      drawCalls,
      calls: counts,
      pixelSha256: frames.map(frame => sha256(Uint8Array.from(frame))),
      inputSha256: value.inputs,
      bundleSha256: value.bundleSha256,
    }
  }
  const receipt = {
    recordedAt: new Date().toISOString(),
    baselineBlob: values.baseline,
    executablePath,
    browserVersion: browser.version(),
    nodeVersion: process.version,
    workload: {
      width: 32,
      height: 32,
      drawsPerFrame: 8000,
      warmupFrames: 1,
      measuredFrames: values['verify-only'] ? 0 : 12,
      instrumentationDuringTiming: false,
    },
    pixelParityFrames: results.after.verification.frames.length,
    before: summarize(results.before),
    after: summarize(results.after),
  }
  if (values.out) {
    const directory = resolve(values.out)
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      resolve(directory, 'material-webgl-receipt.json'),
      JSON.stringify(receipt, null, 2) + '\n',
    )
  }
  console.log(JSON.stringify(receipt, null, 2))
} finally {
  await browser.close()
}
