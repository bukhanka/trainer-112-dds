ALTER TABLE "Scenario" ADD COLUMN "learningMeta" JSONB;
ALTER TABLE "Attempt" ADD COLUMN "feedback" JSONB;

CREATE TABLE "FollowUp" (
  "id" TEXT NOT NULL,
  "sourceAttemptId" TEXT NOT NULL,
  "sourceReviewDigest" TEXT NOT NULL,
  "skillKey" TEXT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "practiceLessonId" TEXT NOT NULL,
  "controlLessonId" TEXT NOT NULL,
  "practiceJudgment" JSONB,
  "controlJudgment" JSONB,
  "createdById" TEXT NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FollowUp_sourceAttemptId_sourceReviewDigest_skillKey_key"
  ON "FollowUp"("sourceAttemptId", "sourceReviewDigest", "skillKey");
CREATE INDEX "FollowUp_practiceLessonId_idx" ON "FollowUp"("practiceLessonId");
CREATE INDEX "FollowUp_controlLessonId_idx" ON "FollowUp"("controlLessonId");
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_sourceAttemptId_fkey"
  FOREIGN KEY ("sourceAttemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_practiceLessonId_fkey"
  FOREIGN KEY ("practiceLessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_controlLessonId_fkey"
  FOREIGN KEY ("controlLessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
