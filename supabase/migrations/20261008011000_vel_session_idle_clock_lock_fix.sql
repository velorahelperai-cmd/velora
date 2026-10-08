create or replace function public.check_app_session(p_touch boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid; created timestamptz; activity private.app_session_activity%rowtype; current_time_at timestamptz:=clock_timestamp();
begin
 if uid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end;
 if sid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 select created_at into created from auth.sessions where id=sid and user_id=uid;
 if not found then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 insert into private.app_session_activity(session_id,user_id,last_activity_at) values(sid,uid,least(created,clock_timestamp())) on conflict do nothing;
 select * into activity from private.app_session_activity where session_id=sid and user_id=uid for update;
 -- Read the clock after the lock: a concurrent touch may have advanced last_activity_at.
 current_time_at:=clock_timestamp();
 if not found or activity.expired_at is not null or activity.last_activity_at>current_time_at or current_time_at-activity.last_activity_at>=interval '2 hours' then
  update private.app_session_activity set expired_at=coalesce(expired_at,current_time_at) where session_id=sid and user_id=uid;
  return jsonb_build_object('ok',false,'code','SESSION_EXPIRED');
 end if;
 if p_touch then
  update private.app_session_activity set last_activity_at=current_time_at where session_id=sid;
  activity.last_activity_at:=current_time_at;
 end if;
 return jsonb_build_object('ok',true,'expires_at',activity.last_activity_at+interval '2 hours');
end;$$;
