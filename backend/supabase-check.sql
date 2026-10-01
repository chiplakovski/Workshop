-- Varmak Workshop — did it work? Paste this, press Run, and read the rows.
--
-- This file exists because a dashboard SQL editor shows errors and rows, and may show nothing at all
-- for a NOTICE. backend/supabase-install.sql ends by checking itself and raising if anything is
-- missing — so a red error there means something is wrong and is worth reading. But "Success. No rows
-- returned" is all you get when it worked, and that is a thin thing to trust a company's data to.
-- This asks the questions back and answers them in rows, which a dashboard always shows.
--
-- It only reads. Run it as often as you like, before or after anything.
--
-- Every row should say "во ред / ok". Anything else names what to do about it.
--
-- One thing it deliberately does NOT check: whether the server's password is set. The database keeps
-- only a hash of it and does not let an ordinary role read even that. backend/supabase-password.sql
-- tells you itself — it either turns red with a reason, or it does not.

WITH counted AS (
  SELECT
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r') AS tables,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)) AS unguarded,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies,
    -- Only this system's own. Counting everything in public would count pgcrypto's 36 functions too
    -- wherever a database happens to have put pgcrypto — so the number would read differently here
    -- than on a managed database, for a reason that has nothing to do with whether the install worked.
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d
                         WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass
                           AND d.deptype = 'e')) AS workflows,
    (SELECT string_agg(rolname, ', ' ORDER BY rolname) FROM pg_roles
      WHERE rolname IN ('varmak_admin', 'varmak_api', 'varmak_engine', 'varmak_office',
                        'varmak_workshop')) AS roles,
    (SELECT count(*) FROM pg_roles
      WHERE rolname IN ('varmak_admin', 'varmak_api', 'varmak_engine', 'varmak_office',
                        'varmak_workshop')) AS role_count
)
SELECT * FROM (
  SELECT 1 AS n,
    'Табели / Tables' AS "Што / What",
    tables::text AS "Колку / How many",
    CASE WHEN tables = 0
      THEN 'ПРАЗНО — залепи supabase-install.sql / EMPTY — paste supabase-install.sql'
      ELSE 'во ред / ok' END AS "Состојба / State"
  FROM counted
  UNION ALL
  SELECT 2, 'Табели без заштита / Tables with no row security', unguarded::text,
    CASE WHEN unguarded = 0 THEN 'во ред / ok'
      ELSE 'ПРОБЛЕМ — не внесувај вистински податоци / PROBLEM — do not put real data in' END
  FROM counted
  UNION ALL
  SELECT 3, 'Правила кој што смее да чита / Rules about who may read what', policies::text,
    CASE WHEN policies = 0
      THEN 'ПРОБЛЕМ — auth.sql не поминал / PROBLEM — auth.sql did not run'
      ELSE 'во ред / ok' END
  FROM counted
  UNION ALL
  SELECT 4, 'Работни постапки / Workflows', workflows::text,
    CASE WHEN workflows = 0
      THEN 'ПРОБЛЕМ — api.sql не поминал / PROBLEM — api.sql did not run'
      ELSE 'во ред / ok' END
  FROM counted
  UNION ALL
  SELECT 5, 'Улоги / Roles', coalesce(roles, '—'),
    CASE WHEN role_count = 5 THEN 'во ред / ok'
      ELSE 'ПРОБЛЕМ — треба да ги има сите пет / PROBLEM — all five have to be there' END
  FROM counted
  UNION ALL
  SELECT 6, 'Следен чекор / Next step', '',
    CASE
      WHEN tables = 0 THEN 'Залепи supabase-install.sql / Paste supabase-install.sql'
      WHEN unguarded > 0 OR policies = 0 OR workflows = 0 OR role_count <> 5
        THEN 'Направи нова празна база и залепи повторно / Make a new empty database and paste again'
      ELSE 'Залепи supabase-password.sql, па отвори /admin.html и направи го првиот администратор'
           || ' / Paste supabase-password.sql, then open /admin.html and make the first administrator'
    END
  FROM counted
) rows ORDER BY n;
