package com.zmartcredential.service;

import com.zmartcredential.entity.AppUser;
import com.zmartcredential.entity.DocumentExpiryNotice;
import com.zmartcredential.entity.DocumentType;
import com.zmartcredential.entity.Organization;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.entity.ProviderDocument;
import com.zmartcredential.repository.AppUserRepository;
import com.zmartcredential.repository.DocumentExpiryNoticeRepository;
import com.zmartcredential.repository.DocumentTypeRepository;
import com.zmartcredential.repository.OrganizationRepository;
import com.zmartcredential.repository.ProviderDocumentRepository;
import com.zmartcredential.repository.ProviderRepository;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 30 calendar days before a provider document expires, the provider and the admins of the provider's organization
 * get an in-app notification and an email. The date is counted with real calendar days (months of 28, 29, 30 or 31
 * days): a document expiring on 21 Nov 2026 is notified on 22 Oct 2026. The check runs shortly after start-up and
 * every 6 hours; a document whose 30-day mark was missed (e.g. uploaded with less than 30 days left, or the server
 * was down) is notified at the next run. Each document and expiration date is notified once.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DocumentExpiryNoticeJob {

    public static final int DAYS_BEFORE = 30;
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("MMM d, yyyy");

    private final ProviderDocumentRepository documentRepository;
    private final DocumentExpiryNoticeRepository noticeRepository;
    private final DocumentTypeRepository documentTypeRepository;
    private final ProviderRepository providerRepository;
    private final OrganizationRepository organizationRepository;
    private final AppUserRepository userRepository;
    private final NotificationService notificationService;
    private final MailService mailService;
    private final MailTemplateService mailTemplateService;

    @Scheduled(initialDelayString = "PT2M", fixedDelayString = "PT6H")
    public void run() {
        try {
            int n = sendDue(LocalDate.now());
            if (n > 0) log.info("{} document expiry notice(s) sent", n);
        } catch (Exception e) {
            log.warn("Document expiry notices failed: {}", e.getMessage());
        }
    }

    /** Sends the notices due on {@code today}; returns how many documents were notified. */
    @Transactional
    public int sendDue(LocalDate today) {
        Map<String, String> labels = documentTypeRepository.findAll().stream()
                .collect(Collectors.toMap(DocumentType::getCode, DocumentType::getLabel, (a, b) -> a));
        int sent = 0;
        // due = the expiration date is within the next 30 calendar days (today included), not expired yet
        for (ProviderDocument d : documentRepository.findByExpiresAtBetweenAndStorageKeyIsNotNull(today, today.plusDays(DAYS_BEFORE))) {
            if (!"approved".equals(d.getStatus()) && !"pending_review".equals(d.getStatus())) continue;
            if (noticeRepository.existsByDocumentIdAndExpiresAt(d.getId(), d.getExpiresAt())) continue;
            Provider p = providerRepository.findById(d.getProviderId()).orElse(null);
            if (p == null) continue;
            notify(d, p, labels.getOrDefault(d.getDocType(), d.getDocType()), today);
            DocumentExpiryNotice n = new DocumentExpiryNotice();
            n.setDocumentId(d.getId());
            n.setExpiresAt(d.getExpiresAt());
            noticeRepository.save(n);
            sent++;
        }
        return sent;
    }

    private void notify(ProviderDocument d, Provider p, String label, LocalDate today) {
        long days = ChronoUnit.DAYS.between(today, d.getExpiresAt());
        String when = d.getExpiresAt().format(DATE) + (days == 0 ? " (today)" : days == 1 ? " (tomorrow)" : " (in " + days + " days)");
        String providerName = (nz(p.getFirstName()) + " " + nz(p.getLastName())).trim();
        String org = organizationRepository.findById(p.getOrgId()).map(Organization::getName).orElse("");
        String signIn = mailService.publicUrl() + "/admin/signin";

        // the provider: in the app (when they have a sign-in) and by email
        userRepository.findByProviderId(p.getId()).filter(u -> !Boolean.TRUE.equals(u.getDisabled())).ifPresent(u ->
                notificationService.notifyUser(p.getOrgId(), u.getId(), label + " expires " + when,
                        "Please upload your renewed " + label + " before it expires.", "CalendarClock", NotificationService.WARN));
        if (p.getEmail() != null && !p.getEmail().isBlank()) {
            String subject = "Your " + label + " expires on " + d.getExpiresAt().format(DATE);
            String body = "Hi " + (p.getFirstName() == null ? "there" : p.getFirstName()) + ",\n\n"
                    + "Your " + label + " on file with " + org + " expires on " + when + ".\n\n"
                    + "Please upload the renewed document so your credentialing stays current. Sign in: " + signIn + "\n\n"
                    + "Thank you,\n" + org;
            mailTemplateService.log(p.getOrgId(), p.getId(), p.getEmail(), subject, mailService.send(p.getOrgId(), p.getEmail(), subject, body).status());
        }

        // the organization's admins: in the app and by email
        List<AppUser> admins = userRepository.findByOrgId(p.getOrgId()).stream()
                .filter(u -> "org_admin".equals(u.getRole()) || "admin".equals(u.getRole()))
                .filter(u -> !Boolean.TRUE.equals(u.getDisabled()))
                .toList();
        String title = label + " of " + providerName + " expires " + when;
        for (AppUser a : admins) {
            notificationService.notifyUser(p.getOrgId(), a.getId(), title,
                    "Ask " + providerName + " for the renewed " + label + ".", "CalendarClock", NotificationService.WARN);
            if (a.getEmail() != null && !a.getEmail().isBlank()) {
                String subject = "Expiring document: " + label + " of " + providerName;
                String body = "Hi " + (a.getFirstName() == null ? "there" : a.getFirstName()) + ",\n\n"
                        + "The " + label + " of " + providerName + (p.getNpi() == null ? "" : " (NPI " + p.getNpi() + ")")
                        + " expires on " + when + ".\n\n"
                        + "Please follow up with the provider for the renewed document. Sign in: " + signIn + "\n\n" + org;
                mailTemplateService.log(p.getOrgId(), p.getId(), a.getEmail(), subject, mailService.send(p.getOrgId(), a.getEmail(), subject, body).status());
            }
        }
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
