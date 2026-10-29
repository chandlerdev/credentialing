package com.zmartcredential.service;

import com.zmartcredential.config.AppProperties;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Sends email through the SMTP server in spring.mail.* (same approach as the zmart commerce project).
 * Disabled by default (app.mail.enabled=false): nothing is sent and the caller records the message as "queued",
 * so local development needs no mail server.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailService {

    /** sent | failed | queued (sending disabled); error is the server's message when it failed. */
    public record Result(String status, String error, String messageId) {
        public Result(String status, String error) {
            this(status, error, null);
        }

        public boolean sent() {
            return "sent".equals(status);
        }
    }

    private static final Pattern URL = Pattern.compile("https?://[^\\s<]+");

    private final ObjectProvider<JavaMailSender> senders;
    private final AppProperties props;

    public boolean enabled() {
        return props.mail() != null && props.mail().enabled();
    }

    /** The sender address emails go out from ("" when not configured). */
    public String fromAddress() {
        String from = props.mail() == null ? null : props.mail().from();
        return from == null ? "" : from.trim();
    }

    public String fromName() {
        String n = props.mail() == null ? null : props.mail().fromName();
        return n == null ? "" : n.trim();
    }

    /** Public site address for links in emails, without a trailing slash. */
    public String publicUrl() {
        String url = props.publicUrl();
        return url == null || url.isBlank() ? "" : url.replaceAll("/+$", "");
    }

    /**
     * Sends a plain-text body as a simple HTML email (line breaks kept, links clickable) with a text alternative.
     * Never throws: a failed send is reported in the result so the caller can record it and tell the user.
     */
    public Result send(String to, String subject, String textBody) {
        if (!enabled()) {
            log.info("[mail disabled] to={} subject={}", to, subject);
            return new Result("queued", null);
        }
        JavaMailSender sender = senders.getIfAvailable();
        String from = props.mail().from();
        if (sender == null || from == null || from.isBlank()) {
            log.warn("Mail is enabled but spring.mail.host / app.mail.from are not set; nothing sent to {}", to);
            return new Result("failed", "Email is not configured on the server (SMTP host or sender address missing)");
        }
        try {
            MimeMessage message = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
            String fromName = props.mail().fromName();
            helper.setFrom(fromName == null || fromName.isBlank()
                    ? new InternetAddress(from) : new InternetAddress(from, fromName, StandardCharsets.UTF_8.name()));
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(textBody, toHtml(textBody));
            sender.send(message);
            log.info("Mail sent to {}: {}", to, subject);
            return new Result("sent", null, message.getMessageID());
        } catch (Exception e) {
            String reason = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            log.warn("Could not send mail to {}: {}", to, reason);
            return new Result("failed", reason.length() > 300 ? reason.substring(0, 300) : reason);
        }
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
