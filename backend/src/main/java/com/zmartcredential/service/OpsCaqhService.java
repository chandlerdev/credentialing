package com.zmartcredential.service;

import com.zmartcredential.dto.caqh.OpsCaqhDtos.AttestationItem;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.AttestationStats;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.AttestationsResponse;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.CaqhConfigResponse;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.CaqhConfigUpdateRequest;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.CaqhProviderStatus;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.CaqhProviderUpdateRequest;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.CaqhStatusResponse;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.CaqhStatusStats;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.CaqhTestResponse;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.ReminderLogItem;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.RuleItem;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.RuleMatch;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.RuleRequest;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.RuleRunResponse;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.SendReminderRequest;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.SyncDeferredResponse;
import com.zmartcredential.dto.caqh.OpsCaqhDtos.SyncRunItem;
import com.zmartcredential.entity.AttestationReminderLog;
import com.zmartcredential.entity.AttestationReminderRule;
import com.zmartcredential.entity.CaqhConfig;
import com.zmartcredential.entity.CaqhSyncRun;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.ConflictException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.entity.AppUser;
import com.zmartcredential.repository.AppUserRepository;
import com.zmartcredential.repository.AttestationReminderLogRepository;
import com.zmartcredential.repository.OrganizationRepository;
import com.zmartcredential.repository.AttestationReminderRuleRepository;
import com.zmartcredential.repository.CaqhConfigRepository;
import com.zmartcredential.repository.CaqhSyncRunRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.Role;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/** CAQH: connection/auto-sync config, attestation status, sync-run history, attestation reminder rules + log. */
@Service
@RequiredArgsConstructor
public class OpsCaqhService {

    public static final int ATTESTATION_CYCLE_DAYS = 120;
    public static final int ATTEST_SOON_DAYS = 20;
    private static final String DELIVERY_DEFERRED = "deferred";
    private static final java.time.format.DateTimeFormatter LONG_DATE = java.time.format.DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US);
    private static final String SYNC_DEFERRED = "Live CAQH / aggregator synchronization will be available in a later phase. "
            + "Until then, update CAQH data via CSV import or manual entry.";

    private final CaqhConfigRepository configRepository;
    private final CaqhSyncRunRepository syncRunRepository;
    private final AttestationReminderRuleRepository ruleRepository;
    private final AttestationReminderLogRepository logRepository;
    private final ProviderRepository providerRepository;
    private final CryptoService cryptoService;
    private final NotificationService notificationService;
    private final MailService mailService;
    private final AppUserRepository userRepository;
    private final OrganizationRepository organizationRepository;
    private final OpsLookupService lookup;
    private final AuthContext authContext;

    // ---------------------------------------------------------------- config

    @Transactional
    public CaqhConfigResponse getConfig() {
        authContext.requireStaff();
        return toConfig(ensureConfig(authContext.orgId()));
    }

    @Transactional
    public CaqhConfigResponse updateConfig(CaqhConfigUpdateRequest r) {
        authContext.requireStaff();
        authContext.requireRole(Role.PLATFORM_ADMIN, Role.ORG_ADMIN);
        CaqhConfig c = ensureConfig(authContext.orgId());
        if (r.path() != null) c.setPath(r.path());
        if (r.directUsername() != null) c.setDirectUsername(blankToNull(r.directUsername()));
        if (r.directPassword() != null) {
            c.setDirectPasswordEnc(r.directPassword().isEmpty() ? null : cryptoService.encrypt(r.directPassword()));
        }
        if (r.directOrgId() != null) c.setDirectOrgId(blankToNull(r.directOrgId()));
        if (r.directEnvironment() != null) c.setDirectEnvironment(r.directEnvironment());
        if (r.aggregatorVendor() != null) c.setAggregatorVendor(r.aggregatorVendor());
        if (r.aggregatorApiKey() != null) {
            c.setAggregatorApiKeyEnc(r.aggregatorApiKey().isEmpty() ? null : cryptoService.encrypt(r.aggregatorApiKey()));
        }
        if (r.aggregatorBaseUrl() != null) c.setAggregatorBaseUrl(blankToNull(r.aggregatorBaseUrl()));
        if (r.syncEnabled() != null) c.setSyncEnabled(r.syncEnabled());
        if (r.syncCadence() != null) c.setSyncCadence(r.syncCadence());
        if (r.syncDayOfWeek() != null) c.setSyncDayOfWeek(r.syncDayOfWeek());
        if (r.syncHour() != null) c.setSyncHour(r.syncHour());
        if (r.syncOnlyAttested() != null) c.setSyncOnlyAttested(r.syncOnlyAttested());
        if (r.syncNotifyChanges() != null) c.setSyncNotifyChanges(r.syncNotifyChanges());
        if (r.syncRateLimit() != null) c.setSyncRateLimit(r.syncRateLimit());
        configRepository.saveAndFlush(c);
        return toConfig(c);
    }

    @Transactional
    public CaqhTestResponse testConnection() {
        lookup.requireWriter();
        CaqhConfig c = ensureConfig(authContext.orgId());
        boolean configured = switch (c.getPath()) {
            case "direct" -> c.getDirectUsername() != null && c.getDirectPasswordEnc() != null && c.getDirectOrgId() != null;
            case "aggregator" -> c.getAggregatorApiKeyEnc() != null && c.getAggregatorBaseUrl() != null;
            default -> false;
        };
        String msg = "csv".equals(c.getPath())
                ? "The CSV path does not use a live connection. Import CAQH exports from the CSV Import tab."
                : "Credentials are " + (configured ? "saved" : "incomplete")
                + ". Live connection testing against CAQH / aggregator APIs will be available in a later phase.";
        return new CaqhTestResponse(DELIVERY_DEFERRED, configured, c.getPath(), msg);
    }

    /** Next scheduled auto-sync run, or null when disabled. Fixes the prototype's Sunday/same-day bugs. */
    public static LocalDateTime computeNextRun(CaqhConfig c, LocalDateTime now) {
        if (!Boolean.TRUE.equals(c.getSyncEnabled())) return null;
        int hour = c.getSyncHour() == null ? 2 : c.getSyncHour();
        String cadence = c.getSyncCadence() == null ? "weekly" : c.getSyncCadence();
        switch (cadence) {
            case "hourly":
                return now.truncatedTo(ChronoUnit.HOURS).plusHours(1);
            case "daily": {
                LocalDateTime t = now.toLocalDate().atTime(hour, 0);
                return t.isAfter(now) ? t : t.plusDays(1);
            }
            case "monthly": {
                LocalDateTime t = now.toLocalDate().withDayOfMonth(1).atTime(hour, 0);
                return t.isAfter(now) ? t : t.plusMonths(1);
            }
            default: {
                DayOfWeek target = parseDay(c.getSyncDayOfWeek());
                LocalDateTime t = now.toLocalDate().with(TemporalAdjusters.nextOrSame(target)).atTime(hour, 0);
                return t.isAfter(now) ? t : t.plusWeeks(1);
            }
        }
    }

    // ---------------------------------------------------------------- status

    @Transactional(readOnly = true)
    public CaqhStatusResponse status() {
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        LocalDate today = LocalDate.now();
        List<CaqhProviderStatus> items = providerRepository.findByOrgIdOrderByLastNameAsc(orgId).stream()
                .map(p -> toStatus(p, today)).toList();
        CaqhStatusStats stats = new CaqhStatusStats(
                items.stream().filter(i -> !"not_enrolled".equals(i.status())).count(),
                items.stream().filter(i -> "not_enrolled".equals(i.status())).count(),
                items.stream().filter(i -> "due_soon".equals(i.status())).count(),
                items.stream().filter(i -> "overdue".equals(i.status())).count(),
                items.stream().filter(i -> "unknown".equals(i.status())).count());
        return new CaqhStatusResponse(stats, items);
    }

    @Transactional
    public CaqhProviderStatus updateProvider(Long providerId, CaqhProviderUpdateRequest r) {
        lookup.requireWriter();
        Long orgId = authContext.orgId();
        Provider p = lookup.requireProvider(orgId, providerId);
        if (r.lastAttested() != null && r.lastAttested().isAfter(LocalDate.now())) {
            throw new BadRequestException("Last attestation date cannot be in the future");
        }
        if (r.caqhId() != null) p.setCaqhId(blankToNull(r.caqhId()));
        if (r.lastAttested() != null) {
            p.setCaqhLastAttested(r.lastAttested());
            if (r.attestationStatus() == null) p.setCaqhAttestationStatus("attested");
        }
        if (r.attestationStatus() != null) p.setCaqhAttestationStatus(blankToNull(r.attestationStatus()));
        providerRepository.save(p);
        return toStatus(p, LocalDate.now());
    }

    // ---------------------------------------------------------------- sync runs

    @Transactional(readOnly = true)
    public List<SyncRunItem> syncRuns(int limit) {
        authContext.requireStaff();
        return syncRunRepository.findByOrgIdOrderByStartedAtDesc(authContext.orgId()).stream()
                .limit(Math.max(1, Math.min(limit, 100)))
                .map(OpsCaqhService::toRun).toList();
    }

    public SyncDeferredResponse requestSync(Long providerId) {
        lookup.requireWriter();
        if (providerId != null) lookup.requireProvider(authContext.orgId(), providerId);
        return new SyncDeferredResponse(DELIVERY_DEFERRED, SYNC_DEFERRED, providerId);
    }

    // ---------------------------------------------------------------- attestations

    @Transactional(readOnly = true)
    public AttestationsResponse attestations(int maxDays) {
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        LocalDate today = LocalDate.now();
        List<Provider> enrolled = providerRepository.findByOrgId(orgId).stream()
                .filter(p -> p.getCaqhId() != null && !p.getCaqhId().isBlank()).toList();
        List<AttestationItem> all = enrolled.stream().filter(p -> p.getCaqhLastAttested() != null)
                .map(p -> toAttestation(p, today))
                .sorted(Comparator.comparingLong(AttestationItem::daysUntilDue))
                .toList();
        AttestationStats stats = new AttestationStats(
                all.stream().filter(a -> "expired".equals(a.status())).count(),
                all.stream().filter(a -> "urgent".equals(a.status()) || "critical".equals(a.status())).count(),
                all.stream().filter(a -> "warning".equals(a.status())).count(),
                all.stream().filter(a -> "info".equals(a.status())).count(),
                enrolled.stream().filter(p -> p.getCaqhLastAttested() == null).count());
        List<AttestationItem> items = all.stream().filter(a -> a.daysUntilDue() <= maxDays).toList();
        return new AttestationsResponse(stats, items);
    }

    // ---------------------------------------------------------------- rules

    @Transactional(readOnly = true)
    public List<RuleItem> rules() {
        authContext.requireStaff();
        return ruleRepository.findByOrgIdOrderByDaysBeforeDesc(authContext.orgId()).stream().map(OpsCaqhService::toRule).toList();
    }

    @Transactional
    public RuleItem createRule(RuleRequest r) {
        lookup.requireWriter();
        AttestationReminderRule rule = new AttestationReminderRule();
        rule.setOrgId(authContext.orgId());
        rule.setSentCount(0);
        applyRule(rule, r);
        return toRule(ruleRepository.save(rule));
    }

    @Transactional
    public RuleItem updateRule(Long id, RuleRequest r) {
        lookup.requireWriter();
        AttestationReminderRule rule = loadRule(id);
        applyRule(rule, r);
        return toRule(ruleRepository.save(rule));
    }

    @Transactional
    public RuleItem setRuleEnabled(Long id, boolean enabled) {
        lookup.requireWriter();
        AttestationReminderRule rule = loadRule(id);
        rule.setEnabled(enabled);
        return toRule(ruleRepository.save(rule));
    }

    @Transactional
    public void deleteRule(Long id) {
        authContext.requireStaff();
        authContext.requireRole(Role.PLATFORM_ADMIN, Role.ORG_ADMIN);
        ruleRepository.delete(loadRule(id));
    }

    /**
     * Evaluates enabled rules: a rule matches a provider when daysUntilDue == daysBefore, or for negative
     * daysBefore when daysUntilDue &lt;= daysBefore (overdue escalation). A (rule, provider, dueDate) pair is
     * sent only once. The email part of the channel is delivered through SMTP (and "manager" also emails the
     * organization admins); SMS and phone calls are not connected, so those channels are logged only.
     */
    @Transactional
    public RuleRunResponse runRules(boolean dryRun) {
        if (dryRun) authContext.requireStaff();
        else lookup.requireWriter();
        return runRulesFor(authContext.orgId(), dryRun, "manual");
    }

    /** Organizations that have at least one enabled reminder rule, for the daily background run. */
    @Transactional(readOnly = true)
    public List<Long> orgsWithEnabledRules() {
        return ruleRepository.findAll().stream().filter(r -> Boolean.TRUE.equals(r.getEnabled()))
                .map(AttestationReminderRule::getOrgId).distinct().toList();
    }

    /** Daily background run of one organization's rules (no signed-in user). */
    @Transactional
    public RuleRunResponse runRulesScheduled(Long orgId) {
        return runRulesFor(orgId, false, "auto");
    }

    private RuleRunResponse runRulesFor(Long orgId, boolean dryRun, String triggeredBy) {
        LocalDate today = LocalDate.now();
        List<AttestationReminderRule> rules = ruleRepository.findByOrgIdOrderByDaysBeforeDesc(orgId).stream()
                .filter(r -> Boolean.TRUE.equals(r.getEnabled())).toList();
        List<Provider> providers = providerRepository.findByOrgId(orgId).stream()
                .filter(p -> p.getCaqhId() != null && !p.getCaqhId().isBlank() && p.getCaqhLastAttested() != null)
                .toList();
        List<RuleMatch> matches = new ArrayList<>();
        int queued = 0;
        int sent = 0;
        int failed = 0;
        Set<Long> notifiedProviders = new HashSet<>();
        LocalDateTime now = LocalDateTime.now();
        for (AttestationReminderRule rule : rules) {
            int ruleQueued = 0;
            for (Provider p : providers) {
                LocalDate due = p.getCaqhLastAttested().plusDays(ATTESTATION_CYCLE_DAYS);
                long daysLeft = ChronoUnit.DAYS.between(today, due);
                int db = rule.getDaysBefore();
                boolean match = db >= 0 ? daysLeft == db : daysLeft <= db;
                if (!match) continue;
                boolean already = logRepository.existsByRuleIdAndProviderIdAndDueDate(rule.getId(), p.getId(), due);
                matches.add(new RuleMatch(rule.getId(), rule.getName(), p.getId(), OpsLookupService.plainName(p), daysLeft,
                        due, rule.getChannel(), rule.getTemplate(), already));
                if (!dryRun && !already) {
                    AttestationReminderLog row = logRow(orgId, rule.getId(), p.getId(), rule.getChannel(), rule.getTemplate(), due, triggeredBy);
                    row.setStatus(deliver(orgId, p, rule.getChannel(), rule.getTemplate(), due));
                    logRepository.save(row);
                    if ("sent".equals(row.getStatus())) sent++;
                    if ("failed".equals(row.getStatus())) failed++;
                    ruleQueued++;
                    notifiedProviders.add(p.getId());
                }
            }
            if (ruleQueued > 0) {
                rule.setSentCount((rule.getSentCount() == null ? 0 : rule.getSentCount()) + ruleQueued);
                rule.setLastTriggeredAt(now);
                ruleRepository.save(rule);
                queued += ruleQueued;
            }
        }
        if (queued > 0) {
            String detail = !mailService.enabled(orgId)
                    ? queued + " reminder(s) recorded for " + notifiedProviders.size() + " provider(s) (email sending is switched off)."
                    : sent + " reminder email(s) sent to " + notifiedProviders.size() + " provider(s)" + (failed > 0 ? ", " + failed + " failed." : ".");
            notificationService.notifyOrg(orgId, "Attestation reminders", detail, "Bell",
                    failed > 0 ? NotificationService.WARN : NotificationService.INFO);
        }
        return new RuleRunResponse(dryRun, rules.size(), queued, matches, mailService.enabled(orgId) ? "smtp" : "deferred", sent, failed);
    }

    @Transactional
    public ReminderLogItem sendReminder(SendReminderRequest r) {
        lookup.requireWriter();
        Long orgId = authContext.orgId();
        Provider p = lookup.requireProvider(orgId, r.providerId());
        LocalDate due = p.getCaqhLastAttested() == null ? null : p.getCaqhLastAttested().plusDays(ATTESTATION_CYCLE_DAYS);
        AttestationReminderLog row = logRow(orgId, null, p.getId(), r.channel(), r.template(), due, "manual");
        row.setStatus(deliver(orgId, p, r.channel(), r.template(), due));
        row = logRepository.save(row);
        return toLog(row, Map.of(p.getId(), p), Map.of());
    }

    @Transactional(readOnly = true)
    public List<ReminderLogItem> reminderLog() {
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        Map<Long, Provider> providers = lookup.providersById(orgId);
        Map<Long, AttestationReminderRule> rules = ruleRepository.findByOrgId(orgId).stream()
                .collect(Collectors.toMap(AttestationReminderRule::getId, Function.identity()));
        return logRepository.findTop50ByOrgIdOrderBySentAtDesc(orgId).stream()
                .map(l -> toLog(l, providers, rules)).toList();
    }

    // ---------------------------------------------------------------- delivery

    /**
     * Emails an attestation reminder for a channel that includes email: to the provider, and for "manager" also to
     * the organization admins. Returns the log status: sent / failed / queued (email off, or a channel without email).
     */
    private String deliver(Long orgId, Provider p, String channel, String template, LocalDate due) {
        if (channel == null || !channel.contains("email")) return "queued";
        if (p.getEmail() == null || p.getEmail().isBlank()) return "failed";
        String org = organizationRepository.findById(orgId).map(o -> o.getName()).orElse("your credentialing team");
        String[] msg = reminderText(template, p, due, org);
        MailService.Result r = mailService.send(orgId, p.getEmail(), msg[0], msg[1]);
        if (channel.contains("manager")) {
            String note = "Copy for managers: " + OpsLookupService.plainName(p) + "'s CAQH attestation"
                    + (due == null ? "" : " was due " + due.format(LONG_DATE)) + ".\n\n" + msg[1];
            for (AppUser u : userRepository.findByOrgId(orgId)) {
                if ("org_admin".equals(u.getRole()) && !Boolean.TRUE.equals(u.getDisabled()) && u.getEmail() != null && !u.getEmail().isBlank()) {
                    mailService.send(orgId, u.getEmail(), "[Escalation] " + msg[0], note);
                }
            }
        }
        return r.status();
    }

    /** Subject and body for each reminder tone (prototype templates: friendly, standard, urgent, final, escalation). */
    private static String[] reminderText(String template, Provider p, LocalDate due, String org) {
        String dueText = due == null ? "soon" : "on " + due.format(LONG_DATE);
        String hi = "Hi " + (p.getFirstName() == null ? "" : p.getFirstName()) + ",\n\n";
        String how = "\n\nPlease sign in to CAQH ProView (https://proview.caqh.org), review your profile and click \"Attest\". "
                + "It only takes a few minutes and keeps your payer enrollments active.\n\nThank you,\n" + org;
        String t = template == null ? "standard" : template;
        return switch (t) {
            case "friendly" -> new String[]{"Friendly reminder: your CAQH attestation is due " + dueText,
                    hi + "Just a heads-up — your CAQH ProView attestation is due " + dueText + "." + how};
            case "urgent" -> new String[]{"Urgent: your CAQH attestation is due " + dueText,
                    hi + "Your CAQH ProView attestation is due " + dueText + ". Payers may pause your enrollments if it lapses." + how};
            case "final" -> new String[]{"Final notice: your CAQH attestation is due " + dueText,
                    hi + "This is the final reminder — your CAQH ProView attestation is due " + dueText
                            + ". After that, payers can no longer see a current profile for you." + how};
            case "escalation" -> new String[]{"Action required: your CAQH attestation has lapsed",
                    hi + "Your CAQH ProView attestation was due " + dueText + " and has not been completed. "
                            + "Payers may suspend or delay your enrollments until you re-attest." + how};
            default -> new String[]{"Reminder: your CAQH attestation is due " + dueText,
                    hi + "Your CAQH ProView attestation is due " + dueText + "." + how};
        };
    }

    // ---------------------------------------------------------------- helpers

    private CaqhConfig ensureConfig(Long orgId) {
        return configRepository.findById(orgId).orElseGet(() -> {
            CaqhConfig c = new CaqhConfig();
            c.setOrgId(orgId);
            return configRepository.saveAndFlush(c);
        });
    }

    private static CaqhConfigResponse toConfig(CaqhConfig c) {
        return new CaqhConfigResponse(c.getPath(), c.getDirectUsername(), c.getDirectOrgId(), c.getDirectEnvironment(),
                c.getDirectPasswordEnc() != null, c.getAggregatorVendor(), c.getAggregatorBaseUrl(),
                c.getAggregatorApiKeyEnc() != null, Boolean.TRUE.equals(c.getSyncEnabled()), c.getSyncCadence(),
                c.getSyncDayOfWeek(), c.getSyncHour() == null ? 2 : c.getSyncHour(),
                Boolean.TRUE.equals(c.getSyncOnlyAttested()), Boolean.TRUE.equals(c.getSyncNotifyChanges()),
                c.getSyncRateLimit() == null ? 60 : c.getSyncRateLimit(), computeNextRun(c, LocalDateTime.now()),
                c.getUpdatedAt());
    }

    private static DayOfWeek parseDay(String s) {
        if (s == null) return DayOfWeek.SUNDAY;
        try {
            return DayOfWeek.valueOf(s.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return DayOfWeek.SUNDAY;
        }
    }

    private static CaqhProviderStatus toStatus(Provider p, LocalDate today) {
        boolean enrolled = p.getCaqhId() != null && !p.getCaqhId().isBlank();
        LocalDate last = p.getCaqhLastAttested();
        LocalDate next = last == null ? null : last.plusDays(ATTESTATION_CYCLE_DAYS);
        Long daysLeft = next == null ? null : ChronoUnit.DAYS.between(today, next);
        String status;
        if (!enrolled) status = "not_enrolled";
        else if (daysLeft == null) status = "unknown";
        else if (daysLeft < 0) status = "overdue";
        else if (daysLeft <= ATTEST_SOON_DAYS) status = "due_soon";
        else status = "ok";
        return new CaqhProviderStatus(p.getId(), OpsLookupService.plainName(p), p.getNpi(), p.getCaqhId(), last, next,
                daysLeft, p.getCaqhLastSynced(), p.getCaqhAttestationStatus(), status);
    }

    private static AttestationItem toAttestation(Provider p, LocalDate today) {
        LocalDate due = p.getCaqhLastAttested().plusDays(ATTESTATION_CYCLE_DAYS);
        long d = ChronoUnit.DAYS.between(today, due);
        String status = d < 0 ? "expired" : d <= 1 ? "urgent" : d <= 7 ? "critical" : d <= 14 ? "warning" : d <= 30 ? "info" : "ok";
        return new AttestationItem(p.getId(), OpsLookupService.plainName(p), p.getEmail(), p.getCaqhId(),
                p.getCaqhLastAttested(), due, d, status);
    }

    private static SyncRunItem toRun(CaqhSyncRun r) {
        List<String> changes = r.getChanges() == null || r.getChanges().isBlank() ? List.of()
                : Arrays.stream(r.getChanges().replace("\\n", "\n").split("\n")).map(String::trim).filter(s -> !s.isEmpty()).toList();
        return new SyncRunItem(r.getId(), r.getTriggerType(), r.getStatus(),
                r.getProvidersChecked() == null ? 0 : r.getProvidersChecked(),
                r.getProvidersUpdated() == null ? 0 : r.getProvidersUpdated(), changes,
                r.getDurationSec() == null ? 0 : r.getDurationSec(), r.getStartedAt());
    }

    private AttestationReminderRule loadRule(Long id) {
        return ruleRepository.findByIdAndOrgId(id, authContext.orgId())
                .orElseThrow(() -> NotFoundException.of("Reminder rule", id));
    }

    private void applyRule(AttestationReminderRule rule, RuleRequest r) {
        String name = r.name().trim();
        boolean dup = ruleRepository.findByOrgId(rule.getOrgId()).stream()
                .anyMatch(x -> !x.getId().equals(rule.getId()) && x.getName().equalsIgnoreCase(name));
        if (dup) throw new ConflictException("A rule named \"" + name + "\" already exists");
        rule.setName(name);
        rule.setDaysBefore(r.daysBefore());
        rule.setChannel(r.channel());
        rule.setTemplate(r.template());
        rule.setEnabled(r.enabled() == null || r.enabled());
    }

    private static RuleItem toRule(AttestationReminderRule r) {
        return new RuleItem(r.getId(), r.getName(), r.getDaysBefore(), r.getChannel(), r.getTemplate(),
                Boolean.TRUE.equals(r.getEnabled()), r.getLastTriggeredAt(), r.getSentCount() == null ? 0 : r.getSentCount());
    }

    private static AttestationReminderLog logRow(Long orgId, Long ruleId, Long providerId, String channel, String template,
                                                 LocalDate due, String triggeredBy) {
        AttestationReminderLog l = new AttestationReminderLog();
        l.setOrgId(orgId);
        l.setRuleId(ruleId);
        l.setProviderId(providerId);
        l.setChannel(channel);
        l.setTemplate(template);
        l.setDueDate(due);
        l.setStatus("queued");
        l.setTriggeredBy(triggeredBy);
        l.setSentAt(LocalDateTime.now());
        return l;
    }

    private static ReminderLogItem toLog(AttestationReminderLog l, Map<Long, Provider> providers,
                                         Map<Long, AttestationReminderRule> rules) {
        AttestationReminderRule rule = l.getRuleId() == null ? null : rules.get(l.getRuleId());
        return new ReminderLogItem(l.getId(), l.getRuleId(), rule == null ? null : rule.getName(), l.getProviderId(),
                OpsLookupService.plainName(providers.get(l.getProviderId())), l.getChannel(), l.getTemplate(),
                l.getDueDate(), l.getStatus(), l.getTriggeredBy(), l.getSentAt());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
