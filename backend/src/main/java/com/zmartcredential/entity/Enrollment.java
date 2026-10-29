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

    /** the Next Follow Up Date already reminded about (FollowUpDueJob: each date once) */
    private LocalDate followUpNotifiedOn;

    // ---- payer submission workflow (credentialing-workflows.json): the step reached and its state (JSON)

    private Integer wfStep = 0;

    /** portal | phone */
    private String wfMethod;

    /** checklist ticks: {"request": {"0": true}} */
    private String wfTasks;

    /** step details: {"caseNo": "...", "submittedDate": "2026-10-01"} */
    private String wfFields;

    /** documents: {"State license": {"fileId": 5, "file": "lic.pdf"} | {"caqh": true}} */
    private String wfDocs;

    /** when each step was started: {"0": "2026-10-01T10:00:00"} */
    private String wfStepStarted;

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
