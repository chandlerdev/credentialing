package com.zmartcredential.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

/** The platform's Twilio account for browser calling (super admin → Communication; one row, id 1); the secrets are encrypted. */
@Entity
@Table(name = "calling_settings")
@Getter
@Setter
@NoArgsConstructor
public class CallingSettings {

    public static final long ID = 1L;

    @Id
    private Long id;

    private Boolean enabled = false;

    private String accountSid;

    private String apiKeySid;

    private String apiKeySecretEnc;

    private String authTokenEnc;

    /** E.164, e.g. +18005550100 */
    private String phoneNumber;

    /** the TwiML App the browser calls go through (created on save) */
    private String twimlAppSid;

    private String updatedBy;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
