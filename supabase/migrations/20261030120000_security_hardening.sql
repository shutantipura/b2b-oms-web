-- Restrict direct public RPC execution; server routes continue via service_role.
REVOKE EXECUTE ON FUNCTION public.create_customer_pickup_order(text,date,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_pickup_order(text,date,text,text,jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.link_new_customer_to_all_line_accounts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_new_customer_to_all_line_accounts() TO service_role;
REVOKE EXECUTE ON FUNCTION public.update_my_delivery_map(bigint,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_my_delivery_phone(bigint,text) FROM PUBLIC, anon;
DROP POLICY IF EXISTS "authenticated users can delete favourites" ON public.favourites;
DROP POLICY IF EXISTS "authenticated users can insert favourites" ON public.favourites;
DROP POLICY IF EXISTS "authenticated users can read favourites" ON public.favourites;
DROP POLICY IF EXISTS "authenticated users can update favourites" ON public.favourites;
DROP POLICY IF EXISTS "managers can update favourites" ON public.favourites;
CREATE POLICY "managers can update favourites" ON public.favourites FOR UPDATE TO authenticated
  USING ((select public.is_manager())) WITH CHECK ((select public.is_manager()));
REVOKE ALL ON TABLE public.favourites FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.favourites FROM authenticated;
