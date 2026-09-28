-- A cancelled route keeps its history and no longer blocks another assignment of the same reviewed error.
DROP INDEX "FollowUp_sourceAttemptId_sourceReviewDigest_skillKey_key";
CREATE UNIQUE INDEX "FollowUp_active_source_skill_key"
  ON "FollowUp"("sourceAttemptId", "sourceReviewDigest", "skillKey")
  WHERE "cancelledAt" IS NULL;
