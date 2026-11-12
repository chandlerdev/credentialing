package com.zmartcredential.dto.organization;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;

/** Super admin → Organizations → Email Settings: the organization's own mail account. */
public final class OrgMailDtos {

    private OrgMailDtos() {
    }

    /** The password is never returned: passwordSet tells whether one is saved. */
    public record OrgMailSettingsView(Long orgId, boolean enabled, String fromName, String fromEmail,
                                      String smtpHost, Integer smtpPort, String smtpSecurity, String username,
                                      boolean passwordSet, boolean imapEnabled, String imapHost, Integer imapPort,
                                      String imapSecurity, String imapFolder, LocalDateTime lastInboxCheckAt,
                                      String lastInboxError, LocalDateTime updatedAt) {
    }

    /** password: blank keeps the saved one. */
    public record OrgMailSettingsRequest(
            boolean enabled,
            @Size(max = 120, message = "At most 120 characters") String fromName,
            @Email(message = "Enter a valid email address") @Size(max = 255) String fromEmail,
            @Size(max = 255) String smtpHost,
            @Min(value = 1, message = "Port 1-65535") @Max(value = 65535, message = "Port 1-65535") Integer smtpPort,
            @Pattern(regexp = "^$|starttls|ssl|none", message = "Choose STARTTLS, SSL or None") String smtpSecurity,
            @Size(max = 255) String username,
            @Size(max = 500) String password,
            boolean imapEnabled,
            @Size(max = 255) String imapHost,
            @Min(value = 1, message = "Port 1-65535") @Max(value = 65535, message = "Port 1-65535") Integer imapPort,
            @Pattern(regexp = "^$|ssl|starttls|none", message = "Choose SSL, STARTTLS or None") String imapSecurity,
            @Size(max = 120) String imapFolder) {
    }

    /** "Send test email" / "Test inbox" with what is in the form (saved or not); to: where the test email goes. */
    public record OrgMailTestRequest(
            @jakarta.validation.Valid OrgMailSettingsRequest settings,
            @Email(message = "Enter a valid email address") @Size(max = 255) String to) {
    }

    public record OrgMailTestResult(boolean ok, String message) {
    }
}
