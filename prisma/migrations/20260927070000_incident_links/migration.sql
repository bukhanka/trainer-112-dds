-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "linkedToId" TEXT;

-- CreateIndex
CREATE INDEX "Incident_linkedToId_idx" ON "Incident"("linkedToId");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_linkedToId_fkey" FOREIGN KEY ("linkedToId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

