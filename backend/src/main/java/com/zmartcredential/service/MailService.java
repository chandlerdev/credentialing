package com.zmartcredential.service;

import com.zmartcredential.config.AppProperties;
import com.zmartcredential.entity.OrgMailSettings;
import com.zmartcredential.repository.OrgMailSettingsRepository;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Sends email through the organization's own mail account (super admin → Organizations → Email Settings).
 * There is no shared fallback: when the organization has no account set up (or it is switched off) nothing is sent
 * and the result is "failed" with the reason, so the caller records it and tells the user.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailService {

    /** sent | failed; error is the reason when it failed. */
    public record Result(String status, String error, String messageId) {
        public Result(String status, String error) {
            this(status, error, null);
        }

        public boolean sent() {
            return "sent".equals(status);
        }
    }

    public static final String NOT_SET_UP = "Email is not set up for this organization. Ask the super admin to set it in Organizations → Email Settings.";
    public static final String TURNED_OFF = "Email sending is turned off for this organization (Organizations → Email Settings).";

    private static final Pattern URL = Pattern.compile("https?://[^\\s<]+");

    private final AppProperties props;
    private final OrgMailSettingsRepository settingsRepository;
    private final CryptoService cryptoService;

    /** One mail sender per organization, rebuilt when its settings change. */
    private final Map<Long, CachedSender> senders = new ConcurrentHashMap<>();

    private record CachedSender(java.time.LocalDateTime version, JavaMailSenderImpl sender) {
    }

    /** The organization's mail account, when it is complete. */
    public java.util.Optional<OrgMailSettings> settings(Long orgId) {
        if (orgId == null) return java.util.Optional.empty();
        return settingsRepository.findById(orgId).filter(MailService::complete);
    }

    /** True when the organization can send email (its own account is set up and switched on). */
    public boolean enabled(Long orgId) {
        return settings(orgId).map(s -> Boolean.TRUE.equals(s.getEnabled())).orElse(false);
    }

    /** The address the organization's emails go out from ("" when not set up). */
    public String fromAddress(Long orgId) {
        return settings(orgId).map(OrgMailSettings::getFromEmail).map(String::trim).orElse("");
    }

    public String fromName(Long orgId) {
        return settings(orgId).map(OrgMailSettings::getFromName).map(n -> n == null ? "" : n.trim()).orElse("");
    }

    /** Public site address for links in emails, without a trailing slash. */
    public String publicUrl() {
        String url = props.publicUrl();
        return url == null || url.isBlank() ? "" : url.replaceAll("/+$", "");
    }

    /**
     * Sends a plain-text body as a simple HTML email (line breaks kept, links clickable) with a text alternative,
     * from the organization's own account. Never throws: a failure is reported in the result.
     */
    public Result send(Long orgId, String to, String subject, String textBody) {
        OrgMailSettings s = settings(orgId).orElse(null);
        if (s == null) {
            log.warn("No mail account for organization {}; nothing sent to {}", orgId, to);
            return new Result("failed", NOT_SET_UP);
        }
        if (!Boolean.TRUE.equals(s.getEnabled())) return new Result("failed", TURNED_OFF);
        return sendWith(s, to, subject, textBody);
    }

    /** Sends through the given (possibly unsaved) settings — the Email Settings "Send test email". */
    public Result sendWith(OrgMailSettings s, String to, String subject, String textBody) {
        try {
            JavaMailSenderImpl sender = sender(s);
            MimeMessage message = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
            String from = s.getFromEmail().trim();
            String fromName = s.getFromName();
            helper.setFrom(fromName == null || fromName.isBlank()
                    ? new InternetAddress(from) : new InternetAddress(from, fromName.trim(), StandardCharsets.UTF_8.name()));
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(textBody, toHtml(textBody));
            sender.send(message);
            log.info("Mail sent for organization {} to {}: {}", s.getOrgId(), to, subject);
            return new Result("sent", null, message.getMessageID());
        } catch (Exception e) {
            String reason = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            log.warn("Could not send mail for organization {} to {}: {}", s.getOrgId(), to, reason);
            return new Result("failed", reason.length() > 300 ? reason.substring(0, 300) : reason);
        }
    }

    /** Every field needed to send is filled in. */
    public static boolean complete(OrgMailSettings s) {
        return s != null && notBlank(s.getFromEmail()) && notBlank(s.getSmtpHost()) && s.getSmtpPort() != null
                && notBlank(s.getUsername()) && notBlank(s.getPasswordEnc());
    }

    private JavaMailSenderImpl sender(OrgMailSettings s) {
        // a saved account is cached until it changes; test settings (not saved yet) get a new sender
        boolean saved = s.getOrgId() != null && s.getUpdatedAt() != null;
        if (saved) {
            CachedSender c = senders.get(s.getOrgId());
            if (c != null && c.version().equals(s.getUpdatedAt())) return c.sender();
        }
        JavaMailSenderImpl m = build(s, cryptoService.decrypt(s.getPasswordEnc()));
        if (saved) senders.put(s.getOrgId(), new CachedSender(s.getUpdatedAt(), m));
        return m;
    }

    /** An SMTP sender for the account (starttls on 587, ssl on 465, or none). */
    static JavaMailSenderImpl build(OrgMailSettings s, String password) {
        JavaMailSenderImpl m = new JavaMailSenderImpl();
        m.setHost(s.getSmtpHost().trim());
        m.setPort(s.getSmtpPort());
        m.setUsername(s.getUsername().trim());
        m.setPassword(password);
        m.setDefaultEncoding(StandardCharsets.UTF_8.name());
        Properties p = m.getJavaMailProperties();
        String sec = s.getSmtpSecurity() == null ? "starttls" : s.getSmtpSecurity();
        p.put("mail.smtp.auth", "true");
        p.put("mail.smtp.connectiontimeout", "15000");
        p.put("mail.smtp.timeout", "20000");
        p.put("mail.smtp.writetimeout", "20000");
        if ("ssl".equals(sec)) {
            p.put("mail.smtp.ssl.enable", "true");
        } else if ("starttls".equals(sec)) {
            p.put("mail.smtp.starttls.enable", "true");
            p.put("mail.smtp.starttls.required", "true");
        }
        return m;
    }

    private static boolean notBlank(String v) {
        return v != null && !v.isBlank();
    }

    /** Escapes the text, keeps line breaks and turns URLs into links. */
    static String toHtml(String text) {
        String escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
        Matcher m = URL.matcher(escaped);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String url = m.group();
            m.appendReplacement(sb, Matcher.quoteReplacement("<a href=\"" + url + "\" style=\"color:#ea580c\">" + url + "</a>"));
        }
        m.appendTail(sb);
        return "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0f172a\">"
                + sb.toString().replace("\r\n", "\n").replace("\n", "<br>")
                + "</div>";
    }
}
