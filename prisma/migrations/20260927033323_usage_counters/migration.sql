-- CreateTable
CREATE TABLE "UsageCounter" (
    "day" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("day","name")
);

