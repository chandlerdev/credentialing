package com.zmartcredential.repository;

import com.zmartcredential.entity.OrgMailSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface OrgMailSettingsRepository extends JpaRepository<OrgMailSettings, Long> {

    /** The organizations whose inbox is read for payer replies. */
    List<OrgMailSettings> findByEnabledTrueAndImapEnabledTrue();
}
