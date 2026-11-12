package com.zmartcredential.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * An organization's own mail account (super admin → Organizations → Email Settings): every email of the organization
 * is sent through it and payer replies are read from its inbox. The password is encrypted (CryptoService).
 */
@Entity
@Table(name = "org_mail_settings")
@Getter
@Setter
@NoArgsConstructor
public class OrgMailSettings {

    @Id
    private Long orgId;

    private Boolean enabled = false;

    private String fromName;

    private String fromEmail;

    private String smtpHost;

    private Integer smtpPort;

    /** starttls | ssl | none */
    private String smtpSecurity;

    private String username;

    private String passwordEnc;

    private Boolean imapEnabled = false;

    private String imapHost;

    private Integer imapPort;

    /** ssl | starttls | none */
    private String imapSecurity;

    private String imapFolder;

    private LocalDateTime lastInboxCheckAt;

    private String lastInboxError;

    private Long updatedBy;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
