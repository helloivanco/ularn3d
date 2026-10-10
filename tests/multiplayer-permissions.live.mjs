/** Opt-in real service check: node tests/multiplayer-permissions.live.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { APP_VERSION } from '../scripts/app-version.mjs';
const values=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(s=>s.includes('=')&&!s.startsWith('#')).map(s=>{const i=s.indexOf('=');return[s.slice(0,i).trim(),s.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const make=()=>createClient(values.VITE_SUPABASE_URL,values.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const clients=[make(),make(),make(),make()];const [host,player,watcher,stranger]=clients;let roomId;let checks=0;
const rpc=async(c,name,args)=>{const r=await c.rpc(name,args);if(r.error)throw r.error;return r.data;};
const check=(value, expected)=>{assert.deepEqual(value,expected);checks++;};
try{
for(let i=0;i<clients.length;i++){const r=await clients[i].auth.signInAnonymously();if(r.error)throw r.error;await rpc(clients[i],'set_display_name',{p_display_name:['RoleHost','RolePlayer','RoleWatch','RoleOther'][i]});}
const created=await rpc(host,'create_room_as',{p_display_name:'RoleHost',p_password:'secret',p_is_public:false,p_max_players:2,p_turn_timer_s:0,p_character_class:'Adventurer'});assert.equal(created.ok,true);roomId=created.room_id;
const join=(c,role,password='secret')=>rpc(c,'join_room_as',{p_code:created.join_code,p_password:password,p_role:role,p_character_class:'Wizard'});
check((await join(player,'player','wrong')).error,'bad_password');check((await join(player,'player')).role,'player');check((await join(watcher,'spectator')).role,'spectator');check((await join(stranger,'player')).error,'room_full');
check((await rpc(host,'start_room',{p_room_id:roomId,p_engine_version:APP_VERSION,p_difficulty:0})).error,'not_ready');
check((await rpc(player,'start_room',{p_room_id:roomId,p_engine_version:APP_VERSION,p_difficulty:0})).error,'not_host');
check((await rpc(watcher,'set_ready',{p_room_id:roomId,p_ready:true})).error,'not_player');
for(const c of [host,player])check((await rpc(c,'set_ready',{p_room_id:roomId,p_ready:true})).ok,true);
const run=await rpc(host,'start_room',{p_room_id:roomId,p_engine_version:APP_VERSION,p_difficulty:1});check(run.ok,true);const repeated=await rpc(host,'start_room',{p_room_id:roomId,p_engine_version:APP_VERSION,p_difficulty:1});check(repeated.run_id,run.run_id);
check((await rpc(host,'sync_room',{p_room_id:roomId,p_after:0})).room.game_config.version,2);
const key=randomUUID();const sent=await rpc(player,'send_room_action',{p_room_id:roomId,p_request_id:key,p_input:'right'});check(sent.action.actor,1);check((await rpc(player,'send_room_action',{p_room_id:roomId,p_request_id:key,p_input:'right'})).action.seq,sent.action.seq);
check((await rpc(watcher,'send_room_action',{p_room_id:roomId,p_request_id:randomUUID(),p_input:'right'})).error,'spectator');
check((await rpc(stranger,'sync_room',{p_room_id:roomId,p_after:0})).error,'not_member');
check((await stranger.from('room_actions').select('seq').eq('room_id',roomId)).data,[]);
check((await player.from('room_members').update({role:'host'}).eq('room_id',roomId)).status,403);
check((await player.from('room_actions').insert({room_id:roomId,seq:999,user_id:randomUUID(),actor:0,kind:'key',input:'right',name:'fake',character_class:'Adventurer'})).status,403);
check((await rpc(host,'kick_member',{p_room_id:roomId,p_user_id:(await watcher.auth.getSession()).data.session.user.id})).ok,true);
check((await rpc(watcher,'sync_room',{p_room_id:roomId,p_after:0})).error,'not_member');
check((await rpc(watcher,'post_chat',{p_room_id:roomId,p_channel:'spectators',p_body:'after kick'})).error,'not_member');
check((await rpc(player,'transfer_host',{p_room_id:roomId,p_user_id:(await host.auth.getSession()).data.session.user.id})).error,'not_host');
check((await rpc(host,'leave_room',{p_room_id:roomId})).ok,true);
check((await host.from('room_actions').select('seq').eq('room_id',roomId)).data,[]);
const state=await rpc(player,'sync_room',{p_room_id:roomId,p_after:0});check(state.members.find(m=>m.userId===(state.room.host_user_id)).role,'host');
check((await join(host,'player')).resumed,true);
const rejoined=await rpc(host,'sync_room',{p_room_id:roomId,p_after:0});check(rejoined.actions.at(-1).kind,'resume');
console.log(JSON.stringify({ok:true,checks,room_id:roomId,run_id:run.run_id}));
}catch(e){console.error(e.message||e);process.exitCode=1;}
finally{for(const c of clients){if(roomId)await c.rpc('leave_room',{p_room_id:roomId});await c.auth.signOut();}}
