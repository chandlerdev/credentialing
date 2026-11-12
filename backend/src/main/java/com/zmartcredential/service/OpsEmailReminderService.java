package com.zmartcredential.service;

import com.zmartcredential.common.PageResponse;
import com.zmartcredential.dto.email.OpsEmailDtos.DocLine;
import com.zmartcredential.dto.email.OpsEmailDtos.EmailLogItem;
import com.zmartcredential.dto.email.OpsEmailDtos.PreviewResponse;
import com.zmartcredential.dto.email.OpsEmailDtos.ReminderCounts;
import com.zmartcredential.dto.email.OpsEmailDtos.ReminderListResponse;
import com.zmartcredential.dto.email.OpsEmailDtos.ReminderRow;
import com.zmartcredential.dto.email.OpsEmailDtos.ScheduleItem;
import com.zmartcredential.dto.email.OpsEmailDtos.ScheduleProvider;
import com.zmartcredential.dto.email.OpsEmailDtos.ScheduleRequest;
import com.zmartcredential.dto.email.OpsEmailDtos.SendNowResponse;
import com.zmartcredential.dto.email.OpsEmailDtos.TemplateItem;
import com.zmartcredential.entity.DocumentType;
import com.zmartcredential.entity.EmailLog;
import com.zmartcredential.entity.EmailTemplate;
import com.zmartcredential.entity.Location;
import com.zmartcredential.entity.Organization;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.entity.ProviderDocument;
import com.zmartcredential.entity.ProviderInvite;
import com.zmartcredential.entity.ReminderSchedule;
import com.zmartcredential.entity.ReminderScheduleProvider;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.DocumentTypeRepository;
import com.zmartcredential.repository.EmailLogRepository;
import com.zmartcredential.repository.EmailTemplateRepository;
import com.zmartcredential.repository.LocationRepository;
import com.zmartcredential.repository.OrganizationRepository;
import com.zmartcredential.repository.ProviderDocumentRepository;
import com.zmartcredential.repository.ReminderScheduleProviderRepository;
import com.zmartcredential.repository.ReminderScheduleRepository;
import com.zmartcredential.security.AuthContext;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** Email reminders: derived reminder list, templates + preview, schedules, send-now / scheduled sends (SMTP), email log. */
@Service
@RequiredArgsConstructor
public class OpsEmailReminderService {

    public static final int EXPIRING_WINDOW_DAYS = 60;
    private static final LocalTime RUN_TIME = LocalTime.of(8, 0);
    private static final DateTimeFormatter LONG_DATE = DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy", Locale.US);
    private static final DateTimeFormatter SHORT_DATE = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);
    private static final Pattern VAR = Pattern.compile("\\{\\{\\s*([a-z_]+)\\s*}}");
    private static final String MAIL_OFF = "Email sending is switched off on this server, so the reminders were only recorded in the email log.";

    private final ProviderDocumentRepository documentRepository;
    private final DocumentTypeRepository documentTypeRepository;
    private final EmailLogRepository emailLogRepository;
    private final EmailTemplateRepository templateRepository;
    private final ReminderScheduleRepository scheduleRepository;
    private final ReminderScheduleProviderRepository scheduleProviderRepository;
    private final LocationRepository locationRepository;
    private final OrganizationRepository organizationRepository;
    private final OpsLookupService lookup;
    private final MailService mailService;
    private final SecureLinkIssuer linkIssuer;
    private final AuthContext authContext;

    /** Per-provider document status used by the reminder list and template variables. */
    private record DocState(List<DocLine> missing, List<DocLine> expiring, int total, int missingCritical) {
    }

    // ---------------------------------------------------------------- reminder list

    @Transactional(readOnly = true)
    public ReminderListResponse reminders(String tab, String q) {
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        Map<Long, Provider> providers = lookup.providersById(orgId);
        Map<Long, DocState> states = docStates(orgId);
        Map<Long, LocalDateTime> lastSent = new HashMap<>();
        for (Object[] row : emailLogRepository.findLastSentPerProvider(orgId)) {
            lastSent.put((Long) row[0], (LocalDateTime) row[1]);
        }
        Map<Long, ReminderSchedule> activeByProvider = activeScheduleByProvider(orgId);
        Map<Long, String> locations = locationRepository.findByOrgId(orgId).stream()
                .collect(Collectors.toMap(Location::getId, Location::getName));

        String needle = q == null || q.isBlank() ? null : q.trim().toLowerCase(Locale.ROOT);
        List<ReminderRow> rows = new ArrayList<>();
        for (Provider p : providers.values()) {
            if (needle != null) {
                if (!com.zmartcredential.util.SearchText.matches(needle, OpsLookupService.plainName(p), p.getEmail(), p.getNpi())) continue;
            }
            DocState s = states.getOrDefault(p.getId(), new DocState(List.of(), List.of(), 0, 0));
            int missing = s.missing().size();
            String status;
            String label;
            if (missing == 0) {
                status = "complete";
                label = "Complete";
            } else if (missing >= s.total()) {
                status = "missing_all";
                label = "Missing Documents";
            } else {
                status = "has_missing";
                label = "Has Missing";
            }
            ReminderSchedule sch = activeByProvider.get(p.getId());
            rows.add(new ReminderRow(p.getId(), OpsLookupService.plainName(p), p.getEmail(), p.getLocationId(),
                    locations.get(p.getLocationId()), p.getStatus(), missing, s.total(), s.missingCritical(),
                    s.expiring().size(), status, label, lastSent.get(p.getId()),
                    sch == null ? null : sch.getId(), sch == null ? null : sch.getCadence()));
        }
        rows.sort(Comparator.comparing(ReminderRow::name, String.CASE_INSENSITIVE_ORDER));
        ReminderCounts counts = new ReminderCounts(rows.size(),
                rows.stream().filter(r -> r.missing() > 0).count(),
                rows.stream().filter(r -> r.cadence() != null).count(),
                rows.stream().filter(r -> r.missing() == 0).count());
        String t = tab == null ? "all" : tab;
        List<ReminderRow> filtered = switch (t) {
            case "missing" -> rows.stream().filter(r -> r.missing() > 0).toList();
            case "active" -> rows.stream().filter(r -> r.cadence() != null).toList();
            case "complete" -> rows.stream().filter(r -> r.missing() == 0).toList();
            case "expiring" -> rows.stream().filter(r -> r.expiringSoon() > 0).toList();
            default -> rows;
        };
        return new ReminderListResponse(filtered, counts);
    }

    // ---------------------------------------------------------------- templates

    @Transactional(readOnly = true)
    public List<TemplateItem> templates() {
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        return templateRepository.findByOrgIdIsNullOrOrgId(orgId).stream()
                // Provider Link / Enrollment Mail templates have their own screens
                .filter(t -> !MailTemplateService.PROVIDER_LINK.equals(t.getType()) && !MailTemplateService.ENROLLMENT_APPROVED.equals(t.getType()))
                .filter(t -> !Boolean.TRUE.equals(t.getDeleted()))
                .sorted(Comparator.comparing((EmailTemplate t) -> t.getOrgId() == null).thenComparing(EmailTemplate::getId))
                .map(t -> new TemplateItem(t.getId(), t.getType(), t.getName(), t.getSubject(), t.getBody(),
                        t.getOrgId() == null, variablesOf(t)))
                .toList();
    }

    @Transactional(readOnly = true)
    public PreviewResponse preview(Long templateId, Long providerId) {
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        EmailTemplate t = loadTemplate(templateId, orgId);
        Provider p = providerId == null ? null : lookup.requireProvider(orgId, providerId);
        Map<String, String> vars = variables(orgId, p, p == null ? null : docStates(orgId).get(p.getId()));
        return new PreviewResponse(render(t.getSubject(), vars), render(t.getBody(), vars), providerId,
                p == null ? null : p.getEmail());
    }

    // ---------------------------------------------------------------- schedules

    @Transactional(readOnly = true)
    public List<ScheduleItem> schedules() {
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        List<ReminderSchedule> list = scheduleRepository.findByOrgIdOrderByCreatedAtDesc(orgId);
        return toItems(orgId, list);
    }

    @Transactional
    public ScheduleItem createSchedule(ScheduleRequest req) {
        lookup.requireWriter();
        Long orgId = authContext.orgId();
        EmailTemplate tpl;
        if (req.templateId() != null) {
            tpl = loadTemplate(req.templateId(), orgId);
        } else {
            tpl = templateRepository.findByOrgIdIsNullOrOrgId(orgId).stream()
                    .filter(x -> req.reminderType().equals(x.getType()))
                    .min(Comparator.comparing((EmailTemplate x) -> x.getOrgId() == null).thenComparing(EmailTemplate::getId))
                    .orElseThrow(() -> new BadRequestException("No email template exists for reminder type " + req.reminderType()));
        }
        Set<Long> providerIds = new LinkedHashSet<>(req.providerIds());
        providerIds.remove(null);
        if (providerIds.isEmpty()) throw new BadRequestException("Select at least one provider");
        for (Long pid : providerIds) lookup.requireProvider(orgId, pid);

        ReminderSchedule s = new ReminderSchedule();
        s.setOrgId(orgId);
        s.setReminderType(req.reminderType());
        s.setTemplateId(tpl.getId());
        s.setCadence(req.cadence());
        s.setActive(true);
        s.setNextRunAt(firstRun(LocalDateTime.now()));
        s.setCreatedBy(authContext.userId());
        scheduleRepository.saveAndFlush(s);
        for (Long pid : providerIds) {
            ReminderScheduleProvider link = new ReminderScheduleProvider();
            link.setScheduleId(s.getId());
            link.setProviderId(pid);
            scheduleProviderRepository.save(link);
        }
        return toItems(orgId, List.of(s)).get(0);
    }

    @Transactional
    public ScheduleItem setActive(Long id, boolean active) {
        lookup.requireWriter();
        Long orgId = authContext.orgId();
        ReminderSchedule s = loadSchedule(id, orgId);
        s.setActive(active);
        if (active && (s.getNextRunAt() == null || s.getNextRunAt().isBefore(LocalDateTime.now()))) {
            s.setNextRunAt(firstRun(LocalDateTime.now()));
        }
        if (!active) s.setNextRunAt(null);
        scheduleRepository.save(s);
        return toItems(orgId, List.of(s)).get(0);
    }

    @Transactional
    public void deleteSchedule(Long id) {
        lookup.requireWriter();
        ReminderSchedule s = loadSchedule(id, authContext.orgId());
        scheduleProviderRepository.deleteByScheduleId(s.getId());
        scheduleRepository.delete(s);
    }

    /** Sends the schedule's reminder now to each of its providers who has something to be reminded about. */
    @Transactional
    public SendNowResponse sendNow(Long id) {
        lookup.requireWriter();
        return run(loadSchedule(id, authContext.orgId()), authContext.userId());
    }

    /** Active schedules whose next run has been reached, for the background reminder job. */
    @Transactional(readOnly = true)
    public List<Long> dueScheduleIds(LocalDateTime now) {
        return scheduleRepository.findByActiveTrueAndNextRunAtLessThanEqual(now).stream().map(ReminderSchedule::getId).toList();
    }

    /** Runs one due schedule from the background job (no signed-in user). */
    @Transactional
    public SendNowResponse runScheduled(Long id) {
        ReminderSchedule s = scheduleRepository.findById(id).orElseThrow(() -> NotFoundException.of("Reminder schedule", id));
        return run(s, null);
    }

    /**
     * Emails one reminder per provider of the schedule that has an email address and something to be reminded about
     * (missing docs / expiring docs; "incomplete" always applies). A template that uses {{upload_link}} or {{pin}}
     * gets a fresh secure upload link for that provider. Every message is recorded in the email log.
     */
    private SendNowResponse run(ReminderSchedule s, Long actorUserId) {
        Long orgId = s.getOrgId();
        EmailTemplate tpl = s.getTemplateId() == null ? null
                : templateRepository.findById(s.getTemplateId())
                .filter(t -> t.getOrgId() == null || t.getOrgId().equals(orgId)).orElse(null);
        if (tpl == null) throw new BadRequestException("The schedule's email template no longer exists");
        boolean needsLink = usesLink(tpl);
        Map<Long, DocState> states = docStates(orgId);
        Map<Long, Provider> providers = lookup.providersById(orgId);
        int processed = 0;
        int skipped = 0;
        int sent = 0;
        int failed = 0;
        String lastError = null;
        for (ReminderScheduleProvider link : scheduleProviderRepository.findByScheduleId(s.getId())) {
            Provider p = providers.get(link.getProviderId());
            if (p == null || p.getEmail() == null || p.getEmail().isBlank()) {
                skipped++;
                continue;
            }
            DocState st = states.get(p.getId());
            boolean relevant = switch (s.getReminderType()) {
                case "missing_docs" -> st != null && !st.missing().isEmpty();
                case "expiring" -> st != null && !st.expiring().isEmpty();
                default -> true;
            };
            if (!relevant) {
                skipped++;
                continue;
            }
            Map<String, String> vars = variables(orgId, p, st);
            if (needsLink) addLink(vars, linkIssuer.issue(p, p.getEmail(), actorUserId));
            MailService.Result r = deliver(orgId, p, s.getId(), render(tpl.getSubject(), vars), render(tpl.getBody(), vars));
            processed++;
            if (r.sent()) sent++;
            if ("failed".equals(r.status())) {
                failed++;
                lastError = r.error();
            }
        }
        LocalDateTime now = LocalDateTime.now();
        s.setLastSentAt(now);
        if (Boolean.TRUE.equals(s.getActive())) s.setNextRunAt(advance(now.toLocalDate().atTime(RUN_TIME), s.getCadence()));
        scheduleRepository.save(s);
        return new SendNowResponse(processed, skipped, mailService.enabled(orgId) ? "smtp" : "deferred",
                summary(orgId, sent, failed, lastError), sent, failed);
    }

    private String summary(Long orgId, int sent, int failed, String lastError) {
        if (!mailService.enabled(orgId)) return MAIL_OFF;
        if (failed == 0) return sent + " email(s) sent.";
        return sent + " email(s) sent, " + failed + " failed" + (lastError == null ? "." : ": " + lastError);
    }

    private static final Pattern LINK_VAR = Pattern.compile("\\{\\{\\s*(upload_link|pin|access_pin)\\s*}}");

    private static boolean usesLink(EmailTemplate t) {
        return LINK_VAR.matcher((t.getSubject() == null ? "" : t.getSubject()) + " " + (t.getBody() == null ? "" : t.getBody())).find();
    }

    private void addLink(Map<String, String> vars, ProviderInvite inv) {
        vars.put("pin", inv.getPin());
        vars.put("access_pin", inv.getPin());
        vars.put("upload_link", mailService.publicUrl() + SecureLinkIssuer.uploadPath(inv));
        vars.put("link_expires", inv.getExpiresAt().format(SecureLinkIssuer.EXPIRY_FMT));
        vars.put("link_expires_at", vars.get("link_expires"));
    }

    // ---------------------------------------------------------------- email log

    @Transactional(readOnly = true)
    public PageResponse<EmailLogItem> log(Long providerId, int page, int size) {
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        PageRequest pr = PageRequest.of(Math.max(0, page), Math.min(Math.max(1, size), 200));
        Page<EmailLog> result = providerId == null
                ? emailLogRepository.findByOrgIdOrderByCreatedAtDesc(orgId, pr)
                : emailLogRepository.findByOrgIdAndProviderIdOrderByCreatedAtDesc(orgId, providerId, pr);
        Map<Long, Provider> providers = lookup.providersById(orgId);
        return PageResponse.of(result, e -> new EmailLogItem(e.getId(), e.getProviderId(),
                OpsLookupService.plainName(providers.get(e.getProviderId())), e.getScheduleId(), e.getToEmail(),
                e.getSubject(), e.getStatus(), e.getCreatedAt()));
    }

    /**
     * Emails the provider and records the message in the email log as sent / failed / queued (sending switched off).
     * Used by other ops services too.
     */
    public MailService.Result deliver(Long orgId, Provider p, Long scheduleId, String subject, String body) {
        MailService.Result r = mailService.send(orgId, p.getEmail(), subject, body);
        EmailLog e = new EmailLog();
        e.setOrgId(orgId);
        e.setProviderId(p.getId());
        e.setScheduleId(scheduleId);
        e.setToEmail(p.getEmail());
        e.setSubject(subject.length() > 255 ? subject.substring(0, 255) : subject);
        e.setStatus(r.status());
        emailLogRepository.save(e);
        return r;
    }

    // ---------------------------------------------------------------- helpers

    private Map<Long, DocState> docStates(Long orgId) {
        Map<String, DocumentType> types = documentTypeRepository.findAllByOrderBySortOrderAsc().stream()
                .collect(Collectors.toMap(DocumentType::getCode, t -> t, (a, b) -> a, LinkedHashMap::new));
        LocalDate today = LocalDate.now();
        LocalDate horizon = today.plusDays(EXPIRING_WINDOW_DAYS);
        Map<Long, List<ProviderDocument>> byProvider = documentRepository.findByOrgId(orgId).stream()
                .collect(Collectors.groupingBy(ProviderDocument::getProviderId));
        Map<Long, DocState> out = new HashMap<>();
        byProvider.forEach((pid, docs) -> {
            List<DocLine> missing = new ArrayList<>();
            List<DocLine> expiring = new ArrayList<>();
            int total = 0;
            int critical = 0;
            docs.sort(Comparator.comparing(d -> types.containsKey(d.getDocType()) ? types.get(d.getDocType()).getSortOrder() : 999));
            for (ProviderDocument d : docs) {
                if ("na".equals(d.getStatus())) continue;
                total++;
                DocumentType dt = types.get(d.getDocType());
                String label = dt == null ? d.getDocType() : dt.getLabel();
                boolean expiredByDate = d.getExpiresAt() != null && d.getExpiresAt().isBefore(today);
                if ("missing".equals(d.getStatus()) || "expired".equals(d.getStatus()) || expiredByDate) {
                    missing.add(new DocLine(label, d.getExpiresAt()));
                    if (dt != null && Boolean.TRUE.equals(dt.getCritical())) critical++;
                } else if (d.getExpiresAt() != null && !d.getExpiresAt().isAfter(horizon)) {
                    expiring.add(new DocLine(label, d.getExpiresAt()));
                }
            }
            out.put(pid, new DocState(missing, expiring, total, critical));
        });
        return out;
    }

    private Map<Long, ReminderSchedule> activeScheduleByProvider(Long orgId) {
        Map<Long, ReminderSchedule> active = scheduleRepository.findByOrgIdOrderByCreatedAtDesc(orgId).stream()
                .filter(s -> Boolean.TRUE.equals(s.getActive()))
                .collect(Collectors.toMap(ReminderSchedule::getId, s -> s, (a, b) -> a, LinkedHashMap::new));
        Map<Long, ReminderSchedule> out = new HashMap<>();
        if (active.isEmpty()) return out;
        for (ReminderScheduleProvider link : scheduleProviderRepository.findByScheduleIdIn(active.keySet())) {
            ReminderSchedule s = active.get(link.getScheduleId());
            ReminderSchedule prev = out.get(link.getProviderId());
            if (prev == null || (s.getCreatedAt() != null && prev.getCreatedAt() != null && s.getCreatedAt().isAfter(prev.getCreatedAt()))) {
                out.put(link.getProviderId(), s);
            }
        }
        return out;
    }

    private Map<String, String> variables(Long orgId, Provider p, DocState st) {
        Organization org = organizationRepository.findById(orgId).orElse(null);
        Map<String, String> v = new HashMap<>();
        v.put("organization_name", org == null ? "your credentialing team" : org.getName());
        v.put("org_name", v.get("organization_name"));
        v.put("pin", "[6-digit PIN generated when the email is sent]");
        v.put("access_pin", v.get("pin"));
        v.put("upload_link", "[secure upload link generated when the email is sent]");
        v.put("link_expires", LONG_DATE.format(LocalDate.now().plusDays(7)));
        v.put("link_expires_at", v.get("link_expires"));
        if (p == null) {
            v.put("provider_first_name", "Jane");
            v.put("provider_last_name", "Doe");
            v.put("provider_name", "Jane Doe");
            v.put("pending_document_count", "3");
            v.put("missing_document_list", "• Medical License\n• DEA Certificate\n• Malpractice Insurance");
            v.put("expiring_document_list", "• Malpractice Insurance (expires " + SHORT_DATE.format(LocalDate.now().plusDays(21)) + ")");
            return v;
        }
        v.put("provider_first_name", p.getFirstName());
        v.put("provider_last_name", p.getLastName());
        v.put("provider_name", OpsLookupService.plainName(p));
        List<DocLine> missing = st == null ? List.of() : st.missing();
        List<DocLine> expiring = st == null ? List.of() : st.expiring();
        v.put("pending_document_count", String.valueOf(missing.size()));
        v.put("missing_document_list", missing.isEmpty() ? "(none — all required documents are on file)"
                : missing.stream().map(d -> "• " + d.label()).collect(Collectors.joining("\n")));
        v.put("expiring_document_list", expiring.isEmpty() ? "(no documents expiring in the next " + EXPIRING_WINDOW_DAYS + " days)"
                : expiring.stream().map(d -> "• " + d.label() + " (expires " + SHORT_DATE.format(d.expiresAt()) + ")")
                .collect(Collectors.joining("\n")));
        return v;
    }

    static String render(String text, Map<String, String> vars) {
        if (text == null) return "";
        String normalized = text.replace("\\n", "\n");
        Matcher m = VAR.matcher(normalized);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String val = vars.get(m.group(1));
            m.appendReplacement(sb, Matcher.quoteReplacement(val == null ? m.group(0) : val));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static List<String> variablesOf(EmailTemplate t) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = VAR.matcher((t.getSubject() == null ? "" : t.getSubject()) + " " + (t.getBody() == null ? "" : t.getBody()));
        while (m.find()) out.add(m.group(1));
        return new ArrayList<>(out);
    }

    private List<ScheduleItem> toItems(Long orgId, List<ReminderSchedule> list) {
        if (list.isEmpty()) return List.of();
        Map<Long, Provider> providers = lookup.providersById(orgId);
        Map<Long, String> templateNames = templateRepository.findByOrgIdIsNullOrOrgId(orgId).stream()
                .collect(Collectors.toMap(EmailTemplate::getId, EmailTemplate::getName));
        Map<Long, List<Long>> links = scheduleProviderRepository
                .findByScheduleIdIn(list.stream().map(ReminderSchedule::getId).toList()).stream()
                .collect(Collectors.groupingBy(ReminderScheduleProvider::getScheduleId,
                        Collectors.mapping(ReminderScheduleProvider::getProviderId, Collectors.toList())));
        return list.stream().map(s -> {
            List<ScheduleProvider> ps = links.getOrDefault(s.getId(), List.of()).stream()
                    .map(providers::get).filter(java.util.Objects::nonNull)
                    .map(p -> new ScheduleProvider(p.getId(), OpsLookupService.plainName(p), p.getEmail()))
                    .toList();
            return new ScheduleItem(s.getId(), s.getReminderType(), s.getTemplateId(), templateNames.get(s.getTemplateId()),
                    s.getCadence(), Boolean.TRUE.equals(s.getActive()), s.getNextRunAt(), s.getLastSentAt(),
                    s.getCreatedAt(), ps.size(), ps);
        }).toList();
    }

    private EmailTemplate loadTemplate(Long id, Long orgId) {
        return templateRepository.findById(id)
                .filter(t -> t.getOrgId() == null || t.getOrgId().equals(orgId))
                .orElseThrow(() -> NotFoundException.of("Email template", id));
    }

    private ReminderSchedule loadSchedule(Long id, Long orgId) {
        return scheduleRepository.findByIdAndOrgId(id, orgId).orElseThrow(() -> NotFoundException.of("Reminder schedule", id));
    }

    /** Next 08:00 occurrence (today if it is still before 08:00). */
    static LocalDateTime firstRun(LocalDateTime now) {
        LocalDateTime today = now.toLocalDate().atTime(RUN_TIME);
        return now.isBefore(today) ? today : today.plusDays(1);
    }

    static LocalDateTime advance(LocalDateTime from, String cadence) {
        return switch (cadence) {
            case "daily" -> from.plusDays(1);
            case "weekly" -> from.plusWeeks(1);
            case "biweekly" -> from.plusWeeks(2);
            case "monthly" -> from.plusMonths(1);
            default -> from.plusWeeks(1);
        };
    }
}
