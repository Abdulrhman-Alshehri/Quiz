-- NPS Live Quiz: question bank history and bank import.
--
-- The app never deletes data. Importing a new bank retires questions that are
-- no longer in it (retired_at is set) instead of deleting them, so the bank keeps
-- a change history. Sessions keep their own snapshot of the questions, so an
-- import never changes a session that already exists.

alter table public.bank_chapters  add column if not exists retired_at timestamptz;
alter table public.bank_questions add column if not exists retired_at timestamptz;

-- Original duration per question, so a session-wide duration override can be undone.
alter table public.session_questions add column if not exists default_duration_seconds int;

-- Retired questions are parked on unique negative positions so they never clash
-- with the active positions 1..5 inside a chapter.
create sequence if not exists app_private.bank_retire_seq;

create or replace function app_private.import_bank(p_bank jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_ch  jsonb;
  v_q   jsonb;
  v_ci  int := 0;
  v_qi  int;
  v_cids text[] := '{}';
  v_qids text[] := '{}';
  v_oids text[];
  v_retired int;
begin
  -- 1. Validate the whole file before changing anything.
  if p_bank is null or jsonb_typeof(p_bank->'chapters') is distinct from 'array' then
    raise exception 'BANK_INVALID:"chapters" must be an array';
  end if;
  if jsonb_array_length(p_bank->'chapters') <> 4 then
    raise exception 'BANK_INVALID:exactly 4 chapters are required';
  end if;

  for v_ch in select value from jsonb_array_elements(p_bank->'chapters') loop
    v_ci := v_ci + 1;
    if coalesce(v_ch->>'id', '') !~ '^[a-z0-9_-]{1,40}$' then
      raise exception 'BANK_INVALID:chapter % id must use a-z, 0-9, - or _', v_ci;
    end if;
    if (v_ch->>'id') = any(v_cids) then
      raise exception 'BANK_INVALID:duplicate chapter id %', v_ch->>'id';
    end if;
    v_cids := v_cids || (v_ch->>'id');
    if coalesce(trim(v_ch->>'title'), '') = '' or char_length(v_ch->>'title') > 120 then
      raise exception 'BANK_INVALID:chapter % needs a title (max 120 characters)', v_ci;
    end if;
    if char_length(coalesce(v_ch->>'description', '')) > 300 then
      raise exception 'BANK_INVALID:chapter % description is longer than 300 characters', v_ci;
    end if;
    if jsonb_typeof(v_ch->'questions') is distinct from 'array' or jsonb_array_length(v_ch->'questions') <> 5 then
      raise exception 'BANK_INVALID:chapter % must have exactly 5 questions', v_ci;
    end if;
    v_qi := 0;
    for v_q in select value from jsonb_array_elements(v_ch->'questions') loop
      v_qi := v_qi + 1;
      if coalesce(v_q->>'id', '') !~ '^[a-z0-9_-]{1,60}$' then
        raise exception 'BANK_INVALID:chapter % question % id must use a-z, 0-9, - or _', v_ci, v_qi;
      end if;
      if (v_q->>'id') = any(v_qids) then
        raise exception 'BANK_INVALID:duplicate question id %', v_q->>'id';
      end if;
      v_qids := v_qids || (v_q->>'id');
      if coalesce(trim(v_q->>'text'), '') = '' or char_length(v_q->>'text') > 300 then
        raise exception 'BANK_INVALID:question % needs text (max 300 characters)', v_q->>'id';
      end if;
      if jsonb_typeof(v_q->'options') is distinct from 'array' or jsonb_array_length(v_q->'options') <> 4 then
        raise exception 'BANK_INVALID:question % needs exactly 4 options', v_q->>'id';
      end if;
      select array_agg(o.value->>'id' order by o.ord) into v_oids
      from jsonb_array_elements(v_q->'options') with ordinality as o(value, ord);
      if v_oids is distinct from array['A','B','C','D'] then
        raise exception 'BANK_INVALID:question % option ids must be A, B, C, D in order', v_q->>'id';
      end if;
      if exists (select 1 from jsonb_array_elements(v_q->'options') o
                 where coalesce(trim(o.value->>'text'), '') = '' or char_length(o.value->>'text') > 120) then
        raise exception 'BANK_INVALID:question % has an empty or too long option (max 120 characters)', v_q->>'id';
      end if;
      if coalesce(v_q->>'correctOptionId', '') not in ('A','B','C','D') then
        raise exception 'BANK_INVALID:question % correctOptionId must be A, B, C or D', v_q->>'id';
      end if;
      if v_q ? 'durationSeconds' and jsonb_typeof(v_q->'durationSeconds') <> 'null'
         and ((v_q->>'durationSeconds')::int < 5 or (v_q->>'durationSeconds')::int > 120) then
        raise exception 'BANK_INVALID:question % durationSeconds must be 5 to 120', v_q->>'id';
      end if;
      if char_length(coalesce(v_q->>'explanation', '')) > 400 then
        raise exception 'BANK_INVALID:question % explanation is longer than 400 characters', v_q->>'id';
      end if;
    end loop;
  end loop;

  -- 2. Park every active question on a unique negative position.
  update public.bank_questions
     set sort_order = -(nextval('app_private.bank_retire_seq'))::int
   where retired_at is null;

  -- 3. Upsert the new chapters and questions (re-activating any that were retired).
  v_ci := 0;
  for v_ch in select value from jsonb_array_elements(p_bank->'chapters') loop
    v_ci := v_ci + 1;
    insert into public.bank_chapters (id, title, description, sort_order, retired_at, updated_at)
    values (v_ch->>'id', trim(v_ch->>'title'), coalesce(trim(v_ch->>'description'), ''), v_ci, null, now())
    on conflict (id) do update
      set title = excluded.title, description = excluded.description,
          sort_order = excluded.sort_order, retired_at = null, updated_at = now();

    v_qi := 0;
    for v_q in select value from jsonb_array_elements(v_ch->'questions') loop
      v_qi := v_qi + 1;
      insert into public.bank_questions (id, chapter_id, sort_order, question_text, options,
                                         correct_option_id, explanation, duration_seconds,
                                         source_ref, retired_at, updated_at)
      values (
        v_q->>'id', v_ch->>'id', v_qi, trim(v_q->>'text'),
        (select jsonb_agg(jsonb_build_object('id', o.value->>'id', 'text', trim(o.value->>'text')) order by o.ord)
           from jsonb_array_elements(v_q->'options') with ordinality as o(value, ord)),
        v_q->>'correctOptionId',
        coalesce(trim(v_q->>'explanation'), ''),
        coalesce(nullif(v_q->>'durationSeconds', '')::int, 20),
        coalesce(v_q->>'sourceRef', ''),
        null, now())
      on conflict (id) do update
        set chapter_id = excluded.chapter_id, sort_order = excluded.sort_order,
            question_text = excluded.question_text, options = excluded.options,
            correct_option_id = excluded.correct_option_id, explanation = excluded.explanation,
            duration_seconds = excluded.duration_seconds, source_ref = excluded.source_ref,
            retired_at = null, updated_at = now();
    end loop;
  end loop;

  -- 4. Retire whatever is not in this import.
  update public.bank_questions set retired_at = now(), updated_at = now()
   where retired_at is null and not (id = any(v_qids));
  get diagnostics v_retired = row_count;
  update public.bank_chapters set retired_at = now(), updated_at = now()
   where retired_at is null and not (id = any(v_cids));

  return jsonb_build_object('chapters', 4, 'questions', 20,
                            'retiredQuestions', v_retired,
                            'bankVersion', p_bank->>'bankVersion');
end $$;

revoke execute on all functions in schema app_private from public;
