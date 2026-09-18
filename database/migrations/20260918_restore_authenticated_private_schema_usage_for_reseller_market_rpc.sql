-- Restore the minimum schema privilege required by the public reseller Market Check RPCs.
-- The public functions execute private implementation functions as the authenticated role.
-- USAGE allows name resolution only; it does not grant table access or function EXECUTE by itself.

grant usage on schema private to authenticated;
revoke usage on schema private from anon;
