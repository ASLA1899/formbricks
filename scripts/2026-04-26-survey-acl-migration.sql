-- 2026-04-26-survey-acl-migration.sql
-- One-shot migration to bootstrap the per-survey ACL feature for ASLA.
-- Idempotent. Wrap entire run in a transaction.
--
-- Pre-conditions:
--   * Schema migration applied: Membership.surveyAdmin and
--     Survey.visibility columns exist (see packages/database/schema.prisma).
--   * gcohen@asla.org has a User row.

BEGIN;

DO $$
DECLARE
  v_user_id     TEXT;
  v_member_cnt  INT;
  v_survey_cnt  INT;
BEGIN
  -- Pre-flight: locate the survey-admin user
  SELECT id INTO v_user_id FROM "User" WHERE email = 'gcohen@asla.org';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'survey-acl migration aborted: gcohen@asla.org not found in "User"';
  END IF;

  RAISE NOTICE 'Found survey-admin user: % (id=%)', 'gcohen@asla.org', v_user_id;

  -- Grant survey-admin on all of this user's memberships
  UPDATE "Membership"
  SET "surveyAdmin" = true
  WHERE "userId" = v_user_id
    AND "surveyAdmin" = false;
  GET DIAGNOSTICS v_member_cnt = ROW_COUNT;
  RAISE NOTICE '% memberships updated to surveyAdmin=true', v_member_cnt;

  -- Grandfather: every existing survey becomes public so nothing disappears
  UPDATE "Survey"
  SET visibility = 'public'
  WHERE visibility = 'private'
    AND created_at < NOW();
  GET DIAGNOSTICS v_survey_cnt = ROW_COUNT;
  RAISE NOTICE '% existing surveys set to visibility=public (grandfather)', v_survey_cnt;

END $$;

COMMIT;

-- After this point:
--   - gcohen sees every survey via the surveyAdmin bypass.
--   - All other users continue to see every existing survey via visibility=public.
--   - New surveys created post-deploy default to visibility=private and are
--     visible only to creator + surveyAdmin users + SurveyAccess rows.
