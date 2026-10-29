package com.zmartcredential.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zmartcredential.dto.enrollment.EnrollmentFileResponse;
import com.zmartcredential.dto.enrollment.EnrollmentRequest;
import com.zmartcredential.entity.Enrollment;
import com.zmartcredential.entity.EnrollmentWorkflowLog;
import com.zmartcredential.entity.Payer;
import com.zmartcredential.entity.Practice;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.ConflictException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.EnrollmentRepository;
import com.zmartcredential.repository.EnrollmentWorkflowLogRepository;
import com.zmartcredential.repository.PracticeRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.PermissionService;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * Payer Submission: the payers assigned to a provider (an assigned payer = an enrollment) and each one's credentialing
 * workflow (credentialing-workflows.json: commercial NCQA-aligned, Medicare PECOS, Medicaid) — steps, checklists,
 * details, documents, and the calls / e-mails made to the payer. The enrollment's status and dates follow the steps.
 */
@Service
@RequiredArgsConstructor
public class PayerWorkflowService {

    private static final TypeReference<LinkedHashMap<String, Object>> MAP = new TypeReference<>() {
    };
    private static final DateTimeFormatter SHORT = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);
    public static final Set<String> METHODS = Set.of("portal", "phone");
    /** The call statuses: attended (the payer was reached — the notes are logged) or not (a next follow-up is set). */
    public record CallStatus(String label, boolean attended) {
    }

    public static final List<CallStatus> CALL_STATUSES = List.of(
            new CallStatus("Call attended", true),
            new CallStatus("Transferred and attended", true),
            new CallStatus("Call dropped", false),
            new CallStatus("Missed call / no answer", false),
            new CallStatus("Line busy", false),
            new CallStatus("Left voicemail", false),
            new CallStatus("On hold too long", false),
            new CallStatus("Office closed", false),
            new CallStatus("Wrong number", false),
            new CallStatus("Other reason", false));
    private static final Pattern CAQH_DOCS = Pattern.compile("license|DEA|board|malpractice|CV|diploma|attestation", Pattern.CASE_INSENSITIVE);

    private static final ObjectMapper json = new ObjectMapper();
    private final EnrollmentRepository enrollmentRepository;
    private final EnrollmentWorkflowLogRepository logRepository;
    private final EnrollmentService enrollmentService;
    private final EnrollmentSupport support;
    private final ProviderRepository providerRepository;
    private final PracticeRepository practiceRepository;
    private final PermissionService permissionService;
    private final AuthContext authContext;
    private final MailService mailService;
    private final MailTemplateService mailTemplateService;
    private final PayerWorkflowDefs defs;
    private final PayerInboxService inboxService;
    private final com.zmartcredential.repository.OrganizationRepository organizationRepository;

    // ------------------------------------------------------------------ records

    public record Card(Long enrollmentId, Long payerId, String name, String fullName, String category, String color, String logo,
                       String initials, Integer avgTatDays, String integration, String appForm, String portalUrl,
                       String supportEmail, String supportPhone, String workflow, String workflowLabel, int step, int totalSteps,
                       String stepShort, String statusLabel, String statusTone, boolean approved, String enrollmentStatus) {
    }

    public record LogItem(Long id, String type, String text, LocalDateTime at, String by) {
    }

    public record ProviderInfo(Long id, String name, String credentials, String npi, String caqhId, String email) {
    }

    public record Flow(Card card, ProviderInfo provider, int step, String method, Map<String, Object> tasks,
                       Map<String, Object> fields, Map<String, Object> docs, Map<String, Object> stepStarted,
                       List<LogItem> log, Map<String, String> emailVars, String senderName,
                       LocalDate lastFollowUp, LocalDate nextFollowUp) {
    }

    public record Assignment(Long payerId, Long enrollmentId, int step, String status) {
    }

    public record CallRequest(String outcome, String ref, String notes, Integer minutes, LocalDate nextFollowUp) {
    }

    public record EmailRequest(String to, String subject, String body, String template, Boolean send, LocalDate nextFollowUp) {
    }

    // ------------------------------------------------------------------ definitions

    /** The definitions as plain maps / lists (the web layer writes them as JSON). */
    public Map<String, Object> meta() {
        authContext.requireStaff();
        Map<String, Object> m = json.convertValue(defs.all(), MAP);
        m.put("callStatuses", CALL_STATUSES);
        return m;
    }

    private JsonNode wf(Payer p) {
        return defs.workflow(p);
    }

    private static String workflowKey(Payer p) {
        return PayerWorkflowDefs.workflowKey(p);
    }

    private static int indexOf(JsonNode wf, String key) {
        return PayerWorkflowDefs.indexOf(wf, key);
    }

    // ------------------------------------------------------------------ assignment (Admin → Payers)

    /** The payers assigned to a provider: their open (not terminated) enrollments. */
    @Transactional(readOnly = true)
    public List<Assignment> assignments(Long providerId) {
        permissionService.require("enrollment", "list");
        authContext.requireStaff();
        return current(providerId).stream().map(e -> new Assignment(e.getPayerId(), e.getId(), stepOf(e), e.getStatus())).toList();
    }

    @Transactional
    public Assignment assign(Long providerId, Long payerId) {
        permissionService.require("enrollment", "create");
        authContext.requireStaff();
        support.provider(providerId, authContext.orgId());
        Enrollment existing = current(providerId).stream().filter(e -> e.getPayerId().equals(payerId)).findFirst().orElse(null);
        if (existing != null) return new Assignment(payerId, existing.getId(), stepOf(existing), existing.getStatus());
        Enrollment e = enrollmentService.createEntity(new EnrollmentRequest(providerId, payerId, "draft", "initial", null, null, null, null,
                null, null, null, null, null), true, "Payer assigned to the provider");
        e.setWfStep(0);
        e.setWfStepStarted(write(new LinkedHashMap<>(Map.of("0", LocalDateTime.now().toString()))));
        enrollmentRepository.save(e);
        return new Assignment(payerId, e.getId(), 0, e.getStatus());
    }

    /** Unassign: only while the payer's workflow has not started (no step, call, email or checklist item). */
    @Transactional
    public void unassign(Long providerId, Long payerId) {
        authContext.requireStaff();
        Enrollment e = current(providerId).stream().filter(x -> x.getPayerId().equals(payerId)).findFirst()
                .orElseThrow(() -> new NotFoundException("This payer is not assigned to the provider"));
        boolean started = stepOf(e) > 0 || !logRepository.findByEnrollmentIdOrderByIdDesc(e.getId()).isEmpty()
                || !"draft".equals(e.getStatus()) || e.getSubmittedDate() != null;
        if (started) throw new ConflictException("The workflow for this payer has already started; it can't be unassigned (close the enrollment instead)");
        enrollmentService.delete(e.getId());
    }

    private List<Enrollment> current(Long providerId) {
        Long orgId = authContext.orgId();
        Map<Long, Enrollment> byPayer = new LinkedHashMap<>();
        enrollmentRepository.findByOrgIdAndProviderId(orgId, providerId).stream()
                .filter(e -> !"terminated".equals(e.getStatus()))
                .sorted(Comparator.comparing(Enrollment::getId).reversed())
                .forEach(e -> byPayer.putIfAbsent(e.getPayerId(), e));
        return new ArrayList<>(byPayer.values());
    }

    // ------------------------------------------------------------------ cards and the flow

    /** Payer Submission: the cards of the payers assigned to the provider. */
    @Transactional(readOnly = true)
    public List<Card> cards(Long providerId) {
        permissionService.require("enrollment", "list");
        authContext.requireStaff();
        support.provider(providerId, authContext.orgId());
        Map<Long, Payer> payers = support.payerMap();
        return current(providerId).stream().map(e -> card(e, payers.get(e.getPayerId()))).filter(Objects::nonNull)
                .sorted(Comparator.comparing(Card::name, String.CASE_INSENSITIVE_ORDER)).toList();
    }

    @Transactional(readOnly = true)
    public Flow flow(Long enrollmentId) {
        permissionService.require("enrollment", "read");
        authContext.requireStaff();
        return flowOf(load(enrollmentId));
    }

    private Card card(Enrollment e, Payer p) {
        if (p == null) return null;
        JsonNode wf = wf(p);
        int total = wf.path("steps").size();
        int step = Math.min(stepOf(e), total - 1);
        JsonNode s = wf.path("steps").get(step);
        int approvedIdx = indexOf(wf, "approved");
        boolean approved = approvedIdx >= 0 && step > approvedIdx;
        String label, tone;
        if ("maintain".equals(s.path("key").asText())) {
            label = "Active - maintaining";
            tone = "ok";
        } else if (approved) {
            label = "Approved · " + s.path("short").asText();
            tone = "ok";
        } else {
            label = "Step " + (step + 1) + "/" + total + ": " + s.path("short").asText();
            tone = "active";
        }
        return new Card(e.getId(), p.getId(), p.getName(), p.getFullName(), p.getCategory(), p.getColor(), p.getLogo(), initials(p.getName()),
                p.getAvgTatDays(), p.getIntegration(), p.getAppForm(), p.getPortalUrl(), p.getSupportEmail(), p.getSupportPhone(),
                workflowKey(p), wf.path("label").asText(), step, total, s.path("short").asText(), label, tone, approved, e.getStatus());
    }

    private Flow flowOf(Enrollment e) {
        Payer p = support.payer(e.getPayerId());
        Provider pr = providerRepository.findById(e.getProviderId()).orElseThrow(() -> NotFoundException.of("Provider", e.getProviderId()));
        Map<String, Object> fields = read(e.getWfFields());
        // the enrollment's own dates are the workflow's
        if (e.getSubmittedDate() != null) fields.put("submittedDate", e.getSubmittedDate().toString());
        if (e.getEffectiveDate() != null) fields.put("effectiveDate", e.getEffectiveDate().toString());
        List<LogItem> log = logRepository.findByEnrollmentIdOrderByIdDesc(e.getId()).stream()
                .map(l -> new LogItem(l.getId(), l.getLogType(), l.getText(), l.getCreatedAt(), l.getCreatedByName())).toList();
        Card c = card(e, p);
        return new Flow(c, new ProviderInfo(pr.getId(), plainName(pr), pr.getSuffix(), pr.getNpi(), pr.getCaqhId(), pr.getEmail()),
                c.step(), e.getWfMethod(), read(e.getWfTasks()), fields, read(e.getWfDocs()), read(e.getWfStepStarted()), log,
                emailVars(e, p, pr, fields, c), support.actorLabel(), e.getFollowUpDate(), e.getNextFollowUpDate());
    }

    private Map<String, String> emailVars(Enrollment e, Payer p, Provider pr, Map<String, Object> f, Card c) {
        Map<String, String> v = new LinkedHashMap<>();
        Practice practice = pr.getPracticeId() == null ? null : practiceRepository.findById(pr.getPracticeId()).orElse(null);
        v.put("providerName", plainName(pr));
        v.put("credentials", nz(pr.getSuffix()));
        v.put("npi", nz(pr.getNpi()));
        v.put("specialty", nz(pr.getSpecialty()));
        v.put("caqhId", nz(pr.getCaqhId()));
        v.put("groupNpi", nz(pr.getGroupNpi()));
        v.put("tin", nz(pr.getTaxId() != null ? pr.getTaxId() : practice == null ? null : practice.getTaxId()));
        v.put("practice", nz(pr.getPracticeLegalName() != null ? pr.getPracticeLegalName() : practice == null ? null : practice.getName()));
        String addr = pr.getPracticeAddress() == null ? (practice == null ? null : practice.getAddress())
                : String.join(", ", java.util.stream.Stream.of(pr.getPracticeAddress(), pr.getPracticeCity(), joinNonNull(pr.getPracticeState(), pr.getPracticeZip()))
                .filter(x -> x != null && !x.isBlank()).toList());
        v.put("address", nz(addr));
        v.put("payerName", p.getName());
        v.put("caseNo", str(f.get("caseNo")));
        v.put("referenceNo", str(f.get("referenceNo")).isEmpty() ? str(f.get("caseNo")) : str(f.get("referenceNo")));
        v.put("payerProviderId", str(f.get("payerProviderId")));
        LocalDate sub = e.getSubmittedDate();
        v.put("submittedDate", sub == null ? "" : SHORT.format(sub));
        v.put("daysSinceSubmit", sub == null ? "" : String.valueOf(ChronoUnit.DAYS.between(sub, LocalDate.now())));
        v.put("currentStep", c == null ? "" : c.stepShort());
        v.put("senderName", nz(support.actorLabel()));
        return v;
    }

    // ------------------------------------------------------------------ changes

    @Transactional
    public Flow task(Long id, String stepKey, int index, boolean done) {
        Enrollment e = editable(id);
        JsonNode wf = wf(support.payer(e.getPayerId()));
        int si = indexOf(wf, stepKey);
        if (si < 0) throw new BadRequestException("Unknown step");
        JsonNode tasks = wf.path("steps").get(si).path("tasks");
        if (index < 0 || index >= tasks.size()) throw new BadRequestException("Unknown checklist item");
        Map<String, Object> all = read(e.getWfTasks());
        @SuppressWarnings("unchecked")
        Map<String, Object> ticks = all.get(stepKey) instanceof Map<?, ?> m ? new LinkedHashMap<>((Map<String, Object>) m) : new LinkedHashMap<>();
        if (done) ticks.put(String.valueOf(index), true);
        else ticks.remove(String.valueOf(index));
        all.put(stepKey, ticks);
        e.setWfTasks(write(all));
        enrollmentRepository.save(e);
        if (done) log(e, "task", "✓ " + tasks.get(index).asText());
        return flowOf(e);
    }

    /** A step detail (case #, submitted date, …). Dates must be real dates; the submitted / effective dates are the enrollment's. */
    @Transactional
    public Flow field(Long id, String key, String value) {
        Enrollment e = editable(id);
        JsonNode wf = wf(support.payer(e.getPayerId()));
        JsonNode def = null;
        for (JsonNode s : wf.path("steps")) for (JsonNode f : s.path("fields")) if (key.equals(f.path("key").asText())) def = f;
        if (def == null) throw new BadRequestException("Unknown detail");
        String v = value == null ? "" : value.trim();
        if (v.length() > 200) throw BadRequestException.onField(key, "At most 200 characters");
        boolean date = "date".equals(def.path("type").asText());
        LocalDate d = null;
        if (date && !v.isEmpty()) {
            try {
                d = LocalDate.parse(v);
            } catch (Exception ex) {
                throw BadRequestException.onField(key, "Enter a valid date");
            }
        }
        if ("submittedDate".equals(key)) {
            if (d != null && d.isAfter(LocalDate.now())) throw BadRequestException.onField(key, "The submitted date can't be in the future");
            e.setSubmittedDate(d);
        } else if ("effectiveDate".equals(key)) {
            if (d != null && e.getSubmittedDate() != null && d.isBefore(e.getSubmittedDate())) throw BadRequestException.onField(key, "Choose the submitted date or a later date");
            e.setEffectiveDate(d);
        } else if (("acceptedDate".equals(key) || "devRequestDate".equals(key)) && d != null && d.isAfter(LocalDate.now())) {
            throw BadRequestException.onField(key, "Can't be a future date");
        }
        if ("submittedDate".equals(key) || "effectiveDate".equals(key)) e.setTatDays(EnrollmentSupport.tat(e.getSubmittedDate(), e.getEffectiveDate()));
        Map<String, Object> fields = read(e.getWfFields());
        if (v.isEmpty()) fields.remove(key);
        else fields.put(key, v);
        e.setWfFields(write(fields));
        enrollmentRepository.save(e);
        log(e, "field", def.path("label").asText() + ": " + (v.isEmpty() ? "cleared" : d != null ? SHORT.format(d) : v));
        return flowOf(e);
    }

    @Transactional
    public Flow method(Long id, String method) {
        Enrollment e = editable(id);
        if (method == null || !METHODS.contains(method)) throw new BadRequestException("Choose portal or phone");
        e.setWfMethod(method);
        enrollmentRepository.save(e);
        log(e, "stage", "Credential method set to " + method);
        return flowOf(e);
    }

    /** complete: the current step is done (the approval step sets the effective date); back: one step back. */
    @Transactional
    public Flow step(Long id, String action) {
        Enrollment e = editable(id);
        Payer p = support.payer(e.getPayerId());
        JsonNode wf = wf(p);
        JsonNode steps = wf.path("steps");
        int step = Math.min(stepOf(e), steps.size() - 1);
        String oldStatus = e.getStatus();
        Map<String, Object> started = read(e.getWfStepStarted());
        if ("complete".equals(action)) {
            if (step >= steps.size() - 1) throw new BadRequestException("This step stays open (ongoing)");
            JsonNode s = steps.get(step);
            if ("approved".equals(s.path("key").asText())) {
                if (e.getEffectiveDate() == null) e.setEffectiveDate(LocalDate.now());
                e.setTatDays(EnrollmentSupport.tat(e.getSubmittedDate(), e.getEffectiveDate()));
                log(e, "stage", "Approved - effective " + SHORT.format(e.getEffectiveDate()));
            } else {
                log(e, "stage", "Completed step " + (step + 1) + ": " + s.path("title").asText());
            }
            step++;
            started.put(String.valueOf(step), LocalDateTime.now().toString());
        } else if ("back".equals(action)) {
            if (step == 0) throw new BadRequestException("This is the first step");
            step--;
            log(e, "stage", "Moved back to step " + (step + 1) + ": " + steps.get(step).path("title").asText());
        } else {
            throw new BadRequestException("Unknown action");
        }
        e.setWfStep(step);
        e.setWfStepStarted(write(started));
        e.setStatus(statusFor(wf, step));
        // an approved enrollment has no next follow-up (as the enrollment form)
        if ("approved".equals(e.getStatus())) e.setNextFollowUpDate(null);
        Enrollment saved = enrollmentRepository.save(e);
        enrollmentService.afterStatusChange(saved, oldStatus);
        return flowOf(saved);
    }

    /** The enrollment status a step stands for. */
    static String statusFor(JsonNode wf, int step) {
        int approvedIdx = indexOf(wf, "approved");
        if (approvedIdx >= 0 && step > approvedIdx) return "approved";
        String key = wf.path("steps").get(step).path("key").asText();
        return switch (key) {
            case "intake" -> "draft";
            case "request", "caqh" -> "in_progress";
            default -> "submitted";
        };
    }

    /** CAQH: the documents CAQH holds are marked "From CAQH" and the import checklist items ticked. */
    @Transactional
    public Flow caqh(Long id) {
        Enrollment e = editable(id);
        Provider pr = providerRepository.findById(e.getProviderId()).orElseThrow();
        JsonNode wf = wf(support.payer(e.getPayerId()));
        Map<String, Object> docs = read(e.getWfDocs());
        for (JsonNode d : wf.path("documents")) {
            String name = d.asText();
            if (!CAQH_DOCS.matcher(name).find()) continue;
            Map<String, Object> doc = docs.get(name) instanceof Map<?, ?> m ? castMap(m) : new LinkedHashMap<>();
            doc.put("caqh", true);
            docs.put(name, doc);
        }
        e.setWfDocs(write(docs));
        Map<String, Object> tasks = read(e.getWfTasks());
        for (JsonNode s : wf.path("steps")) {
            JsonNode list = s.path("tasks");
            for (int i = 0; i < list.size(); i++) {
                String t = list.get(i).asText().toLowerCase(Locale.ROOT);
                if (t.contains("import") && t.contains("caqh")) {
                    String k = s.path("key").asText();
                    Map<String, Object> ticks = tasks.get(k) instanceof Map<?, ?> m ? castMap(m) : new LinkedHashMap<>();
                    ticks.put(String.valueOf(i), true);
                    tasks.put(k, ticks);
                }
            }
        }
        e.setWfTasks(write(tasks));
        enrollmentRepository.save(e);
        log(e, "file", "Imported CAQH profile" + (pr.getCaqhId() == null ? "" : " " + pr.getCaqhId()) + " (" + EnrollmentSupport.fullName(pr)
                + (pr.getNpi() == null ? "" : ", NPI " + pr.getNpi()) + ")");
        return flowOf(e);
    }

    /** Attach a document of the workflow's list (stored as an enrollment file). */
    @Transactional
    public Flow document(Long id, int index, MultipartFile file) {
        Enrollment e = editable(id);
        JsonNode list = wf(support.payer(e.getPayerId())).path("documents");
        if (index < 0 || index >= list.size()) throw new BadRequestException("Unknown document");
        if (file == null || file.isEmpty()) throw new BadRequestException("Choose a file");
        String name = list.get(index).asText();
        EnrollmentFileResponse saved = enrollmentService.uploadFile(e.getId(), file, "other");
        Map<String, Object> docs = read(e.getWfDocs());
        Map<String, Object> doc = docs.get(name) instanceof Map<?, ?> m ? castMap(m) : new LinkedHashMap<>();
        doc.put("fileId", saved.id());
        doc.put("file", saved.name());
        doc.put("at", LocalDateTime.now().toString());
        docs.put(name, doc);
        e.setWfDocs(write(docs));
        enrollmentRepository.save(e);
        log(e, "file", "Attached " + name + " (" + saved.name() + ")");
        return flowOf(e);
    }

    /** Log a call made to the payer (outcome, rep / reference, notes, about how long). */
    @Transactional
    public Flow call(Long id, CallRequest r) {
        Enrollment e = editable(id);
        CallStatus status = CALL_STATUSES.stream().filter(s -> s.label().equals(r.outcome())).findFirst()
                .orElseThrow(() -> BadRequestException.onField("outcome", "Choose the call status"));
        if (r.minutes() != null && (r.minutes() < 0 || r.minutes() > 600)) throw BadRequestException.onField("minutes", "Between 0 and 600 minutes");
        String ref = trim(r.ref(), 120), notes = trim(r.notes(), 1500);
        if (status.attended() && notes == null) throw BadRequestException.onField("notes", "Enter what was discussed on the call");
        if ("Other reason".equals(status.label()) && notes == null) throw BadRequestException.onField("notes", "Enter the reason");
        // the next follow-up is what the call concluded (never set automatically); required when the payer wasn't reached
        if (!status.attended() && r.nextFollowUp() == null && !"approved".equals(e.getStatus())) throw BadRequestException.onField("nextFollowUp", "Choose the next follow-up date");
        checkNext(r.nextFollowUp());
        Payer p = support.payer(e.getPayerId());
        callFollowedUp(e, r.nextFollowUp());
        String text = "Called " + p.getName() + (p.getSupportPhone() == null ? "" : " (" + p.getSupportPhone() + ")") + " — " + status.label()
                + (ref == null ? "" : " · " + ref) + (r.minutes() != null && r.minutes() > 0 ? " · ~" + r.minutes() + " min" : "")
                + (notes == null ? "" : " — " + notes)
                + (r.nextFollowUp() != null && e.getNextFollowUpDate() != null ? " · next follow-up " + SHORT.format(e.getNextFollowUpDate()) : "");
        EnrollmentWorkflowLog l = log(e, "call", text);
        l.setCallOutcome(status.label());
        l.setCallAttended(status.attended());
        l.setCallRef(ref);
        l.setCallMinutes(r.minutes());
        logRepository.save(l);
        return flowOf(e);
    }

    /** E-mail the payer: sent through the organization's mail server (send) or drafted in the user's mail app (logged). */
    @Transactional
    public Flow email(Long id, EmailRequest r) {
        Enrollment e = editable(id);
        String to = r.to() == null ? "" : r.to().trim();
        if (!to.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) throw BadRequestException.onField("to", "Enter a valid email address");
        if (r.subject() == null || r.subject().isBlank()) throw BadRequestException.onField("subject", "Subject is required");
        if (r.body() == null || r.body().isBlank()) throw BadRequestException.onField("body", "Message is required");
        checkNext(r.nextFollowUp());
        String subject = trim(r.subject(), 255);
        String status, messageId = null;
        if (Boolean.TRUE.equals(r.send())) {
            MailService.Result res = mailService.send(to, subject, r.body());
            mailTemplateService.log(e.getOrgId(), e.getProviderId(), to, subject, res.status());
            if ("failed".equals(res.status())) throw new BadRequestException("Failed to send email" + (res.error() == null ? "" : ": " + res.error()));
            status = res.status();
            messageId = res.messageId();
        } else {
            status = "drafted";
        }
        String template = templateName(e.getOrgId(), r.template());
        followedUp(e, r.nextFollowUp());
        EnrollmentWorkflowLog l = log(e, "email", "Email " + ("sent".equals(status) ? "sent" : "drafted".equals(status) ? "drafted" : status) + " to " + to + ": \"" + subject + "\""
                + (template == null ? "" : " (template: " + template + ")"));
        l.setEmailTo(to.toLowerCase(Locale.ROOT));
        l.setEmailFrom(mailService.fromAddress().isEmpty() ? null : mailService.fromAddress());
        l.setEmailSubject(subject);
        l.setEmailBody(r.body().length() > 20000 ? r.body().substring(0, 20000) : r.body());
        l.setEmailStatus(status);
        l.setMessageId(messageId);
        logRepository.save(l);
        return flowOf(e);
    }

    /**
     * A call or e-mail is a follow-up with the payer: the enrollment's Last Follow Up Date becomes today and its Next
     * Follow Up Date the one chosen (else today + the follow-up cadence; none once approved).
     */
    private void followedUp(Enrollment e, LocalDate next) {
        LocalDate today = LocalDate.now();
        e.setFollowUpDate(today);
        if ("approved".equals(e.getStatus())) e.setNextFollowUpDate(null);
        else e.setNextFollowUpDate(next != null ? next : today.plusDays(defs.cadenceDays()));
        enrollmentRepository.save(e);
    }

    /** A call: Last Follow Up = today; Next Follow Up = the date the call concluded (unchanged when none was chosen). */
    private void callFollowedUp(Enrollment e, LocalDate next) {
        e.setFollowUpDate(LocalDate.now());
        if ("approved".equals(e.getStatus())) e.setNextFollowUpDate(null);
        else if (next != null) e.setNextFollowUpDate(next);
        enrollmentRepository.save(e);
    }

    private static void checkNext(LocalDate next) {
        if (next != null && next.isBefore(LocalDate.now())) throw BadRequestException.onField("nextFollowUp", "Choose today or a later date");
    }

    public record Touch(Long id, LocalDateTime at, String by, String text, String outcome, Boolean attended, String ref, Integer minutes,
                        String from, String to, String subject, String body, String status) {
    }

    // ------------------------------------------------------------------ email setup, replies

    public record TemplateOption(Long id, String code, String name, String subject, String body, boolean builtIn) {
    }

    /** The Email dialog: the sender address and the organization's payer communication templates, filled in. */
    public record EmailSetup(String from, String fromName, boolean sendingEnabled, boolean inboxEnabled, List<TemplateOption> templates) {
    }

    @Transactional(readOnly = true)
    public EmailSetup emailSetup(Long id) {
        permissionService.require("enrollment", "read");
        authContext.requireStaff();
        Enrollment e = load(id);
        Flow f = flowOf(e);
        Map<String, String> vars = templateVars(e.getOrgId(), f.emailVars());
        List<TemplateOption> list = mailTemplateService.visible(e.getOrgId(), MailTemplateService.PAYER_COMMUNICATION).stream()
                .map(t -> new TemplateOption(t.getId(), t.getCode(), t.getName(), MailTemplateService.render(t.getSubject(), vars),
                        MailTemplateService.render(t.getBody(), vars), t.getOrgId() == null))
                .toList();
        return new EmailSetup(mailService.fromAddress(), mailService.fromName(), mailService.enabled(), inboxService.enabled(), list);
    }

    /** providerName → provider_name, plus the organization name. */
    private Map<String, String> templateVars(Long orgId, Map<String, String> camel) {
        Map<String, String> v = new LinkedHashMap<>();
        camel.forEach((k, x) -> v.put(k.replaceAll("([A-Z])", "_$1").toLowerCase(Locale.ROOT), x == null ? "" : x));
        v.put("organization_name", organizationRepository.findById(orgId).map(o -> o.getName()).orElse(""));
        return v;
    }

    private String templateName(Long orgId, String ref) {
        if (ref == null || ref.isBlank()) return null;
        return mailTemplateService.visible(orgId, MailTemplateService.PAYER_COMMUNICATION).stream()
                .filter(t -> ref.equals(String.valueOf(t.getId())) || ref.equals(t.getCode())).map(t -> t.getName()).findFirst().orElse(null);
    }

    /** Reads the organization's mailbox for payer replies now (it is also read every few minutes). */
    public PayerInboxService.CheckResult checkInbox() {
        permissionService.require("enrollment", "read");
        authContext.requireStaff();
        return inboxService.check();
    }

    private static Touch touch(EnrollmentWorkflowLog l) {
        return new Touch(l.getId(), l.getCreatedAt(), l.getCreatedByName(), l.getText(), l.getCallOutcome(), l.getCallAttended(), l.getCallRef(),
                l.getCallMinutes(), l.getEmailFrom(), l.getEmailTo(), l.getEmailSubject(), l.getEmailBody(), l.getEmailStatus());
    }

    /** Enrollments → the call or e-mail follow-ups of an enrollment, newest first. */
    @Transactional(readOnly = true)
    public List<Touch> touches(Long enrollmentId, String type) {
        permissionService.require("enrollment", "read");
        authContext.requireStaff();
        if (!"call".equals(type) && !"email".equals(type)) throw new BadRequestException("Choose call or email");
        Enrollment e = load(enrollmentId);
        return logRepository.findByEnrollmentIdOrderByIdDesc(e.getId()).stream().filter(l -> type.equals(l.getLogType()))
                .map(PayerWorkflowService::touch).toList();
    }

    // ------------------------------------------------------------------ helpers

    private Enrollment load(Long id) {
        return enrollmentService.load(id, authContext.orgId());
    }

    private Enrollment editable(Long id) {
        permissionService.require("enrollment", "update");
        authContext.requireStaff();
        return load(id);
    }

    private static int stepOf(Enrollment e) {
        return e.getWfStep() == null ? 0 : e.getWfStep();
    }

    private EnrollmentWorkflowLog log(Enrollment e, String type, String text) {
        EnrollmentWorkflowLog l = new EnrollmentWorkflowLog();
        l.setOrgId(e.getOrgId());
        l.setEnrollmentId(e.getId());
        l.setLogType(type);
        l.setText(text.length() > 2000 ? text.substring(0, 2000) : text);
        l.setCreatedBy(authContext.userId());
        String by = support.actorLabel();
        l.setCreatedByName(by == null ? null : by.length() > 120 ? by.substring(0, 120) : by);
        return logRepository.save(l);
    }

    private Map<String, Object> read(String s) {
        if (s == null || s.isBlank()) return new LinkedHashMap<>();
        try {
            return json.readValue(s, MAP);
        } catch (Exception ex) {
            return new LinkedHashMap<>();
        }
    }

    private String write(Map<String, Object> m) {
        try {
            return m.isEmpty() ? null : json.writeValueAsString(m);
        } catch (Exception ex) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Map<?, ?> m) {
        return new LinkedHashMap<>((Map<String, Object>) m);
    }

    /** "First Last" (the credentials / suffix are separate). */
    private static String plainName(Provider p) {
        return java.util.stream.Stream.of(p.getFirstName(), p.getLastName()).filter(x -> x != null && !x.isBlank()).reduce((a, b) -> a + " " + b).orElse("");
    }

    static String initials(String name) {
        if (name == null || name.isBlank()) return "?";
        String[] w = name.trim().split("\\s+");
        return (w.length == 1 ? w[0].substring(0, Math.min(2, w[0].length())) : "" + w[0].charAt(0) + w[1].charAt(0)).toUpperCase(Locale.ROOT);
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String str(Object o) {
        return o == null ? "" : o.toString();
    }

    private static String joinNonNull(String a, String b) {
        return java.util.stream.Stream.of(a, b).filter(x -> x != null && !x.isBlank()).reduce((x, y) -> x + " " + y).orElse(null);
    }

    private static String trim(String s, int max) {
        if (s == null || s.isBlank()) return null;
        String v = s.trim();
        return v.length() > max ? v.substring(0, max) : v;
    }
}
