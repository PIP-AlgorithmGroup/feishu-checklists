create table if not exists public.checklists (
  id text primary key,
  title text not null,
  open_message_id text,
  open_chat_id text,
  version integer not null default 1,
  items jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.callback_events (
  event_id text primary key,
  checklist_id text not null references public.checklists(id),
  item_id text not null,
  checked boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists callback_events_checklist_id_idx
  on public.callback_events(checklist_id);

create or replace function public.create_checklist(
  p_id text,
  p_title text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checklist public.checklists%rowtype;
begin
  insert into public.checklists (id, title, items)
  values (p_id, p_title, p_items)
  on conflict (id) do nothing;

  select * into strict v_checklist
    from public.checklists
   where id = p_id;

  return jsonb_build_object(
    'id', v_checklist.id,
    'title', v_checklist.title,
    'version', v_checklist.version,
    'items', v_checklist.items
  );
end;
$$;

create or replace function public.apply_checklist_event(
  p_event_id text,
  p_checklist_id text,
  p_item_id text,
  p_checked boolean,
  p_open_message_id text,
  p_open_chat_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checklist public.checklists%rowtype;
  v_items jsonb;
  v_inserted_event text;
begin
  if p_open_message_id is null or p_open_chat_id is null then
    raise exception '回调缺少消息或会话标识';
  end if;

  select * into v_checklist
    from public.checklists
   where id = p_checklist_id
   for update;

  if not found then
    raise exception '清单不存在';
  end if;

  if v_checklist.open_message_id is null and v_checklist.open_chat_id is null then
    update public.checklists
       set open_message_id = p_open_message_id,
           open_chat_id = p_open_chat_id,
           updated_at = now()
     where id = p_checklist_id
    returning * into v_checklist;
  end if;

  if v_checklist.open_message_id is distinct from p_open_message_id
     or v_checklist.open_chat_id is distinct from p_open_chat_id then
    raise exception '回调消息或会话与清单不匹配';
  end if;

  insert into public.callback_events (
    event_id, checklist_id, item_id, checked
  ) values (
    p_event_id, p_checklist_id, p_item_id, p_checked
  ) on conflict (event_id) do nothing
  returning event_id into v_inserted_event;

  if v_inserted_event is null then
    return jsonb_build_object(
      'duplicate', true,
      'checklist', jsonb_build_object(
        'id', v_checklist.id,
        'title', v_checklist.title,
        'version', v_checklist.version,
        'items', v_checklist.items
      )
    );
  end if;

  if not exists (
    select 1
      from jsonb_array_elements(v_checklist.items) as item
     where item->>'id' = p_item_id
  ) then
    raise exception '事项不存在';
  end if;

  select jsonb_agg(
    case
      when item->>'id' = p_item_id
      then jsonb_set(item, '{checked}', to_jsonb(p_checked), true)
      else item
    end
    order by position
  ) into v_items
  from jsonb_array_elements(v_checklist.items) with ordinality as entries(item, position);

  update public.checklists
     set items = v_items,
         version = version + 1,
         updated_at = now()
   where id = p_checklist_id
  returning * into v_checklist;

  return jsonb_build_object(
    'duplicate', false,
    'checklist', jsonb_build_object(
      'id', v_checklist.id,
      'title', v_checklist.title,
      'version', v_checklist.version,
      'items', v_checklist.items
    )
  );
end;
$$;
