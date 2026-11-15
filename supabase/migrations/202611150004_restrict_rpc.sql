-- Supabase peut accorder EXECUTE à anon par défaut ; la révocation de PUBLIC seule ne suffit pas.
REVOKE EXECUTE ON FUNCTION public.assign_application_advisor(uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_application_status(uuid,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_academic_advisors() FROM anon;
