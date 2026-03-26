-- CreateTable
CREATE TABLE `devices` (
    `device_id` VARCHAR(50) NOT NULL,
    `device_name` VARCHAR(100) NOT NULL,
    `location` VARCHAR(100) NULL,
    `total_transcriptions` INTEGER NOT NULL DEFAULT 0,
    `last_transcription_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`device_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transcriptions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `device_id` VARCHAR(50) NOT NULL,
    `transcription_text` TEXT NOT NULL,
    `audio_duration_ms` INTEGER NULL,
    `confidence_score` DECIMAL(3, 2) NULL,
    `language` VARCHAR(10) NOT NULL DEFAULT 'es',
    `model_used` VARCHAR(50) NOT NULL DEFAULT 'whisper-tiny',
    `transcription_time_ms` INTEGER NULL,
    `sample_rate` INTEGER NOT NULL DEFAULT 16000,
    `is_simulation` BOOLEAN NOT NULL DEFAULT false,
    `recorded_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `metadata` JSON NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(50) NOT NULL,
    `project_slug` VARCHAR(100) NULL,
    `messages` JSON NOT NULL,
    `summary` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `closed_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tasks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `due_at` DATETIME(3) NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `project_slug` VARCHAR(100) NULL,
    `source` VARCHAR(50) NOT NULL DEFAULT 'edy',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `slug` VARCHAR(100) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `context_path` VARCHAR(500) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`slug`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `transcriptions` ADD CONSTRAINT `transcriptions_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`device_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`device_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
