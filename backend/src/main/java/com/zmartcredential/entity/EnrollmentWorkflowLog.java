package com.zmartcredential.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

/** One entry of a payer workflow's activity: a call, an email, a step, a checklist item, a detail or a file. */
@Entity
@Table(name = "enrollment_workflow_log")
@Getter
@Setter
@NoArgsConstructor
public class EnrollmentWorkflowLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long orgId;

    private Long enrollmentId;

    /** call | email | stage | task | field | file */
    private String logType;

    private String text;

    private String callOutcome;

    private String callRef;

    private Integer callMinutes;

    private String emailTo;

    private String emailSubject;

    /** sent | drafted | queued (mail sending off) | received (the payer's reply) */
    private String emailStatus;

    /** a call: the payer was reached (communication happened) */
    private Boolean callAttended;

    private String emailFrom;

    private String emailBody;

    /** the Message-ID of the email (ours: to match the payer's reply; theirs: logged once) */
    private String messageId;

    private Long createdBy;

    private String createdByName;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;
}
