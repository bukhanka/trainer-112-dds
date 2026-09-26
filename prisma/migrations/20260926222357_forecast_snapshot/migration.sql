-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "role" "SeatRole" NOT NULL,
    "expected" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "baseline" DOUBLE PRECISION,
    "trend" DOUBLE PRECISION,
    "lessons" INTEGER NOT NULL DEFAULT 0,
    "pOnTime" DOUBLE PRECISION,
    "normSec" INTEGER,
    "rating" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForecastSnapshot_studentId_idx" ON "ForecastSnapshot"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSnapshot_lessonId_studentId_key" ON "ForecastSnapshot"("lessonId", "studentId");

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
