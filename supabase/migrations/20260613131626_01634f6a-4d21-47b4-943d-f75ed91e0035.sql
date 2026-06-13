REVOKE ALL ON FUNCTION public.sync_transaction_intercompany(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_projection_intercompany(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_transaction_intercompany() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_allocation_intercompany() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_projection_intercompany() FROM PUBLIC, anon, authenticated;