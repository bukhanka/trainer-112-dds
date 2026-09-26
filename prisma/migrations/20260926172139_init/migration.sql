-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "ServiceDelivery" AS ENUM ('ARM112', 'VIS', 'PHONE');

-- CreateEnum
CREATE TYPE "ScenarioStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('DRAFT', 'RUNNING', 'FINISHED');

-- CreateEnum
CREATE TYPE "SeatRole" AS ENUM ('OP112', 'DDS');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('ADDED', 'RECEIVED', 'ACCEPTED', 'REJECTED', 'STARTED', 'ARRIVED', 'WORKING', 'FINISHED', 'REFUSED');

-- CreateEnum
CREATE TYPE "CallKind" AS ENUM ('CALLER_IN', 'BRIGADE_IN', 'BRIGADE_OUT', 'CALLER_OUT', 'SERVICE_OUT', 'CONTROL_IN');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ACTIVE', 'ENDED', 'MISSED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'CONFIRMED', 'OVERRIDDEN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "IncidentGroup" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "IncidentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentType" (
    "code" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "subgroup" TEXT,
    "sign1" TEXT,
    "sign2" TEXT,
    "sign3" TEXT,
    "extra" TEXT,
    "questions" TEXT[],
    "finalType" TEXT NOT NULL,
    "ekpType" TEXT,
    "mainService" TEXT,
    "scenarioCode" TEXT,
    "hiddenFromOperator" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "IncidentType_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" INTEGER NOT NULL,
    "shortName" TEXT NOT NULL,
    "fullName" TEXT,
    "kind" TEXT NOT NULL,
    "subtype" TEXT,
    "classifierCol" TEXT,
    "routeKeys" TEXT[],
    "delivery" "ServiceDelivery" NOT NULL DEFAULT 'ARM112',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "okrug" TEXT,
    "district" TEXT,
    "selectRule" TEXT,
    "phone" TEXT,
    "orderIdx" INTEGER NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" SERIAL NOT NULL,
    "typeCode" INTEGER NOT NULL,
    "routeKey" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "status" "ScenarioStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL,
    "ticketRef" TEXT,
    "caller" JSONB NOT NULL,
    "truth" JSONB NOT NULL,
    "ddsCard" JSONB,
    "ddsReference" JSONB,
    "approvedSections" TEXT[],
    "teacherNote" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "groupId" TEXT,
    "status" "LessonStatus" NOT NULL DEFAULT 'DRAFT',
    "settings" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seat" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "role" "SeatRole" NOT NULL,
    "serviceId" INTEGER,
    "scenarioIds" TEXT[],
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "lessonId" TEXT,
    "scenarioId" TEXT,
    "source" TEXT NOT NULL,
    "createdBySeatId" TEXT,
    "operatorNo" TEXT,
    "armNo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "caller" JSONB,
    "address" JSONB,
    "typeCodes" INTEGER[],
    "tags" JSONB,
    "flags" JSONB NOT NULL DEFAULT '{}',
    "description" TEXT,
    "descriptionLog" JSONB NOT NULL DEFAULT '[]',
    "important" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3),
    "workedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentService" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "addedBy" TEXT NOT NULL,
    "crewNumber" TEXT,
    "status" "ServiceStatus" NOT NULL DEFAULT 'ADDED',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusEvent" (
    "id" TEXT NOT NULL,
    "incidentServiceId" TEXT NOT NULL,
    "status" "ServiceStatus" NOT NULL,
    "comment" TEXT,
    "crewNumber" TEXT,
    "actorLabel" TEXT NOT NULL,
    "actorUserId" TEXT,
    "seatId" TEXT,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT,
    "seatId" TEXT,
    "incidentId" TEXT,
    "kind" "CallKind" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "counterpart" JSONB NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "audioPath" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" "SeatRole" NOT NULL,
    "incidentId" TEXT,
    "incidentServiceId" TEXT,
    "scenarioId" TEXT,
    "criteria" JSONB NOT NULL,
    "aiDraft" JSONB,
    "override" JSONB,
    "score" DOUBLE PRECISION,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "teacherComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeightProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT,
    "sizeBytes" BIGINT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "IncidentType_groupId_idx" ON "IncidentType"("groupId");

-- CreateIndex
CREATE INDEX "IncidentType_finalType_idx" ON "IncidentType"("finalType");

-- CreateIndex
CREATE INDEX "Service_okrug_district_idx" ON "Service"("okrug", "district");

-- CreateIndex
CREATE INDEX "Route_typeCode_idx" ON "Route"("typeCode");

-- CreateIndex
CREATE INDEX "Route_routeKey_idx" ON "Route"("routeKey");

-- CreateIndex
CREATE INDEX "Scenario_status_category_idx" ON "Scenario"("status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_lessonId_studentId_key" ON "Seat"("lessonId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_number_key" ON "Incident"("number");

-- CreateIndex
CREATE INDEX "Incident_lessonId_createdAt_idx" ON "Incident"("lessonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentService_incidentId_serviceId_key" ON "IncidentService"("incidentId", "serviceId");

-- CreateIndex
CREATE INDEX "StatusEvent_incidentServiceId_at_idx" ON "StatusEvent"("incidentServiceId", "at");

-- CreateIndex
CREATE INDEX "Call_seatId_startedAt_idx" ON "Call"("seatId", "startedAt");

-- CreateIndex
CREATE INDEX "Attempt_lessonId_studentId_idx" ON "Attempt"("lessonId", "studentId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentType" ADD CONSTRAINT "IncidentType_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "IncidentGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_typeCode_fkey" FOREIGN KEY ("typeCode") REFERENCES "IncidentType"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentService" ADD CONSTRAINT "IncidentService_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentService" ADD CONSTRAINT "IncidentService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEvent" ADD CONSTRAINT "StatusEvent_incidentServiceId_fkey" FOREIGN KEY ("incidentServiceId") REFERENCES "IncidentService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_incidentServiceId_fkey" FOREIGN KEY ("incidentServiceId") REFERENCES "IncidentService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Card numbers look like the real system (8 digits).
ALTER SEQUENCE "Incident_number_seq" RESTART WITH 36815001;
