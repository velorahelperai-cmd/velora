"use client";
import {useEffect,useRef} from "react";
import {buildCharacterMesh,type CharacterName} from "./subscription-character-geometry";
import styles from "./subscription-panel.module.css";

const vertex=`attribute vec3 aPosition;attribute vec3 aNormal;attribute vec3 aColor;attribute float aGroup;
uniform float uYaw;uniform float uTime;uniform float uMotion;uniform float uAspect;
varying vec3 vNormal;varying vec3 vColor;varying vec3 vPosition;
vec3 rotateZ(vec3 p,float a){return vec3(p.x*cos(a)-p.y*sin(a),p.x*sin(a)+p.y*cos(a),p.z);}
vec3 rotateY(vec3 p,float a){return vec3(p.x*cos(a)+p.z*sin(a),p.y,-p.x*sin(a)+p.z*cos(a));}
void main(){vec3 p=aPosition;vec3 n=aNormal;
float breathe=sin(uTime*1.5)*.012*uMotion;
float tilt=sin(uTime*.65)*.035*uMotion;
if(aGroup>0.5&&aGroup<1.5){p=rotateZ(p-vec3(0.,.9,0.),tilt)+vec3(0.,.9,0.);n=rotateZ(n,tilt);}
if(aGroup>1.5&&aGroup<2.5){float wave=sin(uTime*1.1)*.06*uMotion;p=rotateZ(p-vec3(.5,.4,0.),wave)+vec3(.5,.4,0.);n=rotateZ(n,wave);}
p.y+=breathe;p=rotateY(p,uYaw);n=rotateY(n,uYaw);
p=vec3(p.x,p.y*cos(.04)-p.z*sin(.04),p.y*sin(.04)+p.z*cos(.04));
float camera=6.5;float focal=3.0;float depth=camera-p.z;
gl_Position=vec4(p.x*focal/uAspect,p.y*focal-.18,depth*1.02-.24,depth);
vNormal=n;vColor=aColor;vPosition=p;
}`;
const fragment=`precision mediump float;varying vec3 vNormal;varying vec3 vColor;varying vec3 vPosition;uniform float uSelected;
void main(){vec3 n=normalize(vNormal);vec3 key=normalize(vec3(-.55,.95,1.2));vec3 fill=normalize(vec3(.75,.15,.45));
float diffuse=max(dot(n,key),0.);float cool=max(dot(n,fill),0.)*.22;float rim=pow(1.-abs(n.z),2.6);
float spec=pow(max(dot(reflect(-key,n),normalize(vec3(0.,.2,6.2)-vPosition)),0.),32.);
vec3 color=vColor*(.38+.7*diffuse+cool)+vec3(.10,.28,.24)*rim*(.45+.55*uSelected)+vec3(.28,.26,.22)*spec;
color+=vec3(.05,.12,.09)*uSelected;gl_FragColor=vec4(color,1.);}`;

/** WebGL sculpture with real surfaces, controlled yaw and procedural gestures.
 * No network provider, raster character billboard, or purchased dependency. */
export function SubscriptionCharacter({name,label,locale,selected=false,size="staff"}:{name:CharacterName;label:string;locale:"ar"|"en";selected?:boolean;size?:"host"|"staff"}){
 const canvasRef=useRef<HTMLCanvasElement>(null),yaw=useRef(-.12),renderRef=useRef<(()=>void)|null>(null),selectedRef=useRef(selected),pointer=useRef<{id:number;x:number;yaw:number}|null>(null);
 useEffect(()=>{selectedRef.current=selected;renderRef.current?.();},[selected]);
 useEffect(()=>{
  const canvas=canvasRef.current;if(!canvas)return;
  const gl=canvas.getContext("webgl",{alpha:true,antialias:true,preserveDrawingBuffer:true});
  if(!gl){canvas.dataset.renderState="unavailable";return;}
  const resources:WebGLShader[]=[],buffers:WebGLBuffer[]=[];
  function compile(kind:number,source:string){const shader=gl!.createShader(kind);if(!shader)throw Error("shader");resources.push(shader);gl!.shaderSource(shader,source);gl!.compileShader(shader);if(!gl!.getShaderParameter(shader,gl!.COMPILE_STATUS))throw Error("shader_compile");return shader;}
  let program:WebGLProgram|null=null,frame=0,visible=true,last=0,elapsed=0,lastTick=0;
  const reduce=window.matchMedia("(prefers-reduced-motion: reduce)");
  const start=performance.now();
  try{
   program=gl.createProgram();if(!program)throw Error("program");gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error("program_link");gl.useProgram(program);
   const mesh=buildCharacterMesh(name);
   for(const [attr,values,size] of [["aPosition",mesh.positions,3],["aNormal",mesh.normals,3],["aColor",mesh.colors,3],["aGroup",mesh.groups,1]] as const){const buffer=gl.createBuffer();if(!buffer)throw Error("buffer");buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);const location=gl.getAttribLocation(program,attr);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);}
   const uniforms={yaw:gl.getUniformLocation(program,"uYaw"),time:gl.getUniformLocation(program,"uTime"),motion:gl.getUniformLocation(program,"uMotion"),aspect:gl.getUniformLocation(program,"uAspect"),selected:gl.getUniformLocation(program,"uSelected")};
   gl.enable(gl.DEPTH_TEST);gl.clearColor(0,0,0,0);
   const draw=()=>{if(!program||gl.isContextLost())return;const rect=canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,1.5);const width=Math.max(1,Math.round(rect.width*ratio)),height=Math.max(1,Math.round(rect.height*ratio));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}gl.viewport(0,0,width,height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);gl.uniform1f(uniforms.yaw,yaw.current+(reduce.matches||pointer.current?0:Math.sin(elapsed*.35)*.10));gl.uniform1f(uniforms.time,elapsed);gl.uniform1f(uniforms.motion,reduce.matches?0:1);gl.uniform1f(uniforms.aspect,width/height);gl.uniform1f(uniforms.selected,selectedRef.current?1:0);gl.drawArrays(gl.TRIANGLES,0,mesh.positions.length/3);canvas.dataset.renderState="ready";canvas.dataset.yaw=yaw.current.toFixed(3);};
   renderRef.current=draw;
   const tick=(time:number)=>{frame=0;if(!visible||document.hidden||reduce.matches)return;if(time-lastTick>40){elapsed+=(last?Math.min(time-last,100):time-start)/1000;last=time;lastTick=time;draw();}frame=requestAnimationFrame(tick);};
   const resume=()=>{cancelAnimationFrame(frame);frame=0;last=0;draw();if(visible&&!document.hidden&&!reduce.matches)frame=requestAnimationFrame(tick);};
   const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??false;resume();},{threshold:.01});observer.observe(canvas);
   const resize=new ResizeObserver(draw);resize.observe(canvas);reduce.addEventListener("change",resume);document.addEventListener("visibilitychange",resume);const lost=()=>{cancelAnimationFrame(frame);canvas.dataset.renderState="unavailable";};canvas.addEventListener("webglcontextlost",lost);
   draw();
   return ()=>{observer.disconnect();resize.disconnect();reduce.removeEventListener("change",resume);document.removeEventListener("visibilitychange",resume);canvas.removeEventListener("webglcontextlost",lost);cancelAnimationFrame(frame);renderRef.current=null;buffers.forEach(b=>gl.deleteBuffer(b));resources.forEach(s=>gl.deleteShader(s));if(program)gl.deleteProgram(program);};
  }catch{canvas.dataset.renderState="unavailable";buffers.forEach(b=>gl.deleteBuffer(b));resources.forEach(s=>gl.deleteShader(s));if(program)gl.deleteProgram(program);}
 },[name]);
 const rotate=(amount:number)=>{yaw.current+=amount;renderRef.current?.();};
 return <div className={styles.characterStage} data-character={name} data-size={size} data-selected={selected}>
  <canvas ref={canvasRef} className={styles.characterCanvas} aria-label={locale==="ar"?`مجسّم ${label} ثلاثي الأبعاد`:`${label} 3D sculpture`} role="img" width={360} height={420}
   onPointerDown={event=>{pointer.current={id:event.pointerId,x:event.clientX,yaw:yaw.current};event.currentTarget.setPointerCapture(event.pointerId);}}
   onPointerMove={event=>{if(pointer.current?.id===event.pointerId){yaw.current=pointer.current.yaw+(event.clientX-pointer.current.x)*.012;renderRef.current?.();}}}
   onPointerUp={()=>{pointer.current=null;}} onPointerCancel={()=>{pointer.current=null;}} onLostPointerCapture={()=>{pointer.current=null;}} />
  <span className={styles.characterUnavailable}>{locale==="ar"?"تعذّر عرض المجسّم على هذا الجهاز":"3D view unavailable on this device"}</span>
  <div className={styles.characterControls} role="group" aria-label={locale==="ar"?`تدوير ${label}`:`Rotate ${label}`}>
   <button type="button" onClick={()=>rotate(-.45)} aria-label={locale==="ar"?"تدوير لليسار":"Rotate left"}>↶</button>
   <span>{locale==="ar"?"اسحب للتدوير":"Drag to rotate"}</span>
   <button type="button" onClick={()=>rotate(.45)} aria-label={locale==="ar"?"تدوير لليمين":"Rotate right"}>↷</button>
  </div>
 </div>;
}
