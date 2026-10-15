-- NPS Live Quiz: question types, a flexible bank, and editing in the presenter console.
--
-- * Types: single (one right answer), multiple (several right answers, scored
--   all or nothing: points only for exactly the right set) and true_false
--   (fixed options صح / خطأ).
-- * 2 to 6 options per question (ids A-F, in order); right answers are a list.
-- * 1 to 10 chapters, each with 1 to 10 questions. Chapters and questions are
--   added, edited, reordered, retired and restored one at a time. Every change
--   is logged in app_private.bank_changes, so an edit can be reviewed and undone.
-- * Sessions still copy the bank when they are created: editing never changes
--   a session that already exists.
-- * Clients built before this change keep working: every response still carries
--   correctOptionId / selectedOptionId (the first id), and submit_answer still
--   accepts p_option_id.

-- ===========================================================================
-- Rules and validation
-- ===========================================================================
create or replace function app_private.bank_limits()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'maxChapters', 10, 'maxQuestionsPerChapter', 10,
    'minOptions', 2, 'maxOptions', 6, 'minOptionsMultiple', 3,
    'maxTitle', 120, 'maxDescription', 300, 'maxText', 300, 'maxOption', 120,
    'maxExplanation', 400, 'maxSourceRef', 200,
    'minSeconds', 5, 'maxSeconds', 120,
    'defaultSeconds', jsonb_build_object('single', 20, 'multiple', 30, 'true_false', 20),
    'trueFalseOptions', jsonb_build_array('صح', 'خطأ'))
$$;

-- What is wrong with a question's type, options and right answers (Arabic, shown
-- to the presenter), or null when it is valid. Also used as a table check.
create or replace function app_private.question_problem(p_type text, p_options jsonb, p_correct text[])
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_letters constant text[] := array['A', 'B', 'C', 'D', 'E', 'F'];
  v_n     int;
  v_ids   text[];
  v_texts text[];
begin
  if p_type is null or p_type not in ('single', 'multiple', 'true_false') then
    return 'نوع السؤال غير معروف';
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    return 'الخيارات يجب أن تكون قائمة';
  end if;
  v_n := jsonb_array_length(p_options);
  if v_n < 2 or v_n > 6 then
    return 'يحتاج السؤال من خيارين إلى 6 خيارات';
  end if;
  if exists (select 1 from jsonb_array_elements(p_options) as o(value)
             where jsonb_typeof(o.value) <> 'object'
                or jsonb_typeof(o.value->'text') is distinct from 'string'
                or trim(o.value->>'text') = ''
                or char_length(o.value->>'text') > 120) then
    return 'كل خيار يحتاج نصًا لا يزيد على 120 حرفًا';
  end if;
  select array_agg(o.value->>'id' order by o.ord), array_agg(lower(trim(o.value->>'text')) order by o.ord)
    into v_ids, v_texts
  from jsonb_array_elements(p_options) with ordinality as o(value, ord);
  if v_ids is distinct from v_letters[1:v_n] then
    return 'معرّفات الخيارات يجب أن تكون A وB وC… بالترتيب';
  end if;
  if (select count(distinct t.x) from unnest(v_texts) as t(x)) <> v_n then
    return 'خياران لهما النص نفسه';
  end if;
  if p_correct is null or cardinality(p_correct) = 0 then
    return 'حدّد الإجابة الصحيحة';
  end if;
  if exists (select 1 from unnest(p_correct) as c(x) where c.x is null or not (c.x = any (v_ids))) then
    return 'إحدى الإجابات الصحيحة ليست من الخيارات';
  end if;
  if (select count(distinct c.x) from unnest(p_correct) as c(x)) <> cardinality(p_correct) then
    return 'إجابة صحيحة مكررة';
  end if;
  if p_type = 'single' and cardinality(p_correct) <> 1 then
    return 'سؤال الاختيار الواحد له إجابة صحيحة واحدة فقط';
  end if;
  if p_type = 'true_false' then
    if v_n <> 2 or p_options->0->>'text' <> 'صح' or p_options->1->>'text' <> 'خطأ' then
      return 'خيارا سؤال الصح والخطأ هما «صح» و«خطأ»';
    end if;
    if cardinality(p_correct) <> 1 then
      return 'سؤال الصح والخطأ له إجابة صحيحة واحدة';
    end if;
  end if;
  if p_type = 'multiple' then
    if v_n < 3 then
      return 'سؤال الاختيار المتعدد يحتاج 3 خيارات على الأقل';
    end if;
    if cardinality(p_correct) < 2 then
      return 'سؤال الاختيار المتعدد يحتاج إجابتين صحيحتين على الأقل';
    end if;
  end if;
  return null;
end $$;

-- Turns editor or import JSON into a clean question, or raises QUESTION_INVALID:<reason>.
-- Accepts the older file format (correctOptionId, no type) as a single-choice question.
create or replace function app_private.prepare_question(p_q jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_type    text;
  v_text    text;
  v_options jsonb;
  v_correct text[];
  v_expl    text;
  v_ref     text;
  v_secs    int;
  v_problem text;
begin
  if p_q is null or jsonb_typeof(p_q) <> 'object' then
    raise exception 'QUESTION_INVALID:بيانات السؤال غير صالحة';
  end if;
  v_type := coalesce(nullif(trim(p_q->>'type'), ''), 'single');
  if v_type not in ('single', 'multiple', 'true_false') then
    raise exception 'QUESTION_INVALID:نوع السؤال غير معروف';
  end if;
  v_text := trim(coalesce(p_q->>'text', ''));
  if v_text = '' then
    raise exception 'QUESTION_INVALID:اكتب نص السؤال';
  end if;
  if char_length(v_text) > 300 then
    raise exception 'QUESTION_INVALID:نص السؤال أطول من 300 حرف';
  end if;
  v_expl := trim(coalesce(p_q->>'explanation', ''));
  if char_length(v_expl) > 400 then
    raise exception 'QUESTION_INVALID:التوضيح أطول من 400 حرف';
  end if;
  v_ref := trim(coalesce(p_q->>'sourceRef', ''));
  if char_length(v_ref) > 200 then
    raise exception 'QUESTION_INVALID:المرجع أطول من 200 حرف';
  end if;
  if jsonb_typeof(p_q->'durationSeconds') in ('number', 'string') then
    if (p_q->>'durationSeconds') !~ '^\d{1,3}$' then
      raise exception 'QUESTION_INVALID:مدة السؤال عدد صحيح من الثواني';
    end if;
    v_secs := (p_q->>'durationSeconds')::int;
    if v_secs < 5 or v_secs > 120 then
      raise exception 'QUESTION_INVALID:مدة السؤال من 5 إلى 120 ثانية';
    end if;
  else
    v_secs := case v_type when 'multiple' then 30 else 20 end;
  end if;

  if v_type = 'true_false' then
    v_options := jsonb_build_array(jsonb_build_object('id', 'A', 'text', 'صح'),
                                   jsonb_build_object('id', 'B', 'text', 'خطأ'));
  elsif jsonb_typeof(p_q->'options') = 'array' then
    select coalesce(jsonb_agg(case when jsonb_typeof(o.value) = 'object'
                                   then jsonb_build_object('id', o.value->>'id',
                                                           'text', trim(coalesce(o.value->>'text', '')))
                                   else o.value end
                              order by o.ord), '[]'::jsonb)
      into v_options
    from jsonb_array_elements(p_q->'options') with ordinality as o(value, ord);
  else
    raise exception 'QUESTION_INVALID:الخيارات يجب أن تكون قائمة';
  end if;

  if jsonb_typeof(p_q->'correctOptionIds') = 'array' then
    select array_agg(c.x order by c.x) into v_correct
    from jsonb_array_elements_text(p_q->'correctOptionIds') as c(x);
  elsif jsonb_typeof(p_q->'correctOptionId') = 'string' then
    v_correct := array[p_q->>'correctOptionId'];
  end if;

  v_problem := app_private.question_problem(v_type, v_options, v_correct);
  if v_problem is not null then
    raise exception 'QUESTION_INVALID:%', v_problem;
  end if;
  return jsonb_build_object('type', v_type, 'text', v_text, 'options', v_options,
                            'correctOptionIds', to_jsonb(v_correct), 'explanation', v_expl,
                            'durationSeconds', v_secs, 'sourceRef', v_ref);
end $$;

-- ===========================================================================
-- Schema
-- ===========================================================================
alter table public.bank_chapters
  add column if not exists revision   int not null default 1,
  add column if not exists created_at timestamptz not null default now();

alter table public.bank_questions
  add column if not exists question_type      text not null default 'single',
  add column if not exists correct_option_ids text[],
  add column if not exists revision           int not null default 1,
  add column if not exists created_at         timestamptz not null default now();
update public.bank_questions set correct_option_ids = array[correct_option_id] where correct_option_ids is null;
alter table public.bank_questions alter column correct_option_ids set not null;
alter table public.bank_questions drop constraint if exists bank_questions_options_check;
alter table public.bank_questions drop constraint if exists bank_questions_correct_option_id_check;
-- Kept as a read-only convenience (the first right answer) for anything that still reads it.
alter table public.bank_questions drop column correct_option_id;
alter table public.bank_questions
  add column correct_option_id text generated always as (correct_option_ids[1]) stored;
alter table public.bank_questions
  add constraint bank_questions_type_check check (question_type in ('single', 'multiple', 'true_false')),
  add constraint bank_questions_options_check
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  add constraint bank_questions_valid_check
    check (app_private.question_problem(question_type, options, correct_option_ids) is null),
  add constraint bank_questions_source_ref_check check (char_length(source_ref) <= 200);
-- Checked at the end of each statement, so one UPDATE can reorder a chapter.
alter table public.bank_questions drop constraint if exists bank_questions_chapter_id_sort_order_key;
alter table public.bank_questions
  add constraint bank_questions_chapter_id_sort_order_key
  unique (chapter_id, sort_order) deferrable initially immediate;

alter table public.session_questions
  add column if not exists question_type      text not null default 'single',
  add column if not exists correct_option_ids text[];
update public.session_questions set correct_option_ids = array[correct_option_id] where correct_option_ids is null;
alter table public.session_questions alter column correct_option_ids set not null;
alter table public.session_questions drop column correct_option_id;
alter table public.session_questions
  add column correct_option_id text generated always as (correct_option_ids[1]) stored;

alter table public.answers add column if not exists selected_option_ids text[];
update public.answers set selected_option_ids = array[selected_option_id]
 where selected_option_id is not null and selected_option_ids is null;
alter table public.answers drop column selected_option_id;
alter table public.answers
  add column selected_option_id text
  generated always as (case when cardinality(selected_option_ids) = 1 then selected_option_ids[1] end) stored;

-- Change log for the bank: one row per change, holding the state after it.
create table if not exists app_private.bank_changes (
  id         bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  entity     text not null check (entity in ('chapter', 'question')),
  entity_id  text not null,
  action     text not null check (action in ('created', 'updated', 'retired', 'restored', 'reverted', 'imported')),
  revision   int not null,
  snapshot   jsonb not null
);
create index if not exists bank_changes_entity_idx on app_private.bank_changes (entity, entity_id, id desc);

-- ===========================================================================
-- Bank helpers
-- ===========================================================================
create or replace function app_private.question_json(q public.bank_questions)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', q.id, 'chapterId', q.chapter_id, 'order', q.sort_order, 'type', q.question_type,
    'text', q.question_text, 'options', q.options, 'correctOptionIds', to_jsonb(q.correct_option_ids),
    'explanation', q.explanation, 'durationSeconds', q.duration_seconds, 'sourceRef', q.source_ref,
    'revision', q.revision, 'updatedAt', q.updated_at)
$$;

create or replace function app_private.chapter_json(c public.bank_chapters)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description,
                            'order', c.sort_order, 'revision', c.revision, 'updatedAt', c.updated_at)
$$;

create or replace function app_private.log_change(p_entity text, p_id text, p_action text)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_snapshot jsonb;
  v_revision int;
begin
  if p_entity = 'question' then
    select app_private.question_json(q) || jsonb_build_object('retired', q.retired_at is not null), q.revision
      into v_snapshot, v_revision
    from public.bank_questions q where q.id = p_id;
  else
    select app_private.chapter_json(c) || jsonb_build_object('retired', c.retired_at is not null), c.revision
      into v_snapshot, v_revision
    from public.bank_chapters c where c.id = p_id;
  end if;
  if v_snapshot is not null then
    insert into app_private.bank_changes (entity, entity_id, action, revision, snapshot)
    values (p_entity, p_id, p_action, v_revision, v_snapshot);
  end if;
end $$;

-- Active questions of a chapter numbered 1..n (retired ones sit on negative positions).
create or replace function app_private.compact_questions(p_chapter_id text)
returns void language sql volatile set search_path = '' as $$
  update public.bank_questions q set sort_order = r.pos
  from (select x.id, (row_number() over (order by x.sort_order, x.id))::int as pos
        from public.bank_questions x
        where x.chapter_id = p_chapter_id and x.retired_at is null) r
  where q.id = r.id and q.sort_order <> r.pos
$$;

create or replace function app_private.compact_chapters()
returns void language sql volatile set search_path = '' as $$
  update public.bank_chapters c set sort_order = r.pos
  from (select x.id, (row_number() over (order by x.sort_order, x.id))::int as pos
        from public.bank_chapters x where x.retired_at is null) r
  where c.id = r.id and c.sort_order <> r.pos
$$;

-- One writer at a time for bank changes, so positions and new ids never clash.
create or replace function app_private.lock_bank()
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(7311001)
$$;

-- Why a session cannot be created from the bank right now (Arabic), or null.
create or replace function app_private.bank_problem()
returns text language plpgsql stable set search_path = '' as $$
declare
  v_n     int;
  v_title text;
begin
  select count(*) into v_n from public.bank_chapters c where c.retired_at is null;
  if v_n = 0 then
    return 'لا توجد فصول في بنك الأسئلة.';
  end if;
  if v_n > 10 then
    return 'في بنك الأسئلة أكثر من 10 فصول.';
  end if;
  select c.title into v_title from public.bank_chapters c
  where c.retired_at is null
    and not exists (select 1 from public.bank_questions q where q.chapter_id = c.id and q.retired_at is null)
  order by c.sort_order limit 1;
  if v_title is not null then
    return format('الفصل «%s» لا يحتوي على أسئلة. أضف سؤالًا أو أوقف الفصل.', v_title);
  end if;
  select c.title into v_title from public.bank_chapters c
  where c.retired_at is null
    and (select count(*) from public.bank_questions q where q.chapter_id = c.id and q.retired_at is null) > 10
  order by c.sort_order limit 1;
  if v_title is not null then
    return format('في الفصل «%s» أكثر من 10 أسئلة.', v_title);
  end if;
  return null;
end $$;

-- ===========================================================================
-- Import (whole bank from a file). Old and new file formats are both accepted.
-- ===========================================================================
create or replace function app_private.import_bank(p_bank jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_ch       jsonb;
  v_q        jsonb;
  v_p        jsonb;
  v_ci       int := 0;
  v_qi       int;
  v_cids     text[] := '{}';
  v_qids     text[] := '{}';
  v_prepared jsonb[] := '{}';
  v_retired  int;
begin
  -- 1. Check the whole file before changing anything.
  if p_bank is null or jsonb_typeof(p_bank->'chapters') is distinct from 'array' then
    raise exception 'BANK_INVALID:لا يحتوي الملف على قائمة الفصول (chapters)';
  end if;
  if jsonb_array_length(p_bank->'chapters') not between 1 and 10 then
    raise exception 'BANK_INVALID:يحتاج البنك من فصل واحد إلى 10 فصول';
  end if;

  for v_ch in select value from jsonb_array_elements(p_bank->'chapters') loop
    v_ci := v_ci + 1;
    if jsonb_typeof(v_ch) <> 'object' or coalesce(v_ch->>'id', '') !~ '^[a-z0-9_-]{1,40}$' then
      raise exception 'BANK_INVALID:معرّف الفصل % يستخدم a-z و0-9 و- و_ فقط', v_ci;
    end if;
    if (v_ch->>'id') = any (v_cids) then
      raise exception 'BANK_INVALID:معرّف الفصل مكرر: %', v_ch->>'id';
    end if;
    v_cids := v_cids || (v_ch->>'id');
    if coalesce(trim(v_ch->>'title'), '') = '' or char_length(trim(v_ch->>'title')) > 120 then
      raise exception 'BANK_INVALID:الفصل % يحتاج عنوانًا من 120 حرفًا على الأكثر', v_ci;
    end if;
    if char_length(trim(coalesce(v_ch->>'description', ''))) > 300 then
      raise exception 'BANK_INVALID:وصف الفصل % أطول من 300 حرف', v_ci;
    end if;
    if jsonb_typeof(v_ch->'questions') is distinct from 'array'
       or jsonb_array_length(v_ch->'questions') not between 1 and 10 then
      raise exception 'BANK_INVALID:الفصل % يحتاج من سؤال واحد إلى 10 أسئلة', v_ci;
    end if;

    v_qi := 0;
    for v_q in select value from jsonb_array_elements(v_ch->'questions') loop
      v_qi := v_qi + 1;
      if jsonb_typeof(v_q) <> 'object' or coalesce(v_q->>'id', '') !~ '^[a-z0-9_-]{1,60}$' then
        raise exception 'BANK_INVALID:معرّف السؤال % في الفصل % يستخدم a-z و0-9 و- و_ فقط', v_qi, v_ci;
      end if;
      if (v_q->>'id') = any (v_qids) then
        raise exception 'BANK_INVALID:معرّف السؤال مكرر: %', v_q->>'id';
      end if;
      v_qids := v_qids || (v_q->>'id');
      begin
        v_p := app_private.prepare_question(v_q);
      exception when others then
        raise exception 'BANK_INVALID:السؤال % (%): %', v_qi, v_q->>'id', replace(sqlerrm, 'QUESTION_INVALID:', '');
      end;
      v_prepared := v_prepared || (v_p || jsonb_build_object('id', v_q->>'id', 'chapterId', v_ch->>'id', 'order', v_qi));
    end loop;
  end loop;

  perform app_private.lock_bank();

  -- 2. Park every active question on a unique negative position.
  update public.bank_questions
     set sort_order = -(nextval('app_private.bank_retire_seq'))::int
   where retired_at is null;

  -- 3. Add or update chapters and questions (re-activating retired ones).
  v_ci := 0;
  for v_ch in select value from jsonb_array_elements(p_bank->'chapters') loop
    v_ci := v_ci + 1;
    insert into public.bank_chapters (id, title, description, sort_order, retired_at, updated_at, revision)
    values (v_ch->>'id', trim(v_ch->>'title'), trim(coalesce(v_ch->>'description', '')), v_ci, null, now(), 1)
    on conflict (id) do update
      set title = excluded.title, description = excluded.description, sort_order = excluded.sort_order,
          retired_at = null, updated_at = now(), revision = public.bank_chapters.revision + 1;
    perform app_private.log_change('chapter', v_ch->>'id', 'imported');
  end loop;

  foreach v_p in array v_prepared loop
    insert into public.bank_questions (id, chapter_id, sort_order, question_type, question_text, options,
                                       correct_option_ids, explanation, duration_seconds, source_ref,
                                       retired_at, updated_at, revision)
    values (v_p->>'id', v_p->>'chapterId', (v_p->>'order')::int, v_p->>'type', v_p->>'text', v_p->'options',
            array(select jsonb_array_elements_text(v_p->'correctOptionIds')),
            v_p->>'explanation', (v_p->>'durationSeconds')::int, v_p->>'sourceRef', null, now(), 1)
    on conflict (id) do update
      set chapter_id = excluded.chapter_id, sort_order = excluded.sort_order,
          question_type = excluded.question_type, question_text = excluded.question_text,
          options = excluded.options, correct_option_ids = excluded.correct_option_ids,
          explanation = excluded.explanation, duration_seconds = excluded.duration_seconds,
          source_ref = excluded.source_ref, retired_at = null, updated_at = now(),
          revision = public.bank_questions.revision + 1;
    perform app_private.log_change('question', v_p->>'id', 'imported');
  end loop;

  -- 4. Retire whatever is not in this file.
  update public.bank_questions set retired_at = now(), updated_at = now()
   where retired_at is null and not (id = any (v_qids));
  get diagnostics v_retired = row_count;
  update public.bank_chapters set retired_at = now(), updated_at = now()
   where retired_at is null and not (id = any (v_cids));

  return jsonb_build_object('chapters', cardinality(v_cids), 'questions', cardinality(v_qids),
                            'retiredQuestions', v_retired, 'bankVersion', p_bank->>'bankVersion');
end $$;

-- ===========================================================================
-- Admin: read and edit the bank
-- ===========================================================================
create or replace function public.admin_get_bank(p_admin_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin(p_admin_token);
  return jsonb_build_object(
    'format', 2,
    'exportedAt', now(),
    'limits', app_private.bank_limits(),
    'problem', app_private.bank_problem(),
    'chapters', (select coalesce(jsonb_agg(app_private.chapter_json(c) || jsonb_build_object(
                   'questions', (select coalesce(jsonb_agg(app_private.question_json(q) order by q.sort_order), '[]'::jsonb)
                                 from public.bank_questions q
                                 where q.chapter_id = c.id and q.retired_at is null))
                 order by c.sort_order), '[]'::jsonb)
                 from public.bank_chapters c where c.retired_at is null),
    'retired', jsonb_build_object(
      'chapters', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', c.id, 'title', c.title, 'retiredAt', c.retired_at,
                     'questionCount', (select count(*) from public.bank_questions q
                                       where q.chapter_id = c.id and q.retired_at is null))
                   order by c.retired_at desc, c.id), '[]'::jsonb)
                   from public.bank_chapters c where c.retired_at is not null),
      'questions', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', q.id, 'chapterId', q.chapter_id, 'chapterTitle', c.title,
                      'chapterRetired', c.retired_at is not null, 'type', q.question_type,
                      'text', q.question_text, 'retiredAt', q.retired_at)
                    order by q.retired_at desc, q.id), '[]'::jsonb)
                    from public.bank_questions q join public.bank_chapters c on c.id = q.chapter_id
                    where q.retired_at is not null)));
end $$;

create or replace function public.admin_save_chapter(p_admin_token text, p_chapter jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id    text := nullif(trim(coalesce(p_chapter->>'id', '')), '');
  v_title text := trim(coalesce(p_chapter->>'title', ''));
  v_desc  text := trim(coalesce(p_chapter->>'description', ''));
  v_c     public.bank_chapters;
  v_n     int;
begin
  perform app_private.require_admin(p_admin_token);
  if v_title = '' then raise exception 'CHAPTER_INVALID:اكتب عنوان الفصل'; end if;
  if char_length(v_title) > 120 then raise exception 'CHAPTER_INVALID:عنوان الفصل أطول من 120 حرفًا'; end if;
  if char_length(v_desc) > 300 then raise exception 'CHAPTER_INVALID:وصف الفصل أطول من 300 حرف'; end if;
  perform app_private.lock_bank();

  if v_id is null then
    select count(*) into v_n from public.bank_chapters where retired_at is null;
    if v_n >= 10 then raise exception 'CHAPTER_LIMIT'; end if;
    select 'ch' || (coalesce(max((substring(x.id from '^ch(\d{1,6})$'))::int), 0) + 1)
      into v_id from public.bank_chapters x;
    insert into public.bank_chapters (id, title, description, sort_order, revision, updated_at)
    values (v_id, v_title, v_desc, v_n + 1, 1, now());
    perform app_private.log_change('chapter', v_id, 'created');
  else
    select * into v_c from public.bank_chapters where id = v_id for update;
    if not found then raise exception 'CHAPTER_NOT_FOUND'; end if;
    if v_c.retired_at is not null then raise exception 'CHAPTER_RETIRED'; end if;
    if jsonb_typeof(p_chapter->'expectedRevision') = 'number'
       and (p_chapter->>'expectedRevision')::int <> v_c.revision then
      raise exception 'BANK_CONFLICT';
    end if;
    if v_c.title is distinct from v_title or v_c.description is distinct from v_desc then
      update public.bank_chapters
         set title = v_title, description = v_desc, revision = revision + 1, updated_at = now()
       where id = v_id;
      perform app_private.log_change('chapter', v_id, 'updated');
    end if;
  end if;

  select * into v_c from public.bank_chapters where id = v_id;
  return app_private.chapter_json(v_c);
end $$;

create or replace function public.admin_retire_chapter(p_admin_token text, p_chapter_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c public.bank_chapters;
begin
  perform app_private.require_admin(p_admin_token);
  perform app_private.lock_bank();
  select * into v_c from public.bank_chapters where id = p_chapter_id for update;
  if not found then raise exception 'CHAPTER_NOT_FOUND'; end if;
  if v_c.retired_at is null then
    if (select count(*) from public.bank_chapters where retired_at is null) <= 1 then
      raise exception 'BANK_NEEDS_CHAPTER';
    end if;
    update public.bank_chapters
       set retired_at = now(), updated_at = now(), revision = revision + 1
     where id = p_chapter_id;
    perform app_private.compact_chapters();
    perform app_private.log_change('chapter', p_chapter_id, 'retired');
  end if;
  return jsonb_build_object('id', p_chapter_id, 'retired', true);
end $$;

create or replace function public.admin_restore_chapter(p_admin_token text, p_chapter_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c public.bank_chapters;
  v_n int;
begin
  perform app_private.require_admin(p_admin_token);
  perform app_private.lock_bank();
  select * into v_c from public.bank_chapters where id = p_chapter_id for update;
  if not found then raise exception 'CHAPTER_NOT_FOUND'; end if;
  if v_c.retired_at is not null then
    select count(*) into v_n from public.bank_chapters where retired_at is null;
    if v_n >= 10 then raise exception 'CHAPTER_LIMIT'; end if;
    update public.bank_chapters
       set retired_at = null, sort_order = v_n + 1, updated_at = now(), revision = revision + 1
     where id = p_chapter_id;
    perform app_private.log_change('chapter', p_chapter_id, 'restored');
  end if;
  select * into v_c from public.bank_chapters where id = p_chapter_id;
  return app_private.chapter_json(v_c);
end $$;

create or replace function public.admin_reorder_chapters(p_admin_token text, p_chapter_ids text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin(p_admin_token);
  perform app_private.lock_bank();
  if p_chapter_ids is null
     or cardinality(p_chapter_ids) <> (select count(distinct x.id) from unnest(p_chapter_ids) as x(id))
     or (select array_agg(c.id order by c.id) from public.bank_chapters c where c.retired_at is null)
        is distinct from (select array_agg(x.id order by x.id) from unnest(p_chapter_ids) as x(id)) then
    raise exception 'ORDER_MISMATCH';
  end if;
  update public.bank_chapters c set sort_order = o.pos::int, updated_at = now()
  from unnest(p_chapter_ids) with ordinality as o(id, pos)
  where c.id = o.id and c.sort_order <> o.pos;
end $$;

create or replace function public.admin_save_question(p_admin_token text, p_question jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p       jsonb;
  v_id      text := nullif(trim(coalesce(p_question->>'id', '')), '');
  v_chapter text := nullif(trim(coalesce(p_question->>'chapterId', '')), '');
  v_q       public.bank_questions;
  v_c       public.bank_chapters;
  v_n       int;
  v_correct text[];
  v_moved   boolean;
begin
  perform app_private.require_admin(p_admin_token);
  v_p := app_private.prepare_question(p_question);
  v_correct := array(select jsonb_array_elements_text(v_p->'correctOptionIds'));
  perform app_private.lock_bank();

  if v_id is null then
    select * into v_c from public.bank_chapters where id = v_chapter;
    if not found then raise exception 'CHAPTER_NOT_FOUND'; end if;
    if v_c.retired_at is not null then raise exception 'CHAPTER_RETIRED'; end if;
    select count(*) into v_n from public.bank_questions where chapter_id = v_chapter and retired_at is null;
    if v_n >= 10 then raise exception 'QUESTION_LIMIT'; end if;
    -- New id: <chapter id>-q<n>, one higher than any id with that prefix (retired ones included).
    select v_chapter || '-q' || (coalesce(max(substr(x.id, char_length(v_chapter) + 3)::int), 0) + 1)
      into v_id
    from public.bank_questions x
    where left(x.id, char_length(v_chapter) + 2) = v_chapter || '-q'
      and substr(x.id, char_length(v_chapter) + 3) ~ '^\d{1,6}$';
    insert into public.bank_questions (id, chapter_id, sort_order, question_type, question_text, options,
                                       correct_option_ids, explanation, duration_seconds, source_ref,
                                       revision, updated_at)
    values (v_id, v_chapter, v_n + 1, v_p->>'type', v_p->>'text', v_p->'options', v_correct,
            v_p->>'explanation', (v_p->>'durationSeconds')::int, v_p->>'sourceRef', 1, now());
    perform app_private.log_change('question', v_id, 'created');
  else
    select * into v_q from public.bank_questions where id = v_id for update;
    if not found then raise exception 'QUESTION_NOT_FOUND'; end if;
    if v_q.retired_at is not null then raise exception 'QUESTION_RETIRED'; end if;
    if jsonb_typeof(p_question->'expectedRevision') = 'number'
       and (p_question->>'expectedRevision')::int <> v_q.revision then
      raise exception 'BANK_CONFLICT';
    end if;
    v_chapter := coalesce(v_chapter, v_q.chapter_id);
    v_moved := v_chapter <> v_q.chapter_id;
    if v_moved then
      select * into v_c from public.bank_chapters where id = v_chapter;
      if not found then raise exception 'CHAPTER_NOT_FOUND'; end if;
      if v_c.retired_at is not null then raise exception 'CHAPTER_RETIRED'; end if;
      select count(*) into v_n from public.bank_questions where chapter_id = v_chapter and retired_at is null;
      if v_n >= 10 then raise exception 'QUESTION_LIMIT'; end if;
    end if;
    if v_moved
       or v_q.question_type is distinct from v_p->>'type'
       or v_q.question_text is distinct from v_p->>'text'
       or v_q.options is distinct from v_p->'options'
       or v_q.correct_option_ids is distinct from v_correct
       or v_q.explanation is distinct from v_p->>'explanation'
       or v_q.duration_seconds is distinct from (v_p->>'durationSeconds')::int
       or v_q.source_ref is distinct from v_p->>'sourceRef' then
      update public.bank_questions
         set chapter_id = v_chapter,
             sort_order = case when v_moved then v_n + 1 else sort_order end,
             question_type = v_p->>'type', question_text = v_p->>'text', options = v_p->'options',
             correct_option_ids = v_correct, explanation = v_p->>'explanation',
             duration_seconds = (v_p->>'durationSeconds')::int, source_ref = v_p->>'sourceRef',
             revision = revision + 1, updated_at = now()
       where id = v_id;
      if v_moved then
        perform app_private.compact_questions(v_q.chapter_id);
      end if;
      perform app_private.log_change('question', v_id, 'updated');
    end if;
  end if;

  select * into v_q from public.bank_questions where id = v_id;
  return app_private.question_json(v_q);
end $$;

create or replace function public.admin_retire_question(p_admin_token text, p_question_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_q public.bank_questions;
begin
  perform app_private.require_admin(p_admin_token);
  perform app_private.lock_bank();
  select * into v_q from public.bank_questions where id = p_question_id for update;
  if not found then raise exception 'QUESTION_NOT_FOUND'; end if;
  if v_q.retired_at is null then
    update public.bank_questions
       set retired_at = now(), updated_at = now(), revision = revision + 1,
           sort_order = -(nextval('app_private.bank_retire_seq'))::int
     where id = p_question_id;
    perform app_private.compact_questions(v_q.chapter_id);
    perform app_private.log_change('question', p_question_id, 'retired');
  end if;
  return jsonb_build_object('id', p_question_id, 'retired', true);
end $$;

create or replace function public.admin_restore_question(p_admin_token text, p_question_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_q public.bank_questions;
  v_c public.bank_chapters;
  v_n int;
begin
  perform app_private.require_admin(p_admin_token);
  perform app_private.lock_bank();
  select * into v_q from public.bank_questions where id = p_question_id for update;
  if not found then raise exception 'QUESTION_NOT_FOUND'; end if;
  if v_q.retired_at is not null then
    select * into v_c from public.bank_chapters where id = v_q.chapter_id;
    if v_c.retired_at is not null then raise exception 'CHAPTER_RETIRED'; end if;
    select count(*) into v_n from public.bank_questions where chapter_id = v_q.chapter_id and retired_at is null;
    if v_n >= 10 then raise exception 'QUESTION_LIMIT'; end if;
    update public.bank_questions
       set retired_at = null, sort_order = v_n + 1, updated_at = now(), revision = revision + 1
     where id = p_question_id;
    perform app_private.log_change('question', p_question_id, 'restored');
  end if;
  select * into v_q from public.bank_questions where id = p_question_id;
  return app_private.question_json(v_q);
end $$;

create or replace function public.admin_reorder_questions(p_admin_token text, p_chapter_id text, p_question_ids text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin(p_admin_token);
  perform app_private.lock_bank();
  if not exists (select 1 from public.bank_chapters c where c.id = p_chapter_id and c.retired_at is null) then
    raise exception 'CHAPTER_NOT_FOUND';
  end if;
  if p_question_ids is null
     or cardinality(p_question_ids) <> (select count(distinct x.id) from unnest(p_question_ids) as x(id))
     or (select array_agg(q.id order by q.id) from public.bank_questions q
         where q.chapter_id = p_chapter_id and q.retired_at is null)
        is distinct from (select array_agg(x.id order by x.id) from unnest(p_question_ids) as x(id)) then
    raise exception 'ORDER_MISMATCH';
  end if;
  update public.bank_questions q set sort_order = o.pos::int
  from unnest(p_question_ids) with ordinality as o(id, pos)
  where q.id = o.id and q.sort_order <> o.pos;
end $$;

create or replace function public.admin_question_history(p_admin_token text, p_question_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin(p_admin_token);
  return (select coalesce(jsonb_agg(jsonb_build_object(
                   'changeId', x.id, 'changedAt', x.changed_at, 'action', x.action,
                   'revision', x.revision, 'snapshot', x.snapshot) order by x.id desc), '[]'::jsonb)
          from (select b.* from app_private.bank_changes b
                where b.entity = 'question' and b.entity_id = p_question_id
                order by b.id desc limit 50) x);
end $$;

-- Puts back the content a question had after an earlier change (as a new change).
create or replace function public.admin_revert_question(p_admin_token text, p_question_id text, p_change_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_snapshot jsonb;
  v_q        public.bank_questions;
  v_p        jsonb;
begin
  perform app_private.require_admin(p_admin_token);
  perform app_private.lock_bank();
  select b.snapshot into v_snapshot from app_private.bank_changes b
  where b.id = p_change_id and b.entity = 'question' and b.entity_id = p_question_id;
  if not found then raise exception 'CHANGE_NOT_FOUND'; end if;
  select * into v_q from public.bank_questions where id = p_question_id for update;
  if not found then raise exception 'QUESTION_NOT_FOUND'; end if;
  if v_q.retired_at is not null then raise exception 'QUESTION_RETIRED'; end if;
  v_p := app_private.prepare_question(v_snapshot);
  update public.bank_questions
     set question_type = v_p->>'type', question_text = v_p->>'text', options = v_p->'options',
         correct_option_ids = array(select jsonb_array_elements_text(v_p->'correctOptionIds')),
         explanation = v_p->>'explanation', duration_seconds = (v_p->>'durationSeconds')::int,
         source_ref = v_p->>'sourceRef', revision = revision + 1, updated_at = now()
   where id = p_question_id;
  perform app_private.log_change('question', p_question_id, 'reverted');
  select * into v_q from public.bank_questions where id = p_question_id;
  return app_private.question_json(v_q);
end $$;

-- ===========================================================================
-- Sessions copy the bank (types and right-answer lists included)
-- ===========================================================================
create or replace function public.admin_create_session(p_admin_token text, p_title text, p_settings jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_title    text := trim(coalesce(p_title, ''));
  v_settings jsonb;
  v_code     text;
  v_id       uuid;
  v_dur      int;
  v_problem  text;
begin
  perform app_private.require_admin(p_admin_token);
  if v_title = '' then
    v_title := 'NPS Orientation ' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI');
  end if;
  if char_length(v_title) > 120 then raise exception 'TITLE_TOO_LONG'; end if;
  v_settings := app_private.normalize_settings(p_settings);

  v_problem := app_private.bank_problem();
  if v_problem is not null then
    raise exception 'BANK_NOT_READY:%', v_problem;
  end if;

  v_code := app_private.gen_session_code();
  insert into public.sessions (code, title, settings) values (v_code, v_title, v_settings)
  returning id into v_id;

  insert into public.session_chapters (session_id, chapter_id, title, description, sort_order)
  select v_id, c.id, c.title, c.description, (row_number() over (order by c.sort_order, c.id))::int
  from public.bank_chapters c where c.retired_at is null;

  v_dur := nullif(v_settings->>'durationOverride', '')::int;
  insert into public.session_questions (session_id, question_id, chapter_id, sort_order, question_type,
                                        question_text, options, correct_option_ids, explanation,
                                        duration_seconds, default_duration_seconds)
  select v_id, q.id, q.chapter_id,
         (row_number() over (partition by q.chapter_id order by q.sort_order, q.id))::int,
         q.question_type, q.question_text, q.options, q.correct_option_ids, q.explanation,
         coalesce(v_dur, q.duration_seconds), q.duration_seconds
  from public.bank_questions q
  join public.bank_chapters c on c.id = q.chapter_id and c.retired_at is null
  where q.retired_at is null;

  return jsonb_build_object('sessionId', v_id, 'code', v_code, 'title', v_title);
end $$;

-- ===========================================================================
-- Answers: one option, or a set of options for multiple choice
-- ===========================================================================
create or replace function app_private.reveal_current(p_session_id uuid)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_s public.sessions;
begin
  select * into v_s from public.sessions where id = p_session_id for update;
  if not found or v_s.phase <> 'question' or v_s.active_question_id is null then
    return;
  end if;

  insert into public.answers (session_id, participant_id, question_id, chapter_id,
                              selected_option_ids, status, is_correct, points_awarded,
                              response_time_ms, submitted_at)
  select v_s.id, p.id, q.question_id, q.chapter_id, null, 'timed_out', false, 0, null, now()
  from public.participants p
  join public.session_questions q on q.session_id = v_s.id and q.question_id = v_s.active_question_id
  where p.session_id = v_s.id
    and p.removed_at is null
    and not exists (select 1 from public.answers a
                    where a.participant_id = p.id and a.question_id = q.question_id and a.voided_at is null)
  on conflict do nothing;

  update public.session_questions
     set revealed_at = now()
   where session_id = v_s.id and question_id = v_s.active_question_id;

  update public.sessions
     set phase = 'reveal', paused = false, paused_remaining_ms = null,
         version = version + 1, updated_at = now()
   where id = v_s.id;
end $$;

drop function if exists public.submit_answer(text, text, text);
create or replace function public.submit_answer(p_token text, p_question_id text,
                                                p_option_id text default null, p_option_ids text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now       timestamptz := now();
  v_p         public.participants;
  v_s         public.sessions;
  v_q         public.session_questions;
  v_existing  public.answers;
  v_selected  text[];
  v_dur_ms    int;
  v_elapsed   int;
  v_remaining int;
  v_correct   boolean;
  v_points    int;
  v_fm        text;
  v_id        uuid;
begin
  v_p := app_private.participant_by_token(p_token);

  -- Shared lock: many answers can be recorded at once, but a reveal waits for them.
  select * into v_s from public.sessions s where s.id = v_p.session_id for share;
  if v_s.status = 'ended' then raise exception 'SESSION_ENDED'; end if;
  if v_s.phase <> 'question' then raise exception 'QUESTION_CLOSED'; end if;
  if v_s.active_question_id is distinct from p_question_id then raise exception 'QUESTION_NOT_ACTIVE'; end if;
  if v_s.paused then raise exception 'QUESTION_PAUSED'; end if;
  if v_now < v_s.question_started_at then raise exception 'QUESTION_NOT_STARTED'; end if;
  if v_now > v_s.question_deadline
             + make_interval(secs => coalesce((v_s.settings->>'graceMs')::int, 1000) / 1000.0) then
    raise exception 'DEADLINE_PASSED';
  end if;

  select * into v_q from public.session_questions q
  where q.session_id = v_s.id and q.question_id = p_question_id;

  -- The chosen options, without duplicates, in A-F order.
  select array_agg(distinct x.id order by x.id) into v_selected
  from unnest(coalesce(p_option_ids, case when p_option_id is null then null else array[p_option_id] end)) as x(id)
  where x.id is not null;
  if v_selected is null
     or exists (select 1 from unnest(v_selected) as x(id)
                where not exists (select 1 from jsonb_array_elements(v_q.options) o where o->>'id' = x.id))
     or (v_q.question_type <> 'multiple' and cardinality(v_selected) <> 1) then
    raise exception 'INVALID_OPTION';
  end if;

  v_dur_ms    := v_q.duration_seconds * 1000;
  v_elapsed   := greatest(0, least(v_dur_ms, (extract(epoch from (v_now - v_s.question_started_at)) * 1000)::int));
  v_remaining := greatest(0, least(v_dur_ms, (extract(epoch from (v_s.question_deadline - v_now)) * 1000)::int));
  -- All or nothing: right only when the chosen set is exactly the set of right answers.
  v_correct   := v_selected = (select array_agg(c.id order by c.id) from unnest(v_q.correct_option_ids) as c(id));
  v_points    := app_private.question_points(v_correct, v_elapsed, v_remaining, v_dur_ms,
                                             coalesce(v_s.settings->>'scoringMode', 'linear'));
  v_fm        := coalesce(v_s.settings->>'feedbackMode', 'on_reveal');

  insert into public.answers (session_id, participant_id, question_id, chapter_id, selected_option_ids,
                              status, is_correct, points_awarded, response_time_ms, submitted_at)
  values (v_s.id, v_p.id, p_question_id, v_q.chapter_id, v_selected,
          'answered', v_correct, v_points, v_elapsed, v_now)
  on conflict (participant_id, question_id) where voided_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_existing from public.answers a
    where a.participant_id = v_p.id and a.question_id = p_question_id and a.voided_at is null;
    return jsonb_build_object(
      'accepted', false, 'reason', 'ALREADY_ANSWERED',
      'selectedOptionIds', to_jsonb(v_existing.selected_option_ids),
      'selectedOptionId', v_existing.selected_option_id,
      'responseTimeMs', v_existing.response_time_ms,
      'isCorrect', case when v_fm = 'immediate' then v_existing.is_correct end,
      'points', case when v_fm = 'immediate' then v_existing.points_awarded end);
  end if;

  update public.participants set last_seen_at = v_now where id = v_p.id;

  return jsonb_build_object(
    'accepted', true,
    'selectedOptionIds', to_jsonb(v_selected),
    'selectedOptionId', case when cardinality(v_selected) = 1 then v_selected[1] end,
    'submittedAt', v_now,
    'responseTimeMs', v_elapsed,
    'isCorrect', case when v_fm = 'immediate' then v_correct end,
    'points', case when v_fm = 'immediate' then v_points end);
end $$;

-- How many people chose each option (for multiple choice a person counts once per option).
create or replace function app_private.option_counts(p_session_id uuid, p_question_id text, p_active_only boolean)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(o.value->>'id',
           (select count(*) from public.answers a
            where a.session_id = p_session_id and a.question_id = p_question_id and a.voided_at is null
              and (o.value->>'id') = any (a.selected_option_ids)
              and (not p_active_only or exists (select 1 from public.participants p
                                                where p.id = a.participant_id and p.removed_at is null)))), '{}'::jsonb)
  from public.session_questions q, jsonb_array_elements(q.options) as o(value)
  where q.session_id = p_session_id and q.question_id = p_question_id
$$;

-- ===========================================================================
-- State for phones, the big screen and the presenter (type and right-answer lists added)
-- ===========================================================================
create or replace function public.get_participant_state(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p        public.participants;
  v_s        public.sessions;
  v_q        public.session_questions;
  v_a        public.answers;
  v_fm       text;
  v_show     boolean;
  v_total    int;
  v_count    int;
  v_stats    jsonb;
  v_chapters jsonb;
  v_question jsonb := null;
  v_standing jsonb := null;
begin
  v_p := app_private.participant_by_token(p_token);
  if v_p.last_seen_at < now() - interval '10 seconds' then
    update public.participants set last_seen_at = now() where id = v_p.id;
  end if;

  select * into v_s from public.sessions s where s.id = v_p.session_id;
  v_fm := coalesce(v_s.settings->>'feedbackMode', 'on_reveal');

  v_stats := app_private.participant_chapter_stats(v_s.id, v_p.id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.chapter_id, 'title', c.title, 'description', c.description,
           'order', c.sort_order, 'status', c.status,
           'questionCount', (select count(*) from public.session_questions q
                             where q.session_id = c.session_id and q.chapter_id = c.chapter_id),
           'stats', coalesce(v_stats->c.chapter_id, '{}'::jsonb)) order by c.sort_order), '[]'::jsonb)
    into v_chapters
  from public.session_chapters c where c.session_id = v_s.id;

  if v_s.phase in ('question', 'reveal') and v_s.active_question_id is not null then
    select * into v_q from public.session_questions q
    where q.session_id = v_s.id and q.question_id = v_s.active_question_id;
    select count(*) into v_total from public.session_questions q
    where q.session_id = v_s.id and q.chapter_id = v_q.chapter_id;
    select * into v_a from public.answers a
    where a.participant_id = v_p.id and a.question_id = v_q.question_id and a.voided_at is null;
    v_show := v_s.phase = 'reveal' or v_fm = 'immediate';

    v_question := jsonb_build_object(
      'id', v_q.question_id, 'chapterId', v_q.chapter_id,
      'index', v_q.sort_order, 'total', v_total,
      'type', v_q.question_type,
      'text', v_q.question_text, 'options', v_q.options,
      'durationSeconds', v_q.duration_seconds,
      'startedAt', v_s.question_started_at, 'deadline', v_s.question_deadline,
      'paused', v_s.paused, 'pausedRemainingMs', v_s.paused_remaining_ms,
      'revealed', v_s.phase = 'reveal',
      'correctOptionIds', case when v_s.phase = 'reveal' then to_jsonb(v_q.correct_option_ids) end,
      'correctOptionId', case when v_s.phase = 'reveal' then v_q.correct_option_ids[1] end,
      'explanation', case when v_s.phase = 'reveal' then v_q.explanation end,
      'myAnswer', case when v_a.id is null then null else jsonb_build_object(
          'selectedOptionIds', to_jsonb(v_a.selected_option_ids),
          'selectedOptionId', v_a.selected_option_id,
          'status', v_a.status,
          'responseTimeMs', v_a.response_time_ms,
          'isCorrect', case when v_show then v_a.is_correct end,
          'points', case when v_show then v_a.points_awarded end) end);
  end if;

  if v_s.phase <> 'question' or v_fm = 'immediate' then
    select jsonb_build_object(
             'rank', l.rank, 'totalPoints', l.total_points,
             'correctCount', l.correct_count, 'incorrectCount', l.incorrect_count,
             'timedOutCount', l.timed_out_count, 'answeredCount', l.answered_count,
             'accuracy', l.accuracy, 'avgResponseMs', l.avg_response_ms,
             'chaptersCompleted', l.chapters_completed, 'chapterPoints', l.chapter_points)
      into v_standing
    from app_private.leaderboard(v_s.id) l
    where l.participant_id = v_p.id;
  end if;

  select count(*) into v_count from public.participants p
  where p.session_id = v_s.id and p.removed_at is null;

  return jsonb_build_object(
    'serverTime', now(),
    'session', jsonb_build_object(
        'id', v_s.id, 'code', v_s.code, 'title', v_s.title, 'status', v_s.status,
        'phase', v_s.phase, 'registrationOpen', v_s.registration_open,
        'activeChapterId', v_s.active_chapter_id, 'paused', v_s.paused,
        'version', v_s.version, 'feedbackMode', v_fm,
        'scoringMode', coalesce(v_s.settings->>'scoringMode', 'linear')),
    'participant', jsonb_build_object('id', v_p.id, 'displayName', v_p.display_name, 'joinedAt', v_p.joined_at),
    'participantCount', v_count,
    'chapters', v_chapters,
    'question', v_question,
    'standing', v_standing);
end $$;

create or replace function public.get_screen_state(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_s        public.sessions;
  v_q        public.session_questions;
  v_n        int;
  v_size     int;
  v_total    int;
  v_answered int;
  v_chapter  jsonb;
  v_question jsonb := null;
  v_reveal   jsonb := null;
  v_lb       jsonb := null;
begin
  select * into v_s from public.sessions s where s.code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  select count(*) into v_n from public.participants p where p.session_id = v_s.id and p.removed_at is null;
  v_size := coalesce((v_s.settings->>'screenLeaderboardSize')::int, 10);

  select jsonb_build_object('id', c.chapter_id, 'title', c.title, 'description', c.description,
                            'order', c.sort_order, 'status', c.status,
                            'questionCount', (select count(*) from public.session_questions q
                                              where q.session_id = c.session_id and q.chapter_id = c.chapter_id))
    into v_chapter
  from public.session_chapters c
  where c.session_id = v_s.id and c.chapter_id = v_s.active_chapter_id;

  if v_s.phase in ('question', 'reveal') and v_s.active_question_id is not null then
    select * into v_q from public.session_questions q
    where q.session_id = v_s.id and q.question_id = v_s.active_question_id;
    select count(*) into v_total from public.session_questions q
    where q.session_id = v_s.id and q.chapter_id = v_q.chapter_id;
    select count(*) into v_answered from public.answers a
    where a.session_id = v_s.id and a.question_id = v_q.question_id
      and a.voided_at is null and a.status = 'answered';

    v_question := jsonb_build_object(
      'id', v_q.question_id, 'index', v_q.sort_order, 'total', v_total,
      'type', v_q.question_type,
      'text', v_q.question_text, 'options', v_q.options,
      'durationSeconds', v_q.duration_seconds,
      'startedAt', v_s.question_started_at, 'deadline', v_s.question_deadline,
      'paused', v_s.paused, 'pausedRemainingMs', v_s.paused_remaining_ms,
      'answeredCount', v_answered);

    if v_s.phase = 'reveal' then
      select jsonb_build_object(
               'correctOptionIds', to_jsonb(v_q.correct_option_ids),
               'correctOptionId', v_q.correct_option_ids[1],
               'explanation', v_q.explanation,
               'distribution', app_private.option_counts(v_s.id, v_q.question_id, false),
               'answeredCount', v_answered,
               'correctCount', (select count(*) from public.answers a
                                where a.session_id = v_s.id and a.question_id = v_q.question_id
                                  and a.voided_at is null and a.is_correct),
               'timedOutCount', (select count(*) from public.answers a
                                 where a.session_id = v_s.id and a.question_id = v_q.question_id
                                   and a.voided_at is null and a.status = 'timed_out'))
        into v_reveal;
    end if;
  end if;

  if v_s.phase <> 'question' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'rank', l.rank, 'displayName', l.display_name, 'totalPoints', l.total_points,
             'correctCount', l.correct_count, 'accuracy', l.accuracy,
             'chaptersCompleted', l.chapters_completed) order by l.rank), '[]'::jsonb)
      into v_lb
    from app_private.leaderboard(v_s.id) l
    where l.rank <= v_size;
  end if;

  return jsonb_build_object(
    'serverTime', now(),
    'session', jsonb_build_object('id', v_s.id, 'code', v_s.code, 'title', v_s.title,
                                  'status', v_s.status, 'phase', v_s.phase,
                                  'registrationOpen', v_s.registration_open,
                                  'paused', v_s.paused, 'version', v_s.version),
    'participantCount', v_n,
    'chapter', v_chapter,
    'chapters', (select coalesce(jsonb_agg(jsonb_build_object('id', c.chapter_id, 'title', c.title,
                                                              'order', c.sort_order, 'status', c.status)
                                           order by c.sort_order), '[]'::jsonb)
                 from public.session_chapters c where c.session_id = v_s.id),
    'question', v_question,
    'reveal', v_reveal,
    'leaderboard', v_lb);
end $$;

create or replace function public.admin_get_session(p_admin_token text, p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_s        public.sessions;
  v_q        public.session_questions;
  v_n        int;
  v_active   int;
  v_total    int;
  v_chapters jsonb;
  v_question jsonb := null;
  v_live     jsonb := null;
  v_lb       jsonb;
begin
  perform app_private.require_admin(p_admin_token);
  select * into v_s from public.sessions s where s.id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  select count(*), count(*) filter (where p.last_seen_at > now() - interval '25 seconds')
    into v_n, v_active
  from public.participants p where p.session_id = v_s.id and p.removed_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.chapter_id, 'title', c.title, 'description', c.description,
           'order', c.sort_order, 'status', c.status,
           'questionCount', qc.n, 'revealedCount', qc.revealed,
           'completedBy', (select count(*) from (
                             select a.participant_id
                             from public.answers a
                             join public.participants p on p.id = a.participant_id and p.removed_at is null
                             where a.session_id = c.session_id and a.chapter_id = c.chapter_id and a.voided_at is null
                             group by a.participant_id
                             having count(*) >= qc.n) x))
         order by c.sort_order), '[]'::jsonb)
    into v_chapters
  from public.session_chapters c
  cross join lateral (
    select count(*)::int as n, (count(*) filter (where q.revealed_at is not null))::int as revealed
    from public.session_questions q
    where q.session_id = c.session_id and q.chapter_id = c.chapter_id) qc
  where c.session_id = v_s.id;

  if v_s.active_question_id is not null then
    select * into v_q from public.session_questions q
    where q.session_id = v_s.id and q.question_id = v_s.active_question_id;
    select count(*) into v_total from public.session_questions q
    where q.session_id = v_s.id and q.chapter_id = v_q.chapter_id;

    v_question := jsonb_build_object(
      'id', v_q.question_id, 'chapterId', v_q.chapter_id, 'index', v_q.sort_order, 'total', v_total,
      'type', v_q.question_type,
      'text', v_q.question_text, 'options', v_q.options,
      'correctOptionIds', to_jsonb(v_q.correct_option_ids),
      'correctOptionId', v_q.correct_option_ids[1], 'explanation', v_q.explanation,
      'durationSeconds', v_q.duration_seconds,
      'startedAt', v_s.question_started_at, 'deadline', v_s.question_deadline,
      'paused', v_s.paused, 'pausedRemainingMs', v_s.paused_remaining_ms,
      'launchedAt', v_q.launched_at, 'revealedAt', v_q.revealed_at);

    select jsonb_build_object(
             'answered',  count(*) filter (where a.status = 'answered'),
             'timedOut',  count(*) filter (where a.status = 'timed_out'),
             'correct',   count(*) filter (where a.is_correct),
             'incorrect', count(*) filter (where a.status = 'answered' and not a.is_correct),
             'notAnswered', greatest(0, v_n - count(*)),
             'distribution', app_private.option_counts(v_s.id, v_q.question_id, true))
      into v_live
    from public.answers a
    join public.participants p on p.id = a.participant_id and p.removed_at is null
    where a.session_id = v_s.id and a.question_id = v_q.question_id and a.voided_at is null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'participantId', l.participant_id, 'rank', l.rank, 'displayName', l.display_name,
           'totalPoints', l.total_points, 'correctCount', l.correct_count,
           'incorrectCount', l.incorrect_count, 'timedOutCount', l.timed_out_count,
           'answeredCount', l.answered_count, 'accuracy', l.accuracy,
           'avgResponseMs', l.avg_response_ms, 'chaptersCompleted', l.chapters_completed,
           'chapterPoints', l.chapter_points, 'joinedAt', l.joined_at,
           'active', l.last_seen_at > now() - interval '25 seconds') order by l.rank), '[]'::jsonb)
    into v_lb
  from app_private.leaderboard(v_s.id) l;

  return jsonb_build_object(
    'serverTime', now(),
    'session', jsonb_build_object(
        'id', v_s.id, 'code', v_s.code, 'title', v_s.title, 'status', v_s.status, 'phase', v_s.phase,
        'registrationOpen', v_s.registration_open, 'activeChapterId', v_s.active_chapter_id,
        'activeQuestionId', v_s.active_question_id, 'paused', v_s.paused,
        'settings', v_s.settings, 'version', v_s.version,
        'createdAt', v_s.created_at, 'endedAt', v_s.ended_at),
    'participantCount', v_n,
    'activeCount', v_active,
    'chapters', v_chapters,
    'question', v_question,
    'live', v_live,
    'leaderboard', v_lb);
end $$;

create or replace function public.admin_export_item_analysis(p_admin_token text, p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin(p_admin_token);
  if not exists (select 1 from public.sessions s where s.id = p_session_id) then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(t) order by t."chapterOrder", t."questionOrder"), '[]'::jsonb)
    from (
      select c.sort_order                                                 as "chapterOrder",
             c.chapter_id                                                 as "chapterId",
             c.title                                                      as "chapterTitle",
             q.sort_order                                                 as "questionOrder",
             q.question_id                                                as "questionId",
             q.question_type                                              as "questionType",
             q.question_text                                              as "questionText",
             to_jsonb(q.correct_option_ids)                               as "correctOptionIds",
             q.correct_option_ids[1]                                      as "correctOptionId",
             jsonb_array_length(q.options)                                as "optionCount",
             (q.revealed_at is not null)                                  as "played",
             count(a.id) filter (where a.status = 'answered')             as "answered",
             count(a.id) filter (where a.is_correct)                      as "correct",
             count(a.id) filter (where a.status = 'timed_out')            as "timedOut",
             case when count(a.id) > 0
                  then round(100.0 * count(a.id) filter (where a.is_correct) / count(a.id), 1) end
                                                                          as "pctCorrect",
             count(a.id) filter (where 'A' = any (a.selected_option_ids)) as "optionA",
             count(a.id) filter (where 'B' = any (a.selected_option_ids)) as "optionB",
             count(a.id) filter (where 'C' = any (a.selected_option_ids)) as "optionC",
             count(a.id) filter (where 'D' = any (a.selected_option_ids)) as "optionD",
             count(a.id) filter (where 'E' = any (a.selected_option_ids)) as "optionE",
             count(a.id) filter (where 'F' = any (a.selected_option_ids)) as "optionF",
             round(avg(a.response_time_ms) filter (where a.status = 'answered'))::int
                                                                          as "avgResponseMs"
      from public.session_questions q
      join public.session_chapters c on c.session_id = q.session_id and c.chapter_id = q.chapter_id
      left join public.answers a
             on a.session_id = q.session_id and a.question_id = q.question_id and a.voided_at is null
            and exists (select 1 from public.participants p where p.id = a.participant_id and p.removed_at is null)
      where q.session_id = p_session_id
      group by c.sort_order, c.chapter_id, c.title, q.sort_order, q.question_id, q.question_type,
               q.question_text, q.correct_option_ids, q.options, q.revealed_at
    ) t);
end $$;

revoke execute on all functions in schema app_private from public;

-- Ask the Data API to reload its schema cache (Supabase also does this on DDL).
notify pgrst, 'reload schema';
