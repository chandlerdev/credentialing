package com.zmartcredential.dto.enrollment;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;

public record EnrollmentRequest(
        @NotNull(message = "Provider is required")
        Long providerId,
        @NotNull(message = "Payer is required")
        Long payerId,
        @Pattern(regexp = "^(draft|in_progress|submitted|approved|needs_attention|on_hold|terminated)$",
                message = "Status must be draft, in_progress, submitted, approved, needs_attention, on_hold or terminated")
        String status,
        @Pattern(regexp = "^(initial|recred|update|terminate)$",
                message = "Application type must be initial, recred, update or terminate")
        String applicationType,
        Long practiceId,
        Long formId,
        LocalDate submittedDate,
        LocalDate effectiveDate,
        @Size(max = 5000, message = "Notes must be at most 5000 characters")
        String notes,
        Long assignedUserId,
        /* the last follow-up with the payer (today or earlier) */
        LocalDate followUpDate,
        LocalDate estApprovedDate,
        /* the next follow-up (today or later) */
        LocalDate nextFollowUpDate) {
}
