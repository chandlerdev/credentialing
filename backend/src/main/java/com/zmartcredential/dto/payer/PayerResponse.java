package com.zmartcredential.dto.payer;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

public record PayerResponse(
        Long id,
        String code,
        String name,
        String fullName,
        String category,
        String payerType,
        String color,
        String appForm,
        String integration,
        String apiSupport,
        String submissionMethod,
        Boolean apiAvailable,
        String apiVendor,
        String apiDocsUrl,
        String submissionNotes,
        Boolean caqhParticipating,
        String portalUrl,
        Integer avgTatDays,
        String pricingCategory,
        BigDecimal pricingMult,
        Integer recredCycleMonths,
        Integer sortOrder,
        Boolean active,
        List<PayerFormResponse> forms,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        String logo,
        Boolean portalAvailable,
        /* API access: whether a key / token is saved (the values are never returned) */
        boolean hasApiKey,
        boolean hasApiToken,
        String caqhUpdate,
        String supportEmail,
        String supportPhone) {
}
