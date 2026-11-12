package com.zmartcredential.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * Background runs of the reminders the users set up: due email reminder schedules (checked every 15 minutes) and the
 * CAQH attestation reminder rules (daily at 08:00). Runs only while email sending is switched on, so a server without
 * SMTP does not fill the email log with undelivered messages.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ReminderJob {

    private final OpsEmailReminderService emailReminders;
    private final OpsCaqhService caqh;
    private final MailService mailService;

    @Scheduled(initialDelayString = "PT2M", fixedDelayString = "PT15M")
    public void runDueSchedules() {
        // each schedule is sent from its organization's own mail account (a failure is recorded in the email log)
        for (Long id : emailReminders.dueScheduleIds(LocalDateTime.now())) {
            try {
                var r = emailReminders.runScheduled(id);
                log.info("Reminder schedule {} ran: {} sent, {} failed, {} skipped", id, r.sent(), r.failed(), r.skipped());
            } catch (Exception e) {
                log.warn("Reminder schedule {} could not run: {}", id, e.getMessage());
            }
        }
    }

    @Scheduled(cron = "0 0 8 * * *")
    public void runAttestationRules() {
        for (Long orgId : caqh.orgsWithEnabledRules()) {
            if (!mailService.enabled(orgId)) continue;
            try {
                var r = caqh.runRulesScheduled(orgId);
                log.info("CAQH attestation rules for org {}: {} reminder(s), {} sent, {} failed", orgId, r.remindersQueued(), r.remindersSent(), r.remindersFailed());
            } catch (Exception e) {
                log.warn("CAQH attestation rules for org {} could not run: {}", orgId, e.getMessage());
            }
        }
    }
}
