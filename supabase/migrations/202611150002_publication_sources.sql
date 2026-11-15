-- Une bourse publiée doit avoir une date de vérification et ses deux sources.
alter table public.scholarships add constraint scholarship_publication_sources check (status <> 'published' or (verification_date is not null and official_url is not null and official_url ~* '^https?://' and source_url is not null and source_url ~* '^https?://'));
