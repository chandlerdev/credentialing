package com.zmartcredential.service;

import com.zmartcredential.entity.Enrollment;
import com.zmartcredential.entity.EnrollmentWorkflowLog;
import com.zmartcredential.repository.EnrollmentRepository;
import com.zmartcredential.repository.EnrollmentWorkflowLogRepository;
import com.zmartcredential.repository.PayerRepository;
import com.zmartcredential.repository.ProviderRepository;
import jakarta.mail.Address;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.Store;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.search.ComparisonTerm;
import jakarta.mail.search.ReceivedDateTerm;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The payers' replies to the emails sent from Payer Submission: the organization's mailbox (the sender address) is read
 * over IMAP and each reply is logged on the enrollment it answers — matched by its In-Reply-To / References headers
 * (the Message-ID of the email we sent), else by the sender being the address we wrote to with the same subject.
 * Read-only: nothing in the mailbox is changed. On whenever email sending is on (app.mail.enabled), with the sending
 * account (spring.mail.username / password) and its IMAP server (smtp.x → imap.x); app.mail.inbox.* overrides.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PayerInboxService {

    private static final Pattern MSG_ID = Pattern.compile("<[^<>\\s]+>");
    private static final Pattern REPLY_PREFIX = Pattern.compile("^\\s*((re|fw|fwd|aw|sv)\\s*(\\[\\d+])?\\s*:\\s*)+", Pattern.CASE_INSENSITIVE);
    private static final Pattern QUOTE_START = Pattern.compile("(?m)^(On .{3,200}wrote:\\s*$|-{2,}\\s*Original Message\\s*-{2,}|_{5,}\\s*$|From: .+$)");

    private final EnrollmentWorkflowLogRepository logRepository;
    private final EnrollmentRepository enrollmentRepository;
    private final ProviderRepository providerRepository;
    private final PayerRepository payerRepository;
    private final NotificationService notificationService;

    @Value("${app.mail.inbox.enabled:${app.mail.enabled:false}}")
    private boolean enabled;
    @Value("${app.mail.inbox.host:}")
    private String inboxHost;
    @Value("${spring.mail.host:}")
    private String smtpHost;
    @Value("${app.mail.inbox.port:993}")
    private int port;
    @Value("${app.mail.inbox.username:${spring.mail.username:}}")
    private String username;
    @Value("${app.mail.inbox.password:${spring.mail.password:}}")
    private String password;
    @Value("${app.mail.inbox.folder:INBOX}")
    private String folderName;
    @Value("${app.mail.inbox.days:14}")
    private int days;

    public record CheckResult(boolean enabled, int checked, int logged, String error) {
    }

    /** The IMAP server: app.mail.inbox.host, else the SMTP server with smtp. → imap. (smtp.ionos.com → imap.ionos.com). */
    private String host() {
        if (inboxHost != null && !inboxHost.isBlank()) return inboxHost.trim();
        if (smtpHost == null || smtpHost.isBlank()) return "";
        String h = smtpHost.trim();
        return h.startsWith("smtp.") ? "imap." + h.substring(5) : h;
    }

    public boolean enabled() {
        String host = host();
        return enabled && !host.isBlank() && username != null && !username.isBlank() && password != null && !password.isBlank();
    }

    @Scheduled(initialDelayString = "PT3M", fixedDelayString = "${app.mail.inbox.poll:PT5M}")
    public void poll() {
        if (enabled()) check();
    }

    /** Reads the mailbox's recent messages and logs the payer replies not logged yet. */
    public synchronized CheckResult check() {
        if (!enabled()) return new CheckResult(false, 0, 0, null);
        Properties props = new Properties();
        props.put("mail.store.protocol", "imaps");
        props.put("mail.imaps.connectiontimeout", "15000");
        props.put("mail.imaps.timeout", "30000");
        int checked = 0, logged = 0;
        try {
            Store store = Session.getInstance(props).getStore("imaps");
            store.connect(host(), port, username, password);
            try {
                Folder folder = store.getFolder(folderName);
                folder.open(Folder.READ_ONLY);
                try {
                    Date since = Date.from(LocalDate.now().minusDays(Math.max(1, days)).atStartOfDay(ZoneId.systemDefault()).toInstant());
                    for (Message m : folder.search(new ReceivedDateTerm(ComparisonTerm.GE, since))) {
                        checked++;
                        if (m instanceof MimeMessage mm && ingest(mm).isPresent()) logged++;
                    }
                } finally {
                    folder.close(false);
                }
            } finally {
                store.close();
            }
            if (logged > 0) log.info("Payer inbox: {} checked, {} replies logged", checked, logged);
            return new CheckResult(true, checked, logged, null);
        } catch (Exception ex) {
            log.warn("Payer inbox check failed: {}", ex.getMessage());
            return new CheckResult(true, checked, logged, ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage());
        }
    }

    /** A raw email (RFC 822) — for testing the matching (app.mail.inbox.test-ingest=true). */
    public Optional<EnrollmentWorkflowLog> ingestRaw(String raw) throws Exception {
        MimeMessage m = new MimeMessage(Session.getInstance(new Properties()), new ByteArrayInputStream(raw.getBytes(StandardCharsets.UTF_8)));
        return ingest(m);
    }

    /** Logs the message on the enrollment it answers; empty when it answers none of our emails or is already logged. */
    @Transactional
    public Optional<EnrollmentWorkflowLog> ingest(MimeMessage m) throws Exception {
        String messageId = m.getMessageID();
        if (messageId != null && logRepository.existsByMessageId(messageId)) return Optional.empty();
        String from = firstAddress(m.getFrom());
        if (from == null) return Optional.empty();
        String subject = m.getSubject() == null ? "" : m.getSubject().trim();
        EnrollmentWorkflowLog ours = match(m, from, subject).orElse(null);
        if (ours == null) return Optional.empty();
        Enrollment e = enrollmentRepository.findById(ours.getEnrollmentId()).orElse(null);
        if (e == null || !e.getOrgId().equals(ours.getOrgId())) return Optional.empty();

        String body = reply(text(m));
        EnrollmentWorkflowLog l = new EnrollmentWorkflowLog();
        l.setOrgId(e.getOrgId());
        l.setEnrollmentId(e.getId());
        l.setLogType("email");
        String sub = subject.length() > 255 ? subject.substring(0, 255) : subject;
        String text = "Reply received from " + from + ": \"" + sub + "\"" + (body.isBlank() ? "" : " — " + body);
        l.setText(text.length() > 2000 ? text.substring(0, 1997) + "…" : text);
        l.setEmailFrom(from);
        l.setEmailTo(firstAddress(m.getRecipients(Message.RecipientType.TO)));
        l.setEmailSubject(sub);
        l.setEmailBody(body.length() > 20000 ? body.substring(0, 20000) : body);
        l.setEmailStatus("received");
        l.setMessageId(messageId);
        l.setCreatedByName(trim120(from));
        l = logRepository.save(l);

        String provider = providerRepository.findById(e.getProviderId()).map(p -> (nz(p.getFirstName()) + " " + nz(p.getLastName())).trim()).orElse("");
        String payer = payerRepository.findById(e.getPayerId()).map(p -> p.getName()).orElse("");
        notificationService.notifyOrg(e.getOrgId(), "Payer replied", payer + " replied about " + provider + ": \"" + sub + "\"", "MailOpen", NotificationService.INFO);
        return Optional.of(l);
    }

    /** The email of ours it answers: by the reply headers, else the address we wrote to and the subject. */
    private Optional<EnrollmentWorkflowLog> match(MimeMessage m, String from, String subject) throws Exception {
        Set<String> refs = new LinkedHashSet<>();
        for (String h : List.of("In-Reply-To", "References")) {
            String[] values = m.getHeader(h);
            if (values == null) continue;
            for (String v : values) {
                Matcher x = MSG_ID.matcher(v);
                while (x.find()) refs.add(x.group());
            }
        }
        if (!refs.isEmpty()) {
            Optional<EnrollmentWorkflowLog> byRef = logRepository.findByMessageIdIn(refs).stream()
                    .filter(l -> "email".equals(l.getLogType()) && !"received".equals(l.getEmailStatus())).findFirst();
            if (byRef.isPresent()) return byRef;
        }
        String base = REPLY_PREFIX.matcher(subject).replaceFirst("").trim();
        if (base.isEmpty()) return Optional.empty();
        return logRepository.findFirstByLogTypeAndEmailToIgnoreCaseAndEmailSubjectIgnoreCaseOrderByIdDesc("email", from, base)
                .filter(l -> !"received".equals(l.getEmailStatus()));
    }

    private static String firstAddress(Address[] list) {
        if (list == null) return null;
        for (Address a : list) if (a instanceof InternetAddress ia && ia.getAddress() != null) return ia.getAddress().toLowerCase(Locale.ROOT);
        return null;
    }

    /** The message text: the plain-text part, else the HTML part without tags. */
    static String text(Part p) throws Exception {
        if (p.isMimeType("text/plain")) return String.valueOf(p.getContent());
        if (p.isMimeType("text/html")) return html(String.valueOf(p.getContent()));
        if (p.isMimeType("multipart/*")) {
            Multipart mp = (Multipart) p.getContent();
            String html = null;
            for (int i = 0; i < mp.getCount(); i++) {
                Part b = mp.getBodyPart(i);
                if (Part.ATTACHMENT.equalsIgnoreCase(b.getDisposition())) continue;
                if (b.isMimeType("text/plain")) return String.valueOf(b.getContent());
                String t = text(b);
                if (!t.isBlank() && html == null) html = t;
            }
            return html == null ? "" : html;
        }
        return "";
    }

    private static String html(String s) {
        return s.replaceAll("(?is)<(script|style)[^>]*>.*?</\\1>", "").replaceAll("(?i)<br\\s*/?>|</p>|</div>", "\n")
                .replaceAll("<[^>]+>", "").replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&");
    }

    /** The reply itself: the quoted original ("On … wrote:", "> …") is left out. */
    static String reply(String text) {
        String t = text.replace("\r\n", "\n");
        Matcher q = QUOTE_START.matcher(t);
        if (q.find() && q.start() > 0) t = t.substring(0, q.start());
        List<String> lines = new ArrayList<>();
        for (String line : t.split("\n")) if (!line.startsWith(">")) lines.add(line);
        return String.join("\n", lines).replaceAll("\n{3,}", "\n\n").trim();
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String trim120(String s) {
        return s == null ? null : s.length() > 120 ? s.substring(0, 120) : s;
    }
}
