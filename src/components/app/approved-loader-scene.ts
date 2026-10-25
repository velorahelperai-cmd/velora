// Exact owner reference: velora-loading-clean.html, Library libfile_8cf7f00dcb608191bbe740e31fb8f44e, lines266-275/528-534.
// Reference hold + dissolve; scheduling never establishes account readiness.
export const APPROVED_LOADER_TIMELINE = {holdUntil:8200,dissolveDuration:1600} as const;
type Point = {vxDissolve:number;vyDissolve:number;tx:number;ty:number;letter:number;sx:number;sy:number;radius:number;angle:number;speed:number;size:number;seed:number;alpha:number;direction:number;normX:number;green:number;x:number;y:number};
type Ambient = {x:number;y:number;size:number;seed:number;alpha:number;vx:number;vy:number};
const clamp=(v:number,min=0,max=1)=>Math.min(max,Math.max(min,v));
const cubic=(t:number)=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const quart=(t:number)=>1-Math.pow(1-t,4);
export function createApprovedLoaderScene(canvas:HTMLCanvasElement) {
  const ctx=canvas.getContext('2d');
  if(!ctx)return null;
  let width=0,height=0,wordWidth=1,points:Point[]=[],ambient:Ambient[]=[];
  const pointer={x:-9999,y:-9999,active:false};
  function setPointer(x:number,y:number){pointer.x=x;pointer.y=y;pointer.active=Number.isFinite(x)&&Number.isFinite(y);}
  function clearPointer(){pointer.active=false;}
  function resize(){
    width=Math.max(1,window.innerWidth);height=Math.max(1,window.innerHeight);
    const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    ctx!.setTransform(dpr,0,0,dpr,0,0);
    ctx!.fillStyle='#000';ctx!.fillRect(0,0,width,height);
    const mask=document.createElement('canvas');mask.width=width;mask.height=height;
    const text=mask.getContext('2d',{willReadFrequently:true});if(!text)return false;
    const mobile=width<640,fontSize=Math.floor(Math.min(width*(mobile?.23:.17),mobile?115:195));
    text.font=`800 ${fontSize}px "Velora Loader Outfit"`;text.textBaseline='middle';
    const word='Velora',start=(width-text.measureText(word).width)/2,center=height*.46;
    const ranges=[...word].map((_,i)=>({start:start+text.measureText(word.slice(0,i)).width-(i===0?10:0),end:start+text.measureText(word.slice(0,i+1)).width+(i===word.length-1?10:0)}));
    text.fillStyle='#fff';text.fillText(word,start,center);
    const pixels=text.getImageData(0,0,width,height).data,step=width<1100?3:4;
    const samples:Array<{x:number;y:number;letter:number}>=[];
    let minX=width,maxX=0;
    for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step){
      if(pixels[(y*width+x)*4+3]>135){minX=Math.min(minX,x);maxX=Math.max(maxX,x);samples.push({x:x+(Math.random()-.5)*.8,y:y+(Math.random()-.5)*.8,letter:Math.max(0,ranges.findIndex(r=>x>=r.start&&x<=r.end))});}
    }
    wordWidth=Math.max(1,maxX-minX);const spread=Math.hypot(width,height)*.58;
    points=samples.map(p=>{
      const angle=Math.random()*Math.PI*2,dist=Math.sqrt(Math.random())*spread;
      const sx=width/2+Math.cos(angle)*dist*1.15,sy=center+Math.sin(angle)*dist*.85;
      return {tx:p.x,ty:p.y,letter:p.letter,sx,sy,radius:Math.pow(Math.random(),.65)*Math.min(width,height)*.22,angle:Math.random()*Math.PI*2,speed:(Math.random()*.6+.4)*(Math.random()<.5?-1:1),size:Math.random()*1.15+1.15,seed:Math.random()*1000,alpha:Math.random()*.45+.55,direction:Math.random()<.5?-1:1,normX:(p.x-minX)/wordWidth,green:0,x:sx,y:sy,vxDissolve:(Math.random()-.5)*2.2,vyDissolve:-Math.random()*1.8-.4};
    });
    ambient=Array.from({length:mobile?30:55},()=>({x:Math.random()*width,y:Math.random()*height,size:Math.random()*1.4+.5,seed:Math.random()*1000,alpha:Math.random()*.35+.1,vx:(Math.random()-.5)*.25,vy:(Math.random()-.5)*.25}));
    return points.length>0;
  }
  function circle(x:number,y:number,r:number,color:string){ctx!.fillStyle=color;ctx!.beginPath();ctx!.arc(x,y,r,0,Math.PI*2);ctx!.fill();}
  function draw(elapsed:number,now:number,reduced:boolean,dissolve?:number){
    const isDissolving=dissolve!==undefined,dissolveProgress=clamp(dissolve??0);
    if(!points.length)return false;
    if(reduced){
      ctx!.fillStyle='#000';ctx!.fillRect(0,0,width,height);
      for(const p of points){circle(p.tx,p.ty,p.size,`rgba(56,220,137,${p.alpha})`);}
      return true;
    }
    ctx!.fillStyle=`rgba(0,0,0,${elapsed>1300&&elapsed<4900?.24:.36})`;ctx!.fillRect(0,0,width,height);
    if(elapsed>4165&&dissolveProgress<.95){
      const bloom=isDissolving?(1-dissolveProgress)*.11:clamp((elapsed-4165)/1200,0,.12),gradient=ctx!.createRadialGradient(width/2,height*.46,10,width/2,height*.46,Math.max(11,wordWidth*.65));
      gradient.addColorStop(0,`rgba(56,220,137,${bloom})`);gradient.addColorStop(.6,`rgba(16,185,129,${bloom*.35})`);gradient.addColorStop(1,'rgba(0,0,0,0)');ctx!.fillStyle=gradient;ctx!.fillRect(0,0,width,height);
    }
    for(const p of ambient){p.x=(p.x+p.vx+Math.sin(now*.0007+p.seed)*.15+width)%width;p.y=(p.y+p.vy+Math.cos(now*.0007+p.seed)*.15+height)%height;circle(p.x,p.y,p.size,`rgba(167,243,208,${p.alpha*(.5+.5*Math.sin(now*.002+p.seed))*(isDissolving?1-dissolveProgress:1)})`);}
    const gather=cubic(clamp((elapsed-400)/2100)),wave=clamp((elapsed-4950)/1400,-.2,1.3);
    for(const p of points){
      const previousX=p.x,previousY=p.y,angle=p.angle+now*.0008*p.speed;
      let x=(p.sx+Math.sin(now*.0014+p.seed)*14*(1-gather))*(1-gather)+(width/2+Math.cos(angle)*p.radius)*gather;
      let y=(p.sy+Math.cos(now*.0016+p.seed)*14*(1-gather))*(1-gather)+(height*.46+Math.sin(angle)*p.radius*.72)*gather;
      const letter=quart(clamp((elapsed-(2200+p.letter*310))/920)),arc=Math.sin(letter*Math.PI);
      const dx=p.tx-x,dy=p.ty-y;x+=dx*letter-dy*.15*arc*p.direction;y+=dy*letter+arc*36*p.direction*.35;
      if(letter>=.99&&!isDissolving){x=p.tx+Math.sin(now*.0028+p.seed)*.85;y=p.ty+Math.cos(now*.0032+p.seed)*.85;}
      // Exact reference interaction, including the particles that form the word.
      if(pointer.active&&!isDissolving){
        const dx=x-pointer.x,dy=y-pointer.y,distanceSquared=dx*dx+dy*dy;
        if(distanceSquared<75*75&&distanceSquared>1){const distance=Math.sqrt(distanceSquared),push=(1-distance/75)*8;x+=dx/distance*push;y+=dy/distance*push;}
      }
      let crest=0;
      if(elapsed>=4950){const distance=wave-p.normX;if(distance>-.18)p.green=clamp((distance+.12)/.28,p.green,1);crest=Math.max(0,1-Math.abs(distance)/.14);}else p.green=0;
      if(elapsed>6350&&!isDissolving){const loop=((now-6350)*.00045)%1.8-.4;crest=Math.max(0,1-Math.abs(loop-p.normX)/.18)*.55;}
      let alphaMultiplier=1;
      if(isDissolving){const dEase=cubic(dissolveProgress),particleDissolve=clamp(dissolveProgress*1.25-p.normX*.2);x+=p.vxDissolve*particleDissolve*42+Math.sin(now*.003+p.seed)*particleDissolve*12;y+=p.vyDissolve*particleDissolve*42;alphaMultiplier=Math.max(0,1-dEase*1.08);}
      p.x=x;p.y=y;if(alphaMultiplier<=.01)continue;
      const shift=Math.sin(p.seed)*.25,target=[clamp(56+shift*35,16,167),clamp(220+shift*20,185,243),clamp(137+shift*35,129,208)],mint=[167,243,208];
      const rgb=target.map((value,i)=>Math.round(255*(1-p.green)+value*p.green+(mint[i]-value)*crest*.65)).join(',');
      const alpha=clamp((p.alpha+crest*.35+letter*.2)*alphaMultiplier),radius=p.size*(1+crest*.55),distance=(x-previousX)**2+(y-previousY)**2;
      if(distance>1.2&&distance<900){ctx!.strokeStyle=`rgba(${rgb},${alpha*.42})`;ctx!.lineWidth=radius*.85;ctx!.beginPath();ctx!.moveTo(previousX,previousY);ctx!.lineTo(x,y);ctx!.stroke();}
      if(crest>.15||(p.seed>820&&letter>.9))circle(x,y,radius*2.4,`rgba(56,220,137,${alpha*(.18+crest*.28)})`);
      circle(x,y,radius,`rgba(${rgb},${alpha})`);
    }
    return true;
  }
  return {resize,draw,setPointer,clearPointer};
}
