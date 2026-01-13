CREATE TABLE "admin_settings" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,

  CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "admin_users" (
  "id" SERIAL NOT NULL,
  "username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

CREATE TABLE "apps" (
  "app_id" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "api_secret" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "apps_pkey" PRIMARY KEY ("app_id")
);

CREATE TABLE "app_ios" (
  "app_id" TEXT NOT NULL,
  "bundle_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "key_path" TEXT NOT NULL,
  "production" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "app_ios_pkey" PRIMARY KEY ("app_id")
);

CREATE TABLE "app_android" (
  "app_id" TEXT NOT NULL,
  "service_account_path" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "app_android_pkey" PRIMARY KEY ("app_id")
);

CREATE TABLE "nonces" (
  "app_id" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "nonces_pkey" PRIMARY KEY ("app_id", "nonce")
);

CREATE INDEX "nonces_expires_at_idx" ON "nonces"("expires_at");

ALTER TABLE "app_ios" ADD CONSTRAINT "app_ios_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("app_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "app_android" ADD CONSTRAINT "app_android_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("app_id") ON DELETE CASCADE ON UPDATE CASCADE;
