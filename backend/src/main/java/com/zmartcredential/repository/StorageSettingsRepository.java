package com.zmartcredential.repository;

import com.zmartcredential.entity.StorageSettings;
import org.springframework.data.jpa.repository.JpaRepository;

public interface StorageSettingsRepository extends JpaRepository<StorageSettings, Long> {
}
