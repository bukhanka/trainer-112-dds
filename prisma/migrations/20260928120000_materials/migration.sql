-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'all',
    "lessonId" TEXT,
    "ownerId" TEXT,
    "ownerName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Material_storedName_key" ON "Material"("storedName");

-- CreateIndex
CREATE INDEX "Material_audience_createdAt_idx" ON "Material"("audience", "createdAt");

-- CreateIndex
CREATE INDEX "Material_lessonId_idx" ON "Material"("lessonId");

