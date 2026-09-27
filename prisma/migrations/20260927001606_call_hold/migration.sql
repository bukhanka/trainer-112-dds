-- AlterEnum
ALTER TYPE "CallStatus" ADD VALUE 'HELD';

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "holds" JSONB NOT NULL DEFAULT '[]';
