-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "ddsSeatId" TEXT;

-- CreateIndex
CREATE INDEX "Incident_ddsSeatId_createdAt_idx" ON "Incident"("ddsSeatId", "createdAt");
