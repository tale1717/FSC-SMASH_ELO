import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handle} from './worker.mjs';
export function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { return sqlite.prepare(sql).get(...args) || null; },
            async all() { return {results: sqlite.prepare(sql).all(...args)}; },
            async run() { const r=sqlite.prepare(sql).run(...args); return {meta:{changes:Number(r.changes)}}; }
          };
        }
      };
    }
  };
  const env={MATCH_DB:db,FIREBASE_WEB_API_KEY:'test',OWNER_UID:'owner',CHALLONGE_API_KEY:'test-challonge'};
  const now=Date.now()/1000;const token='x.'+Buffer.from(JSON.stringify({aud:'fsc-smash-elo',iss:'https://securetoken.google.com/fsc-smash-elo',sub:'owner',iat:now-10,exp:now+3600,auth_time:now-10,firebase:{sign_in_provider:'google.com'}})).toString('base64url')+'.x';
  const flags={};
  const upstream=async(url,options)=>{
    if(url.startsWith('https://firestore.googleapis.com/'))return Response.json({fields:{events:{mapValue:{fields:Object.fromEntries(Object.entries(flags).map(([k,v])=>[k,{booleanValue:v}]))}}}});
    if(url.includes('identitytoolkit'))return Response.json({users:[{localId:'owner'}]});
    if(options.method!=='GET')throw Error('Unexpected Challonge write');const u=new URL(url);let data=[];
    if(u.searchParams.get('page')==='1'){
      if(u.pathname.endsWith('/tournaments.json'))data=[{type:'tournament',id:'123',attributes:{name:'FSC Test Bracket',url:'test-slug',game_name:'Super Smash Bros. Ultimate',state:'underway'}}];
      if(u.pathname.endsWith('/participants.json'))data=['Alice','Bob','Carol','Dave'].map((name,i)=>({type:'participant',id:String(i+1),attributes:{name}}));
      if(u.pathname.endsWith('/matches.json'))data=[0,1].map(i=>({type:'match',id:String(50+i),attributes:{state:'open',round:1,identifier:String(i+1),relationships:{player1:{data:{id:String(1+i*2)}},player2:{data:{id:String(2+i*2)}}}}}));
    }return Response.json({data});
  };
  const send=async(path,body,bearer=token)=>handle(new Request('https://api.example'+path,{method:body?'POST':'GET',headers:{Origin:'https://fsc-smash-elo.web.app',Authorization:'Bearer '+bearer,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,upstream);
  const create=async(match='50')=>{const r=await send('/rooms',{tournament:'123',match,bestOf:3});if(r.status!==201)throw Error(JSON.stringify(await r.json()));return r.json()};
  return {flags,env,token,upstream,send,create,sqlite};
}
