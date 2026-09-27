-- CreateTable
CREATE TABLE "TeacherCorrection" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptId" TEXT,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "role" "SeatRole" NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scenarioId" TEXT,
    "scenarioTitle" TEXT,
    "category" TEXT,
    "typeCode" INTEGER,
    "typeName" TEXT,
    "typeGroupId" INTEGER,
    "draftOk" BOOLEAN,
    "draftEvidence" TEXT,
    "teacherOk" BOOLEAN,
    "comment" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "offAt" TIMESTAMP(3),
    "offById" TEXT,
    "offByName" TEXT,
    "offReason" TEXT,

    CONSTRAINT "TeacherCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeacherCorrection_code_active_createdAt_idx" ON "TeacherCorrection"("code", "active", "createdAt");

-- CreateIndex
CREATE INDEX "TeacherCorrection_attemptId_idx" ON "TeacherCorrection"("attemptId");

