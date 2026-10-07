/** Procedural sculptures matching the approved character board (cream abaya, lining, hair).
 * Surfaces are real 3D meshes. They are not a substitute for a rigged studio model. */
export type CharacterName = "velora" | "noor" | "lina" | "dana";
export type CharacterMesh = {positions:number[];normals:number[];colors:number[];groups:number[]};
type V3=[number,number,number];
const rgb=(hex:string):V3=>[0,2,4].map(i=>Number.parseInt(hex.slice(i,i+2),16)/255) as V3;
const add=(a:V3,b:V3):V3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mix=(a:V3,b:V3,t:number):V3=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];

export function buildCharacterMesh(name:CharacterName|string):CharacterMesh {
 const mesh:CharacterMesh={positions:[],normals:[],colors:[],groups:[]};
 const velora=name==="velora", noor=name==="noor", lina=name==="lina", dana=name==="dana";
 const skin=rgb("e8b089"), blush=rgb("d9897c"), lip=rgb("b45c5c");
 const hair=rgb(noor?"3a2c28":dana?"1c181c":"221c22");
 const ivory=rgb("ebe4d6"), navy=rgb("252a36"), gold=rgb("c4a56d");
 const teal=rgb("7ecac2"), lilac=rgb("c4b3dc"), iridescent=rgb("8fd6cf");
 const coat=dana?navy:ivory;
 const lining=lina?lilac:dana?gold:noor?teal:iridescent;
 const liningAlt=velora?lilac:lining;
 const shoe=dana?rgb("1a1a1e"):lina?rgb("d5c8e4"):rgb("d8d4cc");
 const tablet=lina?rgb("b7a8cc"):dana?rgb("2a2d36"):rgb("c5c8c4");

 function ellipsoid(center:V3,scale:V3,color:V3,group=0,roll=0,yaw=0,end=Math.PI,segments=16,rings=12){
  const cz=Math.cos(yaw),sz=Math.sin(yaw),cr=Math.cos(roll),sr=Math.sin(roll);
  const vertex=(u:number,v:number)=>{
   const a=u*Math.PI*2,b=v*end;
   const n:V3=[Math.sin(b)*Math.cos(a),Math.cos(b),Math.sin(b)*Math.sin(a)];
   let x=n[0]*scale[0],y=n[1]*scale[1],z=n[2]*scale[2];
   [x,y]=[x*cr-y*sr,x*sr+y*cr];
   [x,z]=[x*cz+z*sz,-x*sz+z*cz];
   let nx=n[0]/scale[0],ny=n[1]/scale[1],nz=n[2]/scale[2];
   [nx,ny]=[nx*cr-ny*sr,nx*sr+ny*cr];
   [nx,nz]=[nx*cz+nz*sz,-nx*sz+nz*cz];
   const len=Math.hypot(nx,ny,nz)||1;
   return {p:add(center,[x,y,z]),n:[nx/len,ny/len,nz/len]};
  };
  for(let j=0;j<rings;j++)for(let i=0;i<segments;i++){
   const a=vertex(i/segments,j/rings),b=vertex((i+1)/segments,j/rings),c=vertex((i+1)/segments,(j+1)/rings),d=vertex(i/segments,(j+1)/rings);
   for(const vert of [a,b,c,a,c,d]){mesh.positions.push(...vert.p);mesh.normals.push(...vert.n);mesh.colors.push(...color);mesh.groups.push(group);}
  }
 }
 const bead=(points:V3[],radius:number,color:V3,group=0,seg=8)=>points.forEach(p=>ellipsoid(p,[radius,radius,radius],color,group,0,0,Math.PI,seg,6));

 // Palazzo trousers and flared ivory/navy coat, high collar, gold sash — board silhouette.
 for(let i=0;i<7;i++){
  const t=i/6,y=.42-t*1.55,w=.28+t*.22,d=.20+t*.06;
  ellipsoid([0,y,0],[w,.16,d],coat);
 }
 ellipsoid([0,.62,.02],[.34,.28,.22],coat);
 ellipsoid([0,.78,.04],[.22,.16,.18],coat);
 ellipsoid([0,.88,.06],[.16,.12,.15],coat);
 ellipsoid([0,.55,.20],[.33,.055,.05],gold);
 ellipsoid([0,.53,.24],[.08,.04,.03],lining);
 for(const side of [-1,1] as const){
  ellipsoid([side*.22,-1.05,.02],[.20,.72,.18],coat);
  ellipsoid([side*.23,-1.78,.08],[.21,.12,.30],shoe);
  ellipsoid([side*.23,-1.86,.18],[.09,.05,.16],shoe);
  ellipsoid([side*.38,-.18,-.04],[.20,.95,.22],coat,0,-side*.18);
  ellipsoid([side*.42,-.22,.10],[.14,.88,.16],lining,0,-side*.2);
  ellipsoid([side*.33,-.16,.16],[.11,.90,.14],coat,0,-side*.18);
  ellipsoid([side*.30,.42,.20],[.10,.34,.07],gold,0,-side*.22);
  ellipsoid([side*.26,.42,.24],[.09,.32,.06],coat,0,-side*.22);
 }
 ellipsoid([0,.08,.22],[.42,.62,.24],coat);
 ellipsoid([0,.70,0],[.17,.22,.15],skin);
 ellipsoid([0,.58,.18],[.20,.20,.14],dana?coat:ivory);

 // Presenting left hand; staff hold a tablet on the right, Velora opens both hands.
 ellipsoid([.48,.22,.02],[.17,.42,.16],coat,2,.28);
 ellipsoid([.66,.04,.14],[.16,.30,.16],coat,2,-.5);
 ellipsoid([.84,.30,.20],[.16,.08,.10],skin,2,-.08);
 for(let i=0;i<4;i++)ellipsoid([.90+i*.04,.34+i*.03,.20],[.035,.13-i*.012,.03],skin,2,-.46);
 ellipsoid([.78,.34,.28],[.03,.12,.035],skin,2,.48);
 if(velora){
  ellipsoid([-.50,.28,.06],[.17,.40,.16],coat,3,-.22);
  ellipsoid([-.70,.16,.16],[.16,.28,.15],coat,3,.42);
  ellipsoid([-.88,.34,.18],[.15,.08,.10],skin,3,.12);
  for(let i=0;i<4;i++)ellipsoid([-.94-i*.04,.38+i*.02,.18],[.035,.12-i*.01,.03],skin,3,.4);
 }else{
  ellipsoid([-.50,.18,.02],[.17,.40,.16],coat,3,-.18);
  ellipsoid([-.48,-.06,.18],[.16,.24,.16],coat,3,.55);
  ellipsoid([-.30,-.08,.40],[.22,.34,.03],tablet,0,-.08);
  ellipsoid([-.28,-.05,.43],[.19,.30,.012],dana?rgb("1b1d24"):rgb("eceae4"),0,-.08);
  ellipsoid([-.34,-.14,.48],[.14,.07,.06],skin,3,-.22);
 }

 // Head, features, and hair silhouettes from the approved board.
 ellipsoid([0,1.32,0],[.42,.52,.40],skin,1,0,0,Math.PI,28,20);
 for(const side of [-1,1] as const){
  ellipsoid([side*.42,1.30,.02],[.07,.12,.07],skin,1);
  ellipsoid([side*.44,1.16,.08],[.03,.08,.022],gold,1);
  ellipsoid([side*.15,1.40,.36],[.11,.10,.04],rgb("f6f2e6"),1,-side*.1);
  ellipsoid([side*.15,1.40,.40],[.055,.07,.02],rgb("5c4034"),1);
  ellipsoid([side*.15,1.405,.418],[.032,.05,.01],rgb("16141a"),1);
  ellipsoid([side*.13,1.43,.428],[.016,.02,.008],rgb("ffffff"),1);
  ellipsoid([side*.22,1.20,.34],[.09,.04,.016],blush,1);
 }
 ellipsoid([0,1.26,.39],[.05,.08,.07],skin,1);
 bead(Array.from({length:8},(_,i)=>[(i-3.5)*.02,1.12+Math.abs(i-3.5)*.004,.37] as V3),.014,lip,1);
 ellipsoid([0,1.095,.365],[.065,.012,.016],rgb("f0b0a2"),1);

 ellipsoid([0,1.38,-.04],[.46,.56,.42],hair,1,-.08,0,Math.PI*.55,26,14);
 if(noor){
  for(let i=0;i<10;i++){
   const a=(i/9)*Math.PI+.08,t=i/9;
   const pts:V3[]=Array.from({length:5},(_,j)=>{const u=j/4;return [Math.cos(a)*.40+Math.sin(u*5+i)*.03,1.55-u*(.55+.12*Math.sin(t*Math.PI)),-Math.sin(a)*.32-u*.08];});
   pts.forEach((p,j)=>ellipsoid(p,[.12-j*.01,.16,.12],hair,1,0,0,Math.PI,10,7));
  }
  ellipsoid([-.28,1.58,.18],[.22,.16,.18],hair,1,-.25);
  ellipsoid([.28,1.58,.18],[.22,.16,.18],hair,1,.25);
 }else if(lina){
  for(let i=0;i<10;i++){
   const a=(i/9)*Math.PI+.06;
   const pts:V3[]=Array.from({length:6},(_,j)=>{const u=j/5;return [Math.cos(a)*.42+Math.sin(u*6+i)*.05,1.62-u*1.05,-Math.sin(a)*.34-Math.sin(u*Math.PI)*.10];});
   pts.forEach((p,j)=>ellipsoid(p,[.11-j*.008,.18,.11],hair,1,0,0,Math.PI,10,7));
  }
  ellipsoid([-.30,1.68,.16],[.24,.18,.18],hair,1,-.28);
 }else if(dana){
  for(let i=0;i<8;i++){
   const a=(i/7)*Math.PI+.1;
   ellipsoid([Math.cos(a)*.38,1.48-Math.sin(a)*.04,-Math.sin(a)*.28],[.10,.14,.10],hair,1);
  }
  ellipsoid([0,.98,-.30],[.22,.22,.20],hair,1);
  ellipsoid([0,1.08,-.36],[.16,.16,.14],hair,1);
 }else{
  const locks=14;
  for(let i=0;i<locks;i++){
   const a=(i/(locks-1))*Math.PI+.04;
   const streak=i%4===1?teal:i%4===3?lilac:hair;
   const pts:V3[]=Array.from({length:8},(_,j)=>{const u=j/7;return [Math.cos(a)*.44+Math.sin(u*7+i)*.16,1.72-u*2.35,-Math.sin(a)*.36-Math.sin(u*Math.PI)*.14];});
   pts.forEach((p,j)=>ellipsoid(p,[.12-j*.008,.20,.12-j*.006],j>2&&i%4?mix(hair,streak,.55):streak===hair?hair:mix(hair,streak,.7),1,0,0,Math.PI,10,7));
  }
  ellipsoid([-.34,1.78,.20],[.28,.20,.20],hair,1,-.32);
  ellipsoid([.32,1.72,.12],[.22,.16,.18],hair,1,.28);
 }

 ellipsoid([.22,.40,.30],[.04,.04,.018],liningAlt);
 return mesh;
}
