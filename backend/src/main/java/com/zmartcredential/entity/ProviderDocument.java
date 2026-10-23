package com.zmartcredential.entity;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "provider_document")
@Getter
@Setter
@NoArgsConstructor
/** Deleting marks the row deleted (is_deleted = 1); deleted rows are left out of every query. */
@org.hibernate.annotations.SoftDelete(columnName = "is_deleted")
public class ProviderDocument {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long orgId;

    private Long providerId;

    private String docType;

    private String status = "missing";

    private String fileName;

    private String storageKey;

    private String mimeType;

    private Long sizeBytes;

    private String originalRelativePath;

    private LocalDate expiresAt;

    private LocalDateTime uploadedAt;

    private Long uploadedBy;

    /** staff notes: why the document is pending / on hold, what was agreed by phone or email */
    private String notes;

    /** when the notes were last changed, and by whom (display name) */
    private java.time.LocalDateTime notesUpdatedAt;

    private String notesUpdatedBy;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
