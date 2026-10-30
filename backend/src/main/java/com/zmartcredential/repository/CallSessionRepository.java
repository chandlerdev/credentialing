package com.zmartcredential.repository;

import com.zmartcredential.entity.CallSession;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CallSessionRepository extends JpaRepository<CallSession, String> {
}
