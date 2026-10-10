import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const values=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(line=>line.includes('=')&&!line.startsWith('#')).map(line=>{const i=line.indexOf('=');return[line.slice(0,i).trim(),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const clients=Array.from({length:2},()=>createClient(values.VITE_SUPABASE_URL,values.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}));let id;
const rpc=async(c,name,args)=>{const r=await c.rpc(name,args);if(r.error)throw r.error;assert.equal(r.data.ok,true,name);return r.data;};
try{
for(let i=0;i<2;i++){const auth=await clients[i].auth.signInAnonymously();if(auth.error)throw auth.error;await rpc(clients[i],'set_display_name',{p_display_name:i?'ScoreAlly':'ScoreHost'});}
const room=await rpc(clients[0],'create_room_as',{p_display_name:'ScoreHost',p_password:null,p_is_public:false,p_max_players:2,p_turn_timer_s:0,p_character_class:'Adventurer'});id=room.room_id;
await rpc(clients[1],'join_room_as',{p_code:room.join_code,p_password:null,p_role:'player',p_character_class:'Wizard'});
for(const c of clients)await rpc(c,'set_ready',{p_room_id:id,p_ready:true});const run=await rpc(clients[0],'start_room',{p_room_id:id,p_engine_version:'1.3.75',p_difficulty:0});
for(const c of clients)for(const input of ['Q','y'])await rpc(c,'send_room_action',{p_room_id:id,p_request_id:randomUUID(),p_input:input});
await rpc(clients[0],'finish_room',{p_room_id:id});
const result=await clients[0].functions.invoke('submit-score',{body:{run_id:run.run_id,log:[],score:999999}});if(result.error)throw new Error(result.error.message+' '+JSON.stringify(result.data));console.log(JSON.stringify({room_id:id,run_id:run.run_id,result:result.data}));assert.equal(result.data.verified,true);assert.notEqual(result.data.score,999999);
}catch(error){console.error(error.message||error);process.exitCode=1;}
finally{for(const c of clients){if(id)await c.rpc('leave_room',{p_room_id:id});await c.auth.signOut();}}
