-- Varmak Workshop — the server's password. The second of the two things you paste, and the only
-- one you change anything in.
--
-- Run backend/supabase-install.sql first. That file makes the role the server connects as —
-- varmak_api — with no password and no right to sign in, because a role that can sign in before
-- anybody has chosen its password is a door standing open for however long that takes.
--
-- Replace the line below with a long random password, keep the single quotes around it, and press
-- Run. Then put the same password where the server's settings live (on Railway, Render or Fly that
-- is the environment variables), as the password inside DATABASE_URL. It is not in this repository
-- and it cannot be read back out of the database afterwards — the database keeps only a hash of it.
--
-- Three honest warnings:
--
--   * A dashboard SQL editor saves what you ran. The password is in the text you paste, so it is in
--     that history until you clear it. Delete this snippet from the editor when it has worked.
--   * If you lose the password, nothing is broken and nothing is lost: change this file to a new one
--     and run it again, then change the server's settings to match.
--   * Use letters, digits and dashes only. A password with an apostrophe in it ends the text on the
--     line below where you pasted it, and the whole file fails with `syntax error at or near …` —
--     before any of the checks in here get a chance to explain. That one cannot be caught from
--     inside the file, which is why it is written at the top of it.

DO $$
DECLARE
  pw text := 'PASTE-A-LONG-RANDOM-PASSWORD-HERE';
BEGIN
  IF pw LIKE 'PASTE-%' THEN
    RAISE EXCEPTION E'Nothing was changed. The password is still the example text.\n\nReplace PASTE-A-LONG-RANDOM-PASSWORD-HERE with a long random password of your own, keep the quotes around it, and run this again.';
  END IF;
  IF length(pw) < 24 THEN
    RAISE EXCEPTION E'Nothing was changed. That password is % characters long and this refuses anything under 24.\n\nThis is the one password that is on the open internet and that no person ever types, so there is no reason for it to be short. Make it long and random — you only paste it twice, here and into the server''s settings.', length(pw);
  END IF;

  -- ALTER ROLE takes a literal and not a parameter, so the literal is built by the database's own
  -- quoting rather than by pasting pw into the statement text. That makes this line safe for any
  -- value pw holds — it is getting an awkward value *into* pw, through the literal above, that this
  -- file cannot defend (see the note at the top).
  EXECUTE format('ALTER ROLE varmak_api LOGIN PASSWORD %L', pw);

  RAISE NOTICE 'Done. The server can now sign in as varmak_api.';
  RAISE NOTICE 'Put the same password into the server''s DATABASE_URL, then delete this snippet from the SQL editor.';
END
$$;
