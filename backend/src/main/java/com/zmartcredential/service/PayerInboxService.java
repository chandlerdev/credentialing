package com.zmartcredential.service;

import com.zmartcredential.entity.Enrollment;
import com.zmartcredential.entity.EnrollmentWorkflowLog;
import com.zmartcredential.entity.OrgMailSettings;
import com.zmartcredential.repository.EnrollmentRepository;
import com.zmartcredential.repository.EnrollmentWorkflowLogRepository;
import com.zmartcredential.repository.OrgMailSettingsRepository;
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
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The payers' replies to the emails sent from Payer Submission / Enrollments: each organization's own mailbox (its mail
 * account, super admin → Organizations → Email Settings) is read over IMAP and each reply is logged on the enrollment
 * of that organization it answers — matched by its In-Reply-To / References headers (the Message-ID of the email we
 * sent), else by the sender being the address we wrote to with the same subject. Read-only: nothing in the mailbox is
 * changed.
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

    private final OrgMailSettingsRepository settingsRepository;
    private final CryptoService cryptoService;

    /** How many days back the mailbox is read. */
    private static final int DAYS = 14;

    public record CheckResult(boolean enabled, int checked, int logged, String error) {
    }

    /** True when the organization's inbox is read (its mail account is on and has an incoming server). */
    public boolean enabled(Long orgId) {
        if (orgId == null) return false;
        return settingsRepository.findById(orgId).map(PayerInboxService::readable).orElse(false);
    }

    private static boolean readable(OrgMailSettings s) {
        return Boolean.TRUE.equals(s.getEnabled()) && Boolean.TRUE.equals(s.getImapEnabled()) && MailService.complete(s)
                && s.getImapHost() != null && !s.getImapHost().isBlank() && s.getImapPort() != null;
    }

    /** Every few minutes: each organization's own inbox. */
    @Scheduled(initialDelayString = "PT3M", fixedDelayString = "${app.mail.inbox.poll:PT5M}")
    public void poll() {
        for (OrgMailSettings s : settingsRepository.findByEnabledTrueAndImapEnabledTrue()) {
            if (readable(s)) check(s.getOrgId());
        }
    }

    /** Reads the organization's mailbox (recent messages) and logs the payer replies not logged yet. */
    public synchronized CheckResult check(Long orgId) {
        OrgMailSettings s = orgId == null ? null : settingsRepository.findById(orgId).orElse(null);
        if (s == null || !readable(s)) return new CheckResult(false, 0, 0, null);
        int[] counts = {0, 0};
        String error = null;
        try {
            read(s, cryptoService.decrypt(s.getPasswordEnc()), m -> {
                counts[0]++;
                if (m instanceof MimeMessage mm && ingest(mm, orgId).isPresent()) counts[1]++;
            });
            if (counts[1] > 0) log.info("Payer inbox of organization {}: {} checked, {} replies logged", orgId, counts[0], counts[1]);
        } catch (Exception ex) {
            error = ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
            log.warn("Payer inbox check of organization {} failed: {}", orgId, error);
        }
        s.setLastInboxCheckAt(java.time.LocalDateTime.now());
        s.setLastInboxError(error == null ? null : error.length() > 500 ? error.substring(0, 500) : error);
        settingsRepository.save(s);
        return new CheckResult(true, counts[0], counts[1], error);
    }

    /** Email Settings "Test inbox": connects with the given (possibly unsaved) settings and counts recent messages. */
    public CheckResult test(OrgMailSettings s, String password) {
        int[] counts = {0};
        try {
            read(s, password, m -> counts[0]++);
            return new CheckResult(true, counts[0], 0, null);
        } catch (Exception ex) {
            return new CheckResult(true, counts[0], 0, ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage());
        }
    }

    private interface MessageVisitor {
        void visit(Message m) throws Exception;
    }

    /** Opens the account's folder read-only and visits the messages of the last days. */
    private static void read(OrgMailSettings s, String password, MessageVisitor visitor) throws Exception {
        String sec = s.getImapSecurity() == null ? "ssl" : s.getImapSecurity();
        String protocol = "ssl".equals(sec) ? "imaps" : "imap";
        Properties props = new Properties();
        props.put("mail.store.protocol", protocol);
        props.put("mail." + protocol + ".connectiontimeout", "15000");
        props.put("mail." + protocol + ".timeout", "30000");
        if ("starttls".equals(sec)) {
            props.put("mail.imap.starttls.enable", "true");
            props.put("mail.imap.starttls.required", "true");
        }
        Store store = Session.getInstance(props).getStore(protocol);
        store.connect(s.getImapHost().trim(), s.getImapPort(), s.getUsername().trim(), password);
        try {
            Folder folder = store.getFolder(s.getImapFolder() == null || s.getImapFolder().isBlank() ? "INBOX" : s.getImapFolder().trim());
            folder.open(Folder.READ_ONLY);
            try {
                Date since = Date.from(LocalDate.now().minusDays(DAYS).atStartOfDay(ZoneId.systemDefault()).toInstant());
                for (Message m : folder.search(new ReceivedDateTerm(ComparisonTerm.GE, since))) visitor.visit(m);
            } finally {
                folder.close(false);
            }
        } finally {
            store.close();
        }
    }

    /** A raw email (RFC 822) — for testing the matching (app.mail.inbox.test-ingest=true). */
    public Optional<EnrollmentWorkflowLog> ingestRaw(String raw) throws Exception {
        MimeMessage m = new MimeMessage(Session.getInstance(new Properties()), new ByteArrayInputStream(raw.getBytes(StandardCharsets.UTF_8)));
        return ingest(m, null);
    }

    /**
     * Logs the message on the enrollment it answers; empty when it answers none of our emails or is already logged.
     * orgId: the organization whose mailbox it came from (only its emails are matched); null = any (test ingest).
     */
    @Transactional
    public Optional<EnrollmentWorkflowLog> ingest(MimeMessage m, Long orgId) throws Exception {
        String messageId = m.getMessageID();
        if (messageId != null && logRepository.existsByMessageId(messageId)) return Optional.empty();
        String from = firstAddress(m.getFrom());
        if (from == null) return Optional.empty();
        String subject = m.getSubject() == null ? "" : m.getSubject().trim();
        EnrollmentWorkflowLog ours = match(m, from, subject, orgId).orElse(null);
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
    private Optional<EnrollmentWorkflowLog> match(MimeMessage m, String from, String subject, Long orgId) throws Exception {
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
                    .filter(l -> "email".equals(l.getLogType()) && !"received".equals(l.getEmailStatus()))
                    .filter(l -> orgId == null || orgId.equals(l.getOrgId())).findFirst();
            if (byRef.isPresent()) return byRef;
        }
        String base = REPLY_PREFIX.matcher(subject).replaceFirst("").trim();
        if (base.isEmpty()) return Optional.empty();
        Optional<EnrollmentWorkflowLog> sent = orgId == null
                ? logRepository.findFirstByLogTypeAndEmailToIgnoreCaseAndEmailSubjectIgnoreCaseOrderByIdDesc("email", from, base)
                : logRepository.findFirstByOrgIdAndLogTypeAndEmailToIgnoreCaseAndEmailSubjectIgnoreCaseOrderByIdDesc(orgId, "email", from, base);
        return sent.filter(l -> !"received".equals(l.getEmailStatus()));
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
