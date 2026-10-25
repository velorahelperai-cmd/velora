// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {createApprovedLoaderScene} from './approved-loader-scene';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function setup(){
 vi.stubGlobal('innerWidth',120);vi.stubGlobal('innerHeight',120);vi.spyOn(Math,'random').mockReturnValue(.5);
 const canvas=document.createElement('canvas'),arc=vi.fn();
 const ctx={fillStyle:'',setTransform:vi.fn(),fillRect:vi.fn(),beginPath:vi.fn(),arc,fill:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),createRadialGradient:()=>({addColorStop:vi.fn()})};
 const data=new Uint8ClampedArray(120*120*4);data[(54*120+60)*4+3]=255;
 const mask={measureText:(text:string)=>({width:text.length*10}),fillText:vi.fn(),getImageData:()=>({data})};
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(this:HTMLCanvasElement){return (this===canvas?ctx:mask) as unknown as CanvasRenderingContext2D;});
 const scene=createApprovedLoaderScene(canvas)!;expect(scene.resize()).toBe(true);
 const position=(elapsed=8000,reduced=false)=>{arc.mockClear();scene.draw(elapsed,8000,reduced);const last=arc.mock.calls.at(-1)!;return {x:last[0] as number,y:last[1] as number};};return {scene,position,arc,ctx};
}
it('restores the exact75px radius/8px force on particles forming the word',()=>{
 const {scene,position}=setup(),base=position();scene.setPointer(base.x-30,base.y);const pushed=position();expect(pushed.x-base.x).toBeCloseTo((1-30/75)*8);expect(pushed.y).toBeCloseTo(base.y);
 scene.clearPointer();expect(position()).toEqual(base);scene.setPointer(base.x-80,base.y);expect(position()).toEqual(base);
});
it('keeps the stationary reduced-motion word independent of pointer position',()=>{
 const {scene,position}=setup(),base=position(8000,true);scene.setPointer(base.x-30,base.y);expect(position(8000,true)).toEqual(base);
});
it('preserves formation from scattered points to the final word target',()=>{
 const {position}=setup();expect(position(0)).not.toEqual(position(8000));expect(Math.abs(position(8000).x-60)).toBeLessThanOrEqual(.85);expect(Math.abs(position(8000).y-54)).toBeLessThanOrEqual(.85);
});

it('finishes the original staggered upward dissolve while fading the word and ambient dust',()=>{
 const {scene,arc,ctx}=setup();arc.mockClear();scene.draw(8201,8201,false,0);const baseline=arc.mock.calls.at(-1)!;arc.mockClear();scene.draw(9001,9001,false,.5);const drift=arc.mock.calls.at(-1)!;expect(drift[1]).toBeLessThan(baseline[1]);arc.mockClear();scene.draw(9801,9801,false,1);expect(arc).toHaveBeenCalledTimes(30);expect(ctx.fillStyle).toBe('rgba(167,243,208,0)');
});
