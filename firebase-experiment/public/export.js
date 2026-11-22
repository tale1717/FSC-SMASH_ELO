import { readDashboard } from './common.js';
import { csv, exportRows } from './csv.js';
const $=id=>document.getElementById(id);let data;
async function load(force=false){$('download-csv').disabled=true;$('refresh-export').disabled=true;try{data=await readDashboard(force);if(!data)throw Error('No saved results found.');$('export-tournament').replaceChildren(new Option('All tournaments',''),...data.tournaments.slice().reverse().map(t=>new Option(t.name,t.id)));$('export-status').textContent='Snapshot updated '+new Date(data.updatedAt).toLocaleString()+'.';$('download-csv').disabled=false}catch(e){$('export-status').textContent=e.message}finally{$('refresh-export').disabled=false}}
$('download-csv').addEventListener('click',()=>{if(!data)return;const kind=$('export-kind').value,tid=$('export-tournament').value;const url=URL.createObjectURL(new Blob([csv(exportRows(data,kind,tid))],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='fsc-smash-'+kind+(tid?'-'+tid.replace(/[^a-z0-9-]/gi,'_'):'')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
$('refresh-export').addEventListener('click',()=>load(true));
$('export-kind').addEventListener('change',()=>{$('export-tournament').disabled=['rankings','official'].includes($('export-kind').value)});$('export-tournament').disabled=true;load();
