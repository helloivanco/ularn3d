-- Disambiguate the membership record from the query alias.
create or replace function private.join_room_checked(p_code text,p_password text default null,p_role text default 'player',p_character_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare joined jsonb; rid uuid; m public.room_members; picked text; previous public.room_members;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  perform 1 from public.rooms where join_code=upper(btrim(p_code)) for update;
  select previous_member.* into previous from public.room_members previous_member join public.rooms r on r.id=previous_member.room_id where r.join_code=upper(btrim(p_code)) and previous_member.user_id=auth.uid();
  perform private.expire_rejoin(p_code);
  joined := private.join_room(p_code,p_password,p_role,p_character_name);
  if joined->>'ok' <> 'true' then return joined; end if;
  rid := (joined->>'room_id')::uuid;
  picked := coalesce(nullif(current_setting('ularn.character',true),''),'Adventurer');
  if previous.user_id is not null and previous.last_seen < now()-interval '120 seconds' then
    joined:=jsonb_set(joined,'{resumed}','false'::jsonb);
    update public.room_members set character_name=(select display_name from public.profiles where user_id=auth.uid()) where room_id=rid and user_id=auth.uid();
  end if;
  if joined->>'resumed'='false' then
    update public.room_members set character_class=picked where room_id=rid and user_id=auth.uid();
    select * into m from public.room_members where room_id=rid and user_id=auth.uid();
    if m.role <> 'spectator' and exists(select 1 from public.rooms where id=rid and status='playing') then
      perform private.append_room_event(rid,auth.uid(),'join',null);
    end if;
  elsif previous.connected=false and previous.role <> 'spectator' and exists(select 1 from public.rooms where id=rid and status='playing') then
    perform private.append_room_event(rid,auth.uid(),'resume',null);
  end if;
  return joined;
end;
$fn$;
notify pgrst, 'reload schema';
