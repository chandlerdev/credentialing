package com.zmartcredential.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/** A browser call placed through Twilio, keyed by the browser leg's CallSid; Twilio reports the payer's answer. */
@Entity
@Table(name = "call_session")
@Getter
@Setter
@NoArgsConstructor
public class CallSession {

    @Id
    private String callSid;

    private Long orgId;

    private Long enrollmentId;

    private Long userId;

    private String toNumber;

    /** completed | busy | no-answer | failed | canceled (Twilio DialCallStatus) */
    private String dialStatus;

    /** seconds the payer was connected */
    private Integer dialDuration;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
