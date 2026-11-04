'use strict';
const M=RFDiagnostics,$=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
let generation=0;
function render(rows){
 const last=rows.at(-1),kinds=[...new Set(rows.map(r=>M.modes[r.source_kind]))];
 $('mode').textContent=kinds.join(' + ')||'无数据';
 $('count').textContent=rows.length.toLocaleString();
 $('rms').textContent=last?.rms_dbfs==null?'—':last.rms_dbfs.toFixed(2);
 $('rails').textContent=last?.rail_fraction==null?'—':(last.rail_fraction*100).toFixed(3)+'%';
 $('gaps').textContent=rows.length?rows.reduce((n,r)=>n+BigInt(r.missing_samples),0n).toLocaleString():'—';
 const reasons=new Map();
 for(const r of rows)for(const reason of new Set(r.invalid_reasons))reasons.set(reason,(reasons.get(reason)||0)+1);
 $('reasons').replaceChildren();
 for(const [reason,count] of reasons){const li=document.createElement('li');li.textContent=reason+' · '+count.toLocaleString();$('reasons').append(li);}
 $('meta').textContent=last?[
 '来源：'+last.source_id,'来源类型：'+last.source_kind+'（文件/演示重放）',
 '采样率：'+(last.sample_rate_hz||'未知')+' 样本/秒',
 '中心频率：'+(last.center_frequency_hz??'未知')+' Hz（未验证）',
 '运行 / 时隙：'+last.run+' / '+last.slot_index,
 '主机单调时间（ns）：'+last.observed_monotonic_ns,
 '绝对样本起点：'+(last.sample_start??'未知'),
 '配置已验证：否','可用于推断：否',
 'TTL：'+last.ttl_ms+' ms；重放新鲜度未知'
 ].join('\n'):'无观测';
 const tail=rows.slice(-500),values=tail.map(r=>r.rms_dbfs).filter(v=>v!==null);
 const low=Math.min(...values),high=Math.max(...values),span=high-low||1;
 $('chart').replaceChildren();
 let path='';
 tail.forEach((r,i)=>{
  if(r.rms_dbfs===null){path+=' ';return;}
  const x=20+i*960/Math.max(1,tail.length-1),y=220-200*(r.rms_dbfs-low)/span;
  path+=(i===0||tail[i-1].rms_dbfs===null?'M':'L')+x+','+y+' ';
  if(r.missing_samples){const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r',4);dot.setAttribute('fill','#ffb66c');$('chart').append(dot);}
 });
 const line=document.createElementNS(ns,'path');line.setAttribute('d',path);line.setAttribute('fill','none');line.setAttribute('stroke','#71e7db');line.setAttribute('stroke-width',2);$('chart').prepend(line);
 $('range').textContent=values.length?'范围 '+low.toFixed(2)+' 至 '+high.toFixed(2)+' dBFS · '+tail.length+' 条最新记录':'无 RMS 观测';
 $('chart').setAttribute('aria-label',$('range').textContent);
}
$('demo').onclick=()=>{generation++;render(M.demo());$('status').textContent='已加载合成演示数据。不含任何硬件证据。';};
$('clear').onclick=()=>{generation++;render([]);$('file').value='';$('status').textContent='已清空。未保留任何观测。';};
$('file').onchange=async()=>{
 const ticket=++generation,file=$('file').files[0];if(!file)return;
 try{
  if(file.size>M.MAX_BYTES)throw Error('文件超过 10 MiB');
  const rows=M.parse(await file.text());if(ticket!==generation)return;
  render(rows);$('status').textContent='已导入 '+rows.length+' 条记录。来源标签属于未经核实的声明；此为文件重放。';
 }catch(e){if(ticket!==generation)return;render([]);$('status').textContent='导入被拒绝：'+e.message;}
};
