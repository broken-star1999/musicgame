import type {Onset} from '../types';
import type {TempoBlock} from './tempo-families';
import {CONCURRENCE_WINDOW} from './clock-evidence';
/** All times/periods are seconds. A hard prior must explain the original,
 * nonboundary selected source, and can never suppress its measured neighbors. */
export function gateClockEvidence(onsets:Onset[],blocks:TempoBlock[],sourceOnsets?:Onset[]):Onset[]{
 const source=(sourceOnsets??[]).filter(event=>!event.boundary),groups:Onset[][]=Array.from({length:blocks.length},()=>[]);
 const blockAt=(time:number)=>Math.min(blocks.length-1,Math.round(time/2));
 for(const event of source){const group=groups[blockAt(event.time)];if(group)group.push(event);}
 const distance=(time:number,block:TempoBlock)=>Math.min(...block.refAnchors.map(anchor=>Math.abs(time-(anchor+Math.round((time-anchor)/block.preferredPeriod!)*block.preferredPeriod!))));
 const blockReasons=blocks.map((block,index)=>{
  if(!block.supported||block.refAnchors.length!==1||block.phaseAmbiguous||!(block.preferredPeriod!>0))return 'v4-unknown-or-ambiguous';
  if(!groups[index].length)return 'missing-selected-block';
  if(!groups[index].every(event=>distance(event.time,block)<=CONCURRENCE_WINDOW))return 'contradicts-selected-source';
  return 'eligible';
 }),eligibleBlocks=blockReasons.map(reason=>reason==='eligible');
 const projected=onsets.map(event=>{
  const blockIndex=blockAt(event.time),block=blocks[blockIndex];
  if(!source.length){return event;}
  if(source.some(selected=>Math.abs(selected.time-event.time)<=CONCURRENCE_WINDOW)){return event;}
  if(!eligibleBlocks[blockIndex]){return event;}
  const phaseDistance=distance(event.time,block),keep=phaseDistance<=CONCURRENCE_WINDOW;
  return keep?event:{...event,strength:0};
 });
 return projected;
}
