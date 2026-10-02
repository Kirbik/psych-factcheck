-- Keep historical screening reason codes valid while allowing expanded topics.
alter table public.video_screenings
  drop constraint if exists video_screenings_reason_code_check;

alter table public.video_screenings
  add constraint video_screenings_reason_code_check check (
    reason_code in (
      'no_psychology_content',
      'incidental_mention',
      'no_checkable_claims',
      'psychology_claims_present',
      'no_target_topic_content',
      'target_topics_present',
      'unclear_sample',
      'sample_unavailable',
      'provider_error',
      'invalid_model_output'
    )
  );
