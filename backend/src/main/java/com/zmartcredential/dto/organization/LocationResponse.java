package com.zmartcredential.dto.organization;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public record LocationResponse(
        Long id,
        Long practiceId,
        String practiceName,
        String name,
        String legalName,
        String npi,
        String locationType,
        String address,
        String city,
        String state,
        String zip,
        String phone,
        BigDecimal lat,
        BigDecimal lng,
        boolean active,
        boolean testData,
        long providerCount,
        LocalDateTime createdAt,
        LocalDateTime updatedAt) {
}
