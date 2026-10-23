package com.zmartcredential.dto.provider;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public final class ProviderDocumentDtos {

    private ProviderDocumentDtos() {
    }

    /** One checklist row (provider_document joined with document_type). */
    public record ProviderDocumentRow(
            Long id, Long providerId, String docType, String label, boolean critical, boolean expires,
            Integer sortOrder, String status, String fileName, String mimeType, Long sizeBytes,
            String originalRelativePath, LocalDate expiresAt, Long daysUntilExpiry,
            LocalDateTime uploadedAt, boolean hasFile,
            String notes, LocalDateTime notesUpdatedAt, String notesUpdatedBy) {
    }

    /** Staff notes on a document or enrollment (empty clears them). */
    public record NotesRequest(@Size(max = 5000, message = "Notes can be at most 5000 characters") String notes) {
    }

    /** Per-file outcome of an upload. classification: manual (docType given) | filename (guessed). */
    public record ProviderUploadedFile(String fileName, String docType, String label, String classification,
                                       String status) {
    }

    public record ProviderUploadResult(List<ProviderUploadedFile> uploaded, List<ProviderDocumentRow> documents) {
    }

    public record ProviderClassifyRequest(
            @NotEmpty(message = "No files to classify") @Size(max = 200) List<String> fileNames) {
    }

    /** confidence is always "filename" (keyword match); AI classification is deferred. */
    public record ProviderClassification(String fileName, String docType, String label, String confidence) {
    }

    public record ProviderDocumentPatchRequest(
            @Pattern(regexp = "approved|missing|expired|pending_review|na",
                    message = "Status must be approved, missing, expired, pending_review or na") String status,
            LocalDate expiresAt,
            Boolean clearExpiresAt) {
    }

    /** status: uploaded | skipped. */
    public record ProviderBatchFileResult(String fileName, String relativePath, String docType, String label,
                                          String status, String reason) {
    }
}
