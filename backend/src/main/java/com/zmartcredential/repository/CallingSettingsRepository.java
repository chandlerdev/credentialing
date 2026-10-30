package com.zmartcredential.repository;

import com.zmartcredential.entity.CallingSettings;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CallingSettingsRepository extends JpaRepository<CallingSettings, Long> {

    List<CallingSettings> findByAccountSid(String accountSid);
}
