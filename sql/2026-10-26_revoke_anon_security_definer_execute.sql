-- Reduce unauthenticated access to privileged OMS database functions.
-- LINE customer APIs use the server's service_role; staff pages use Supabase Auth.
-- Preserve existing explicit authenticated and service_role EXECUTE grants.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',
      fn.oid::pg_catalog.regprocedure
    );
  END LOOP;
END
$$;
