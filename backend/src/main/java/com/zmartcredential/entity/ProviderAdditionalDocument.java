package com.zmartcredential.entity;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** An extra document a provider added (My Documents → Add More Document). Deleting marks it deleted. */
@Entity
@Table(name = "provider_additional_document")
@org.hibernate.annotations.SoftDelete(columnName = "is_deleted")
@Getter
@Setter
@NoArgsConstructor
public class ProviderAdditionalDocument {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long orgId;

    private Long providerId;

    private String docType;

    private String title;

    private String notes;

    /** when the notes were last changed, and by whom (display name) */
    private java.time.LocalDateTime notesUpdatedAt;

    private String notesUpdatedBy;

    private LocalDate expiresAt;

    private String fileName;

    private String storageKey;

    private String mimeType;

    private Long sizeBytes;

    private String status = "pending_review";

    private Long uploadedBy;

    private LocalDateTime uploadedAt;
}
