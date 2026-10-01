-- Cache Russian renderings separately; fact-check judgments remain immutable.
alter table public.fact_checks
  add constraint fact_checks_id_claim_key unique (id, claim_id);

create table public.report_localizations (
  fact_check_id uuid not null references public.fact_checks(id) on delete cascade,
  claim_id uuid not null references public.claims(id) on delete cascade,
  locale text not null check (locale = 'ru'),
  normalized_text text not null check (length(normalized_text) between 1 and 1200),
  explanation text not null check (length(explanation) between 1 and 4000),
  model text not null check (length(model) between 1 and 200),
  prompt_version text not null check (length(prompt_version) between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (fact_check_id, locale),
  constraint report_localizations_fact_check_claim_key
    foreign key (fact_check_id, claim_id)
    references public.fact_checks(id, claim_id) on delete cascade
);

alter table public.report_localizations enable row level security;
revoke all on public.report_localizations from anon, authenticated, service_role;
grant select on public.report_localizations to authenticated;
grant select on public.report_localizations to service_role;

create policy report_localizations_select_own on public.report_localizations
  for select to authenticated using (exists (
    select 1 from public.claims c
    join public.claim_extractions ce on ce.id = c.claim_extraction_id
    join public.transcripts t on t.id = ce.transcript_id
    join public.content_items ci on ci.id = t.content_item_id
    where c.id = report_localizations.claim_id and ci.user_id = auth.uid()
  ));

create function public.save_report_localizations_ru(
  p_translations jsonb,
  p_model text,
  p_prompt_version text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  translation jsonb;
  localized_fact_check_id uuid;
  localized_claim_id uuid;
begin
  if auth.uid() is null
    or p_translations is null
    or jsonb_typeof(p_translations) <> 'array'
    or jsonb_array_length(p_translations) not between 1 and 100
    or p_model is null or length(p_model) not between 1 and 200
    or p_prompt_version is null or length(p_prompt_version) not between 1 and 100 then
    raise exception 'Invalid report localization request';
  end if;

  for translation in select value from jsonb_array_elements(p_translations)
  loop
    begin
      localized_fact_check_id := (translation ->> 'fact_check_id')::uuid;
      localized_claim_id := (translation ->> 'claim_id')::uuid;
    exception when others then
      raise exception 'Invalid report localization identifiers';
    end;
    if jsonb_typeof(translation) <> 'object'
      or length(translation ->> 'normalized_text') not between 1 and 1200
      or length(translation ->> 'explanation') not between 1 and 4000
      or not exists (
        select 1
        from public.fact_checks fc
        join public.claims c on c.id = fc.claim_id
        join public.claim_extractions ce on ce.id = c.claim_extraction_id
        join public.transcripts t on t.id = ce.transcript_id
        join public.content_items ci on ci.id = t.content_item_id
        where fc.id = localized_fact_check_id
          and c.id = localized_claim_id
          and ci.user_id = auth.uid()
      ) then
      raise exception 'Report localization is not authorized';
    end if;
    insert into public.report_localizations (
      fact_check_id, claim_id, locale, normalized_text, explanation,
      model, prompt_version
    ) values (
      localized_fact_check_id, localized_claim_id, 'ru',
      translation ->> 'normalized_text', translation ->> 'explanation',
      p_model, p_prompt_version
    ) on conflict (fact_check_id, locale) do nothing;
  end loop;
end;
$$;

revoke all on function public.save_report_localizations_ru(jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_report_localizations_ru(jsonb, text, text)
  to authenticated;
