package com.zmartcredential.service;

import com.zmartcredential.dto.organization.OrgMailDtos.OrgMailSettingsRequest;
import com.zmartcredential.dto.organization.OrgMailDtos.OrgMailSettingsView;
import com.zmartcredential.dto.organization.OrgMailDtos.OrgMailTestRequest;
import com.zmartcredential.dto.organization.OrgMailDtos.OrgMailTestResult;
import com.zmartcredential.entity.OrgMailSettings;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.OrgMailSettingsRepository;
import com.zmartcredential.repository.OrganizationRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.Role;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;

/**
 * Super admin → Organizations → Email Settings: each organization's own mail account — the outgoing server (SMTP) its
 * emails are sent through and the incoming server (IMAP) its payer replies are read from. The password is encrypted
 * and never returned.
 */
@Service
@RequiredArgsConstructor
public class OrgMailSettingsService {

    private final OrgMailSettingsRepository repository;
    private final OrganizationRepository organizationRepository;
    private final CryptoService cryptoService;
    private final MailService mailService;
    private final PayerInboxService inboxService;
    private final AuthContext authContext;

    @Transactional(readOnly = true)
    public OrgMailSettingsView get(Long orgId) {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        requireOrg(orgId);
        return view(repository.findById(orgId).orElseGet(() -> blank(orgId)));
    }

    @Transactional
    public OrgMailSettingsView save(Long orgId, OrgMailSettingsRequest req) {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        requireOrg(orgId);
        OrgMailSettings s = repository.findById(orgId).orElseGet(() -> blank(orgId));
        apply(s, req);
        validate(s, req.enabled());
        s.setUpdatedBy(authContext.userId());
        return view(repository.save(s));
    }

    /** Sends a test email with the form's settings (saved or not), to check them before saving. */
    @Transactional(readOnly = true)
    public OrgMailTestResult testSend(Long orgId, OrgMailTestRequest req) {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        String org = requireOrg(orgId);
        if (req.to() == null || req.to().isBlank()) throw BadRequestException.onField("to", "Enter the address to send the test email to");
        OrgMailSettings s = formSettings(orgId, req.settings());
        validate(s, true);
        MailService.Result r = mailService.sendWith(s, req.to().trim(), "Test email from " + org,
                "This is a test email from ZmartCredential for " + org + ".\n\nIf you received it, the organization's email settings work.");
        return r.sent() ? new OrgMailTestResult(true, "Test email sent to " + req.to().trim() + " from " + s.getFromEmail())
                : new OrgMailTestResult(false, "Could not send: " + r.error());
    }

    /** Connects to the incoming server with the form's settings and reads the inbox (nothing is changed). */
    @Transactional(readOnly = true)
    public OrgMailTestResult testInbox(Long orgId, OrgMailTestRequest req) {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        requireOrg(orgId);
        OrgMailSettings s = formSettings(orgId, req.settings());
        validate(s, true);
        if (!Boolean.TRUE.equals(s.getImapEnabled())) throw BadRequestException.onField("imapEnabled", "Turn on reading replies and fill in the incoming server");
        PayerInboxService.CheckResult r = inboxService.test(s, cryptoService.decrypt(s.getPasswordEnc()));
        return r.error() == null ? new OrgMailTestResult(true, "Connected to the inbox: " + r.checked() + " message(s) in the last 14 days")
                : new OrgMailTestResult(false, "Could not read the inbox: " + r.error());
    }

    // ---------- helpers

    /** The saved settings with the form applied (not saved): the password is the typed one, else the saved one. */
    private OrgMailSettings formSettings(Long orgId, OrgMailSettingsRequest req) {
        if (req == null) throw new BadRequestException("Fill in the email settings");
        OrgMailSettings saved = repository.findById(orgId).orElse(null);
        OrgMailSettings s = blank(orgId);
        if (saved != null) s.setPasswordEnc(saved.getPasswordEnc());
        apply(s, req);
        s.setUpdatedAt(null); // never the cached sender of the saved account
        return s;
    }

    private void apply(OrgMailSettings s, OrgMailSettingsRequest r) {
        s.setEnabled(r.enabled());
        s.setFromName(blankToNull(r.fromName()));
        s.setFromEmail(r.fromEmail() == null || r.fromEmail().isBlank() ? null : r.fromEmail().trim().toLowerCase(Locale.ROOT));
        s.setSmtpHost(blankToNull(r.smtpHost()));
        s.setSmtpPort(r.smtpPort());
        s.setSmtpSecurity(r.smtpSecurity() == null || r.smtpSecurity().isBlank() ? "starttls" : r.smtpSecurity());
        s.setUsername(blankToNull(r.username()));
        if (r.password() != null && !r.password().isBlank()) s.setPasswordEnc(cryptoService.encrypt(r.password()));
        s.setImapEnabled(r.imapEnabled());
        s.setImapHost(blankToNull(r.imapHost()));
        s.setImapPort(r.imapPort());
        s.setImapSecurity(r.imapSecurity() == null || r.imapSecurity().isBlank() ? "ssl" : r.imapSecurity());
        s.setImapFolder(blankToNull(r.imapFolder()));
    }

    /** When the account is on, everything needed to send (and to read replies, when that is on) is required. */
    private static void validate(OrgMailSettings s, boolean on) {
        if (!on) return;
        if (s.getFromEmail() == null) throw BadRequestException.onField("fromEmail", "From email is required");
        if (s.getSmtpHost() == null) throw BadRequestException.onField("smtpHost", "Outgoing server (SMTP host) is required");
        if (s.getSmtpPort() == null) throw BadRequestException.onField("smtpPort", "SMTP port is required");
        if (s.getUsername() == null) throw BadRequestException.onField("username", "Username is required");
        if (s.getPasswordEnc() == null) throw BadRequestException.onField("password", "Password is required");
        if (Boolean.TRUE.equals(s.getImapEnabled())) {
            if (s.getImapHost() == null) throw BadRequestException.onField("imapHost", "Incoming server (IMAP host) is required");
            if (s.getImapPort() == null) throw BadRequestException.onField("imapPort", "IMAP port is required");
        }
    }

    private String requireOrg(Long orgId) {
        return organizationRepository.findById(orgId).map(o -> o.getName())
                .orElseThrow(() -> NotFoundException.of("Organization", orgId));
    }

    private static OrgMailSettings blank(Long orgId) {
        OrgMailSettings s = new OrgMailSettings();
        s.setOrgId(orgId);
        return s;
    }

    private static OrgMailSettingsView view(OrgMailSettings s) {
        return new OrgMailSettingsView(s.getOrgId(), Boolean.TRUE.equals(s.getEnabled()), s.getFromName(), s.getFromEmail(),
                s.getSmtpHost(), s.getSmtpPort(), s.getSmtpSecurity(), s.getUsername(), s.getPasswordEnc() != null,
                Boolean.TRUE.equals(s.getImapEnabled()), s.getImapHost(), s.getImapPort(), s.getImapSecurity(), s.getImapFolder(),
                s.getLastInboxCheckAt(), s.getLastInboxError(), s.getUpdatedAt());
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }
}
