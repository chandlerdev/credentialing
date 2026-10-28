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
@Table(name = "enrollment")
@Getter
@Setter
@NoArgsConstructor
/** Deleting marks the row deleted (is_deleted = 1); deleted rows are left out of every query. */
@org.hibernate.annotations.SoftDelete(columnName = "is_deleted")
public class Enrollment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long orgId;

    private Long providerId;

    private Long payerId;

    private Long practiceId;

    private Long formId;

    private String applicationType = "initial";

    private String status = "draft";

    private LocalDate submittedDate;

    /** The approved date (kept in effective_date; the turnaround is submitted → approved). */
    private LocalDate effectiveDate;

    /** Last follow-up with the payer (today or earlier). */
    private LocalDate followUpDate;

    /** Next follow-up with the payer (today or later when set). */
    private LocalDate nextFollowUpDate;

    /** Estimated approval date (today or later when set). */
    private LocalDate estApprovedDate;

    private Integer tatDays;

    private String notes;

    /** when the notes were last changed, and by whom (display name) */
    private java.time.LocalDateTime notesUpdatedAt;

    private String notesUpdatedBy;

    private Long assignedUserId;

    @Column(name = "is_test_data")
    private Boolean testData = false;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
