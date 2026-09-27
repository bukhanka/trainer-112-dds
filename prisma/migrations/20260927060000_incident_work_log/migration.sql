-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "workLog" JSONB NOT NULL DEFAULT '[]';
