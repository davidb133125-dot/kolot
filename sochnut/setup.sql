-- =====================================================================
--  סוכנות הבלשים — הגדרת מסד הנתונים
--  מריצים פעם אחת: Supabase ← SQL Editor ← מדביקים הכול ← Run.
--  אפשר להריץ שוב בלי נזק (הכול נבנה "אם לא קיים").
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- טבלאות ----------
create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text not null unique check (code ~ '^[a-z][a-z0-9]{0,7}$'),
  teacher_id  uuid,
  gate_mode   text not null default 'auto' check (gate_mode in ('auto','open','locked')),
  unlock_all  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z][a-z0-9_]{2,19}$'),
  full_name   text not null,
  role        text not null check (role in ('admin','teacher','student')),
  class_id    uuid references public.classes(id) on delete set null,
  gate_mode   text check (gate_mode in ('auto','open','locked')),   -- חריגה לתלמיד (ריק = לפי הכיתה)
  unlock_all  boolean,                                               -- חריגה לתלמיד (ריק = לפי הכיתה)
  created_at  timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classes_teacher_fk') then
    alter table public.classes add constraint classes_teacher_fk
      foreign key (teacher_id) references public.profiles(id) on delete set null;
  end if;
end $$;

alter table public.profiles add column if not exists tts boolean not null default false;  -- הקראה בקול לתלמיד

create table if not exists public.progress (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists public.notices (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  student_id  uuid references public.profiles(id) on delete cascade,   -- ריק = לכל הכיתה
  kind        text not null check (kind in ('message','bonus')),
  title       text not null,
  body        text not null default '',
  lesson_id   text,
  n           int,
  pts         int,
  ends_at     timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------- פונקציות עזר להרשאות ----------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_class() returns uuid
language sql stable security definer set search_path = '' as $$
  select class_id from public.profiles where id = auth.uid()
$$;

create or replace function public.teaches(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classes c where c.id = p_class and c.teacher_id = auth.uid())
$$;

-- ---------- אבטחה ברמת שורה (RLS) ----------
alter table public.classes  enable row level security;
alter table public.profiles enable row level security;
alter table public.progress enable row level security;

revoke all on public.classes, public.profiles, public.progress from anon;
grant select on public.classes, public.profiles to authenticated;
grant select, insert, update on public.progress to authenticated;

drop policy if exists "classes read" on public.classes;
create policy "classes read" on public.classes for select to authenticated
  using (public.my_role() = 'admin' or teacher_id = auth.uid() or id = public.my_class());

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid()
         or public.my_role() = 'admin'
         or (role = 'student' and public.teaches(class_id)));

drop policy if exists "progress read" on public.progress;
create policy "progress read" on public.progress for select to authenticated
  using (user_id = auth.uid()
         or public.my_role() = 'admin'
         or exists (select 1 from public.profiles p where p.id = progress.user_id and public.teaches(p.class_id)));

drop policy if exists "progress insert own" on public.progress;
create policy "progress insert own" on public.progress for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "progress update own" on public.progress;
create policy "progress update own" on public.progress for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- הודעות ומשימות בונוס: תלמיד רואה מה שנשלח לכיתה שלו או אליו; מורה שולח ומוחק בכיתות שלו
alter table public.notices enable row level security;
revoke all on public.notices from anon;
grant select, insert, delete on public.notices to authenticated;

drop policy if exists "notices read" on public.notices;
create policy "notices read" on public.notices for select to authenticated
  using (public.my_role() = 'admin' or public.teaches(class_id)
         or (class_id = public.my_class() and (student_id is null or student_id = auth.uid())));

drop policy if exists "notices insert" on public.notices;
create policy "notices insert" on public.notices for insert to authenticated
  with check ((public.my_role() = 'admin' or public.teaches(class_id)) and created_by = auth.uid()
              and (student_id is null or exists (select 1 from public.profiles p where p.id = student_id and p.class_id = notices.class_id)));

drop policy if exists "notices delete" on public.notices;
create policy "notices delete" on public.notices for delete to authenticated
  using (public.my_role() = 'admin' or public.teaches(class_id));

-- ---------- יצירת משתמש (פנימי, רק דרך הפונקציות שלמטה) ----------
create or replace function public._create_user(p_username text, p_full_name text, p_role text, p_class uuid, p_password text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_email text;
begin
  p_username := lower(trim(p_username));
  if p_username !~ '^[a-z][a-z0-9_]{2,19}$' then
    raise exception 'שם משתמש לא תקין: % (אותיות באנגלית ומספרים, 3–20 תווים)', p_username;
  end if;
  if coalesce(length(p_password), 0) < 6 then raise exception 'הסיסמה צריכה להיות באורך 6 תווים לפחות'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'חסר שם מלא'; end if;
  if exists (select 1 from public.profiles where username = p_username) then
    raise exception 'שם המשתמש % כבר קיים', p_username using errcode = '23505';
  end if;
  v_email := p_username || '@sochnut.school';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('username', p_username),
          now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());
  insert into public.profiles (id, username, full_name, role, class_id)
  values (v_id, p_username, trim(p_full_name), p_role, p_class);
  return v_id;
end $$;

-- ---------- המנהל הראשון (רק מתוך SQL Editor, ורק אם אין עדיין מנהל) ----------
create or replace function public.bootstrap_admin(p_username text, p_full_name text, p_password text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'כבר יש מנהל. מנהלים נוספים יוצרים מתוך לוח המנהל.';
  end if;
  return public._create_user(p_username, p_full_name, 'admin', null, p_password);
end $$;

-- ---------- פעולות מנהל ----------
create or replace function public.admin_create_user(p_username text, p_full_name text, p_role text, p_class uuid, p_password text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'admin' then raise exception 'רק מנהל יכול ליצור חשבונות'; end if;
  if p_role not in ('admin','teacher','student') then raise exception 'תפקיד לא תקין'; end if;
  return public._create_user(p_username, p_full_name, p_role, p_class, p_password);
end $$;

create or replace function public.reset_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_class uuid; v_role text;
begin
  select class_id, role into v_class, v_role from public.profiles where id = p_user;
  if not (public.my_role() = 'admin' or (v_role = 'student' and public.teaches(v_class))) then
    raise exception 'אין הרשאה לאפס את הסיסמה הזאת';
  end if;
  if coalesce(length(p_password), 0) < 6 then raise exception 'הסיסמה צריכה להיות באורך 6 תווים לפחות'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_user;
end $$;

create or replace function public.admin_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'admin' then raise exception 'רק מנהל יכול למחוק חשבונות'; end if;
  if p_user = auth.uid() then raise exception 'אי אפשר למחוק את החשבון שלכם'; end if;
  delete from auth.users where id = p_user;
end $$;

create or replace function public.admin_save_class(p_id uuid, p_name text, p_code text, p_teacher uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'רק מנהל יכול לנהל כיתות'; end if;
  if p_id is null then
    insert into public.classes (name, code, teacher_id) values (trim(p_name), lower(trim(p_code)), p_teacher) returning id into v_id;
  else
    update public.classes set name = trim(p_name), code = lower(trim(p_code)), teacher_id = p_teacher where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.admin_delete_class(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'admin' then raise exception 'רק מנהל יכול למחוק כיתות'; end if;
  delete from public.classes where id = p_id;
end $$;

-- ---------- שליטה של המורה בקצב ----------
create or replace function public.set_class_settings(p_class uuid, p_gate text, p_unlock boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.my_role() = 'admin' or public.teaches(p_class)) then raise exception 'אין הרשאה לכיתה הזאת'; end if;
  update public.classes set gate_mode = p_gate, unlock_all = p_unlock where id = p_class;
end $$;

create or replace function public.set_student_settings(p_user uuid, p_gate text, p_unlock boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_class uuid;
begin
  select class_id into v_class from public.profiles where id = p_user and role = 'student';
  if not (public.my_role() = 'admin' or public.teaches(v_class)) then raise exception 'אין הרשאה לתלמיד הזה'; end if;
  update public.profiles set gate_mode = p_gate, unlock_all = p_unlock where id = p_user;
end $$;

create or replace function public.set_student_tts(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_class uuid;
begin
  select class_id into v_class from public.profiles where id = p_user and role = 'student';
  if not (public.my_role() = 'admin' or public.teaches(v_class)) then raise exception 'אין הרשאה לתלמיד הזה'; end if;
  update public.profiles set tts = coalesce(p_on, false) where id = p_user;
end $$;

-- ---------- טבלת הכיתה: שם ונקודות של חברי הכיתה בלבד ----------
create or replace function public.class_board()
returns table (full_name text, is_me boolean, points int, wk text, wk_pts int)
language sql stable security definer set search_path = '' as $$
  select p.full_name, p.id = auth.uid(),
         coalesce((g.data->>'points')::int, 0), g.data->>'wk', coalesce((g.data->>'wkPts')::int, 0)
  from public.profiles p left join public.progress g on g.user_id = p.id
  where p.role = 'student' and public.my_class() is not null and p.class_id = public.my_class()
$$;

-- ---------- מי רשאי להפעיל מה ----------
revoke execute on function public._create_user(text,text,text,uuid,text) from public, anon, authenticated;
revoke execute on function public.bootstrap_admin(text,text,text)          from public, anon, authenticated;
revoke execute on function public.admin_create_user(text,text,text,uuid,text) from public, anon;
revoke execute on function public.reset_password(uuid,text)                from public, anon;
revoke execute on function public.admin_delete_user(uuid)                  from public, anon;
revoke execute on function public.admin_save_class(uuid,text,text,uuid)    from public, anon;
revoke execute on function public.admin_delete_class(uuid)                 from public, anon;
revoke execute on function public.set_class_settings(uuid,text,boolean)    from public, anon;
revoke execute on function public.set_student_settings(uuid,text,boolean)  from public, anon;
grant execute on function public.admin_create_user(text,text,text,uuid,text) to authenticated;
grant execute on function public.reset_password(uuid,text)                 to authenticated;
grant execute on function public.admin_delete_user(uuid)                   to authenticated;
grant execute on function public.admin_save_class(uuid,text,text,uuid)     to authenticated;
grant execute on function public.admin_delete_class(uuid)                  to authenticated;
grant execute on function public.set_class_settings(uuid,text,boolean)     to authenticated;
grant execute on function public.set_student_settings(uuid,text,boolean)   to authenticated;
revoke execute on function public.set_student_tts(uuid,boolean)            from public, anon;
revoke execute on function public.class_board()                            from public, anon;
grant execute on function public.class_board()                             to authenticated;
grant execute on function public.set_student_tts(uuid,boolean)             to authenticated;

-- =====================================================================
--  שלב אחרון: יצירת חשבון המנהל הראשון (שלכם).
--  1. החליפו בשורה שלמטה את admin, את השם ואת הסיסמה.
--     שם משתמש: אותיות באנגלית קטנות ומספרים. סיסמה: לפחות 6 תווים.
--  2. הורידו את שני המקפים (--) מתחילת השורה, והריצו שוב.
-- =====================================================================
-- select public.bootstrap_admin('admin', 'השם שלכם', 'סיסמה-שתבחרו');
