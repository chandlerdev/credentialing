package com.zmartcredential.service;

import com.zmartcredential.entity.AppUser;
import com.zmartcredential.entity.Enrollment;
import com.zmartcredential.entity.EnrollmentWorkflowLog;
import com.zmartcredential.entity.Organization;
import com.zmartcredential.repository.AppUserRepository;
import com.zmartcredential.repository.EnrollmentRepository;
import com.zmartcredential.repository.EnrollmentWorkflowLogRepository;
import com.zmartcredential.repository.OrganizationRepository;
import com.zmartcredential.repository.PayerRepository;
import com.zmartcredential.repository.ProviderRepository;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Next Follow Up reminders: when an enrollment's Next Follow Up Date comes (or has passed) and it isn't approved or
 * terminated, the admin responsible for it gets an in-app notification and an email — the enrollment's assigned user,
 * else the one who last called / emailed the payer about it, else the organization's admins. Each follow-up date is
 * notified once (a new date is notified again when it comes). Runs shortly after start-up and every hour.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FollowUpDueJob {

    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);
    private static final Set<String> CLOSED = Set.of("approved", "terminated");

    private final EnrollmentRepository enrollmentRepository;
    private final EnrollmentWorkflowLogRepository logRepository;
    private final AppUserRepository userRepository;
    private final ProviderRepository providerRepository;
    private final PayerRepository payerRepository;
    private final OrganizationRepository organizationRepository;
    private final NotificationService notificationService;
    private final MailService mailService;
    private final MailTemplateService mailTemplateService;

    @Scheduled(initialDelayString = "PT2M", fixedDelayString = "PT1H")
    public void run() {
        try {
            int n = sendDue(LocalDate.now());
            if (n > 0) log.info("{} follow-up reminder(s) sent", n);
        } catch (Exception e) {
            log.warn("Follow-up reminders failed: {}", e.getMessage());
        }
    }

    /** Sends the reminders due on {@code today}; returns how many enrollments were notified. */
    @Transactional
    public int sendDue(LocalDate today) {
        int sent = 0;
        for (Enrollment e : enrollmentRepository.findByNextFollowUpDateLessThanEqual(today)) {
            if (CLOSED.contains(e.getStatus()) || Boolean.TRUE.equals(e.getTestData())) continue;
            if (e.getNextFollowUpDate().equals(e.getFollowUpNotifiedOn())) continue;
            try {
                notify(e, today);
            } catch (Exception ex) {
                log.warn("Follow-up reminder for enrollment {} failed: {}", e.getId(), ex.getMessage());
                continue;
            }
            e.setFollowUpNotifiedOn(e.getNextFollowUpDate());
            enrollmentRepository.save(e);
            sent++;
        }
        return sent;
    }

    private void notify(Enrollment e, LocalDate today) {
        String provider = providerRepository.findById(e.getProviderId())
                .map(p -> (nz(p.getFirstName()) + " " + nz(p.getLastName())).trim() + (p.getSuffix() == null || p.getSuffix().isBlank() ? "" : ", " + p.getSuffix()))
                .orElse("the provider");
        String payer = payerRepository.findById(e.getPayerId()).map(p -> p.getName()).orElse("the payer");
        String org = organizationRepository.findById(e.getOrgId()).map(Organization::getName).orElse("");
        long overdue = ChronoUnit.DAYS.between(e.getNextFollowUpDate(), today);
        String when = e.getNextFollowUpDate().format(DATE) + (overdue == 0 ? " (today)" : " (" + overdue + (overdue == 1 ? " day" : " days") + " overdue)");
        String title = "Follow up with " + payer + " for " + provider;
        String last = e.getFollowUpDate() == null ? "" : " Last follow-up: " + e.getFollowUpDate().format(DATE) + ".";
        String link = mailService.publicUrl() + "/admin/enrollments";

        for (AppUser u : recipients(e)) {
            notificationService.notifyUser(e.getOrgId(), u.getId(), title, "Next follow-up due " + when + "." + last, "CalendarClock", NotificationService.WARN);
            if (u.getEmail() != null && !u.getEmail().isBlank()) {
                String subject = "Follow-up due: " + provider + " → " + payer;
                String body = "Hi " + (u.getFirstName() == null || u.getFirstName().isBlank() ? "there" : u.getFirstName()) + ",\n\n"
                        + "The next follow-up with " + payer + " for " + provider + " is due " + when + "." + last + "\n\n"
                        + "Call or email the payer from Payer Submission and log it. Enrollments: " + link + "\n\n" + org;
                mailTemplateService.log(e.getOrgId(), e.getProviderId(), u.getEmail(), subject, mailService.send(u.getEmail(), subject, body).status());
            }
        }
    }

    /** The assigned user, else the one who last called / emailed the payer about it, else the organization's admins. */
    List<AppUser> recipients(Enrollment e) {
        AppUser assigned = active(e.getOrgId(), e.getAssignedUserId());
        if (assigned != null) return List.of(assigned);
        Long lastBy = logRepository.findByEnrollmentIdOrderByIdDesc(e.getId()).stream()
                .filter(l -> ("call".equals(l.getLogType()) || "email".equals(l.getLogType())) && !"received".equals(l.getEmailStatus()))
                .map(EnrollmentWorkflowLog::getCreatedBy).filter(Objects::nonNull).findFirst().orElse(null);
        AppUser worker = active(e.getOrgId(), lastBy);
        if (worker != null) return List.of(worker);
        return userRepository.findByOrgId(e.getOrgId()).stream()
                .filter(u -> "org_admin".equals(u.getRole()) || "admin".equals(u.getRole()))
                .filter(u -> !Boolean.TRUE.equals(u.getDisabled()))
                .toList();
    }

    private AppUser active(Long orgId, Long userId) {
        if (userId == null) return null;
        return userRepository.findByIdAndOrgId(userId, orgId).filter(u -> !Boolean.TRUE.equals(u.getDisabled())).orElse(null);
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
