package com.zmartcredential.dto.enrollment;

import java.time.LocalDate;
import java.time.LocalDateTime;

public record EnrollmentResponse(
        Long id,
        Long providerId,
        String providerName,
        String providerNpi,
        Long payerId,
        String payerName,
        String payerColor,
        Long practiceId,
        String practiceName,
        Long formId,
        String formLabel,
        String applicationType,
        String status,
        LocalDate submittedDate,
        LocalDate effectiveDate,
        Integer tatDays,
        String notes,
        Long assignedUserId,
        String assignedUserName,
        int fileCount,
        int eventCount,
        LocalDateTime lastActivityAt,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        LocalDate followUpDate,
        LocalDate estApprovedDate,
        LocalDateTime notesUpdatedAt,
        String notesUpdatedBy,
        /* the payer's acknowledgement / approval certificate (latest 'acknowledgement' file) */
        Long acknowledgementFileId,
        String acknowledgementFileName,
        String acknowledgementMimeType) {
}
