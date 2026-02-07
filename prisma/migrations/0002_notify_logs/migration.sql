CREATE TABLE "notify_logs" (
  "id" SERIAL NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL,
  "app_id" TEXT,
  "platform" TEXT,
  "tokens_count" INTEGER,
  "title" TEXT,
  "body" TEXT,
  "data" JSONB,
  "request_id" TEXT,
  "client_ip" TEXT,
  "user_agent" TEXT,
  "client_name" TEXT,
  "status" INTEGER NOT NULL,
  "success" BOOLEAN NOT NULL,
  "duration_ms" INTEGER,
  "result" JSONB,
  "error" TEXT,

  CONSTRAINT "notify_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notify_logs_created_at_idx" ON "notify_logs"("created_at");
CREATE INDEX "notify_logs_app_id_idx" ON "notify_logs"("app_id");
