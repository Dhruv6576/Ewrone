-- Allow the master owner to update their own record (e.g. changing business name)
grant update on public.master_owners to authenticated;

drop policy if exists master_owners_update on public.master_owners;

create policy master_owners_update
  on public.master_owners for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
