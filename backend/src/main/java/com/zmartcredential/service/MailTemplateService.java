package com.zmartcredential.service;

import com.zmartcredential.dto.email.MailTemplateDtos.MailTemplateItem;
import com.zmartcredential.dto.email.MailTemplateDtos.MailTemplateList;
import com.zmartcredential.dto.email.MailTemplateDtos.MailTemplateRequest;
import com.zmartcredential.dto.email.MailTemplateDtos.VariableInfo;
import com.zmartcredential.entity.EmailLog;
import com.zmartcredential.entity.EmailTemplate;
import com.zmartcredential.entity.Enrollment;
import com.zmartcredential.entity.OrgEmailTemplateChoice;
import com.zmartcredential.entity.Organization;
import com.zmartcredential.entity.Payer;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.ConflictException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.EmailLogRepository;
import com.zmartcredential.repository.EmailTemplateRepository;
import com.zmartcredential.repository.OrgEmailTemplateChoiceRepository;
import com.zmartcredential.repository.OrganizationRepository;
import com.zmartcredential.repository.PayerRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.Role;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Admin sidebar → Provider Link Templates (type provider_link: the Send Link email) and Enrollment Mail Templates
 * (type enrollment_approved: emailed to the provider when an enrollment is approved). Built-in templates
 * (org_id NULL) can be used but not changed; an organization adds, edits and deletes its own. "Use this template"
 * picks the one the emails are sent with until another is picked.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailTemplateService {

    public static final String PROVIDER_LINK = "provider_link";
    public static final String ENROLLMENT_APPROVED = "enrollment_approved";
    public static final String DOCUMENT_REQUEST = "document_request";
    /** Payer Submission → Email: the emails to the payers (all of an organization's templates are offered). */
    public static final String PAYER_COMMUNICATION = "payer_communication";
    public static final List<VariableInfo> PAYER_VARIABLES = List.of(
            new VariableInfo("provider_name", "Provider name", false),
            new VariableInfo("credentials", "Credentials (MD, DO…)", false),
            new VariableInfo("npi", "Individual NPI", false),
            new VariableInfo("specialty", "Specialty", false),
            new VariableInfo("caqh_id", "CAQH ID", false),
            new VariableInfo("group_npi", "Group NPI", false),
            new VariableInfo("tin", "TIN", false),
            new VariableInfo("practice", "Practice", false),
            new VariableInfo("address", "Practice address", false),
            new VariableInfo("payer_name", "Payer name", false),
            new VariableInfo("case_no", "Case #", false),
            new VariableInfo("reference_no", "Reference #", false),
            new VariableInfo("payer_provider_id", "Payer provider ID", false),
            new VariableInfo("submitted_date", "Submitted date", false),
            new VariableInfo("days_since_submit", "Days since submission", false),
            new VariableInfo("current_step", "Current workflow step", false),
            new VariableInfo("sender_name", "Your name", false),
            new VariableInfo("organization_name", "Organization name", false));

    private static final Map<String, List<VariableInfo>> VARIABLES = Map.of(
            PROVIDER_LINK, List.of(
                    new VariableInfo("provider_first_name", "Provider first name", false),
                    new VariableInfo("provider_name", "Provider full name", false),
                    new VariableInfo("upload_link", "Secure link", true),
                    new VariableInfo("pin", "Access PIN", true),
                    new VariableInfo("link_expires", "Link expiry date", false),
                    new VariableInfo("missing_document_list", "Documents still needed", false),
                    new VariableInfo("organization_name", "Organization name", false)),
            ENROLLMENT_APPROVED, List.of(
                    new VariableInfo("provider_name", "Provider name", false),
                    new VariableInfo("payer_name", "Payer name", false),
                    new VariableInfo("approved_date", "Approved date", false),
                    new VariableInfo("status", "Status", false),
                    new VariableInfo("organization_name", "Organization name", false)),
            DOCUMENT_REQUEST, List.of(
                    new VariableInfo("provider_first_name", "Provider first name", false),
                    new VariableInfo("provider_name", "Provider full name", false),
                    new VariableInfo("requested_document_list", "Requested documents", false),
                    new VariableInfo("upload_link", "Secure link", true),
                    new VariableInfo("pin", "Access PIN", true),
                    new VariableInfo("link_expires", "Link expiry date", false),
                    new VariableInfo("organization_name", "Organization name", false)),
            PAYER_COMMUNICATION, PAYER_VARIABLES);
    private static final Pattern VAR = Pattern.compile("\\{\\{\\s*([a-z_]+)\\s*}}");
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("MM/dd/yyyy");

    private final EmailTemplateRepository templateRepository;
    private final OrgEmailTemplateChoiceRepository choiceRepository;
    private final OrganizationRepository organizationRepository;
    private final ProviderRepository providerRepository;
    private final PayerRepository payerRepository;
    private final EmailLogRepository emailLogRepository;
    private final MailService mailService;
    private final NotificationService notificationService;
    private final AuthContext authContext;

    // ---------- admin screens ----------

    @Transactional(readOnly = true)
    public MailTemplateList list(String type) {
        requireType(type);
        authContext.requireRole(Role.ORG_ADMIN);
        Long orgId = authContext.orgId();
        Long inUse = resolve(orgId, type).map(EmailTemplate::getId).orElse(null);
        List<MailTemplateItem> items = visible(orgId, type).stream()
                .map(t -> toItem(t, Objects.equals(t.getId(), inUse)))
                .toList();
        return new MailTemplateList(type, items, VARIABLES.get(type));
    }

    @Transactional
    public MailTemplateItem create(MailTemplateRequest req) {
        authContext.requireRole(Role.ORG_ADMIN);
        Long orgId = authContext.orgId();
        validate(req, null, orgId);
        EmailTemplate t = new EmailTemplate();
        t.setOrgId(orgId);
        t.setType(req.type());
        apply(t, req);
        t = templateRepository.save(t);
        return toItem(t, false);
    }

    @Transactional
    public MailTemplateItem update(Long id, MailTemplateRequest req) {
        authContext.requireRole(Role.ORG_ADMIN);
        Long orgId = authContext.orgId();
        EmailTemplate t = visibleOne(id, orgId);
        if (!t.getType().equals(req.type())) throw new BadRequestException("The template type can't be changed");
        validate(req, id, orgId);
        boolean wasInUse = resolve(orgId, t.getType()).map(x -> x.getId().equals(id)).orElse(false);
        if (t.getOrgId() == null) {
            // editing a built-in template: the organization gets its own copy, which replaces the built-in for it
            EmailTemplate copy = new EmailTemplate();
            copy.setOrgId(orgId);
            copy.setType(t.getType());
            copy.setBaseTemplateId(t.getId());
            copy.setCode(t.getCode());
            apply(copy, req);
            t = templateRepository.save(copy);
            if (wasInUse) choose(orgId, t);
        } else {
            apply(t, req);
            templateRepository.save(t);
        }
        return toItem(t, wasInUse);
    }

    /** Deleting the template in use goes back to the built-in template. */
    @Transactional
    public void delete(Long id) {
        authContext.requireRole(Role.ORG_ADMIN);
        Long orgId = authContext.orgId();
        EmailTemplate t = visibleOne(id, orgId);
        choiceRepository.findByOrgIdAndType(orgId, t.getType()).filter(c -> c.getTemplateId().equals(id)).ifPresent(choiceRepository::delete);
        if (t.getOrgId() == null) {
            // a built-in template: hidden for this organization only (kept as a deleted copy)
            EmailTemplate hidden = new EmailTemplate();
            hidden.setOrgId(orgId);
            hidden.setType(t.getType());
            hidden.setBaseTemplateId(t.getId());
            hidden.setCode(t.getCode());
            hidden.setName(t.getName());
            hidden.setSubject(t.getSubject());
            hidden.setBody(t.getBody());
            hidden.setDeleted(true);
            templateRepository.save(hidden);
        } else {
            t.setDeleted(true);
            templateRepository.save(t);
        }
    }

    @Transactional
    public MailTemplateItem use(Long id) {
        authContext.requireRole(Role.ORG_ADMIN);
        Long orgId = authContext.orgId();
        EmailTemplate t = visibleOne(id, orgId);
        choose(orgId, t);
        return toItem(t, true);
    }

    private void choose(Long orgId, EmailTemplate t) {
        OrgEmailTemplateChoice c = choiceRepository.findByOrgIdAndType(orgId, t.getType()).orElseGet(() -> {
            OrgEmailTemplateChoice n = new OrgEmailTemplateChoice();
            n.setOrgId(orgId);
            n.setType(t.getType());
            return n;
        });
        c.setTemplateId(t.getId());
        choiceRepository.save(c);
    }

    /**
     * The organization's templates of a type: the built-in ones it hasn't edited or deleted, its edited copies
     * (in the built-in's place) and its own templates; deleted ones are left out.
     */
    public List<EmailTemplate> visible(Long orgId, String type) {
        List<EmailTemplate> all = templateRepository.findByOrgIdIsNullOrOrgId(orgId).stream()
                .filter(t -> type.equals(t.getType())).toList();
        java.util.Set<Long> replaced = all.stream().filter(t -> t.getOrgId() != null && t.getBaseTemplateId() != null)
                .map(EmailTemplate::getBaseTemplateId).collect(java.util.stream.Collectors.toSet());
        return all.stream()
                .filter(t -> !Boolean.TRUE.equals(t.getDeleted()))
                .filter(t -> t.getOrgId() != null || !replaced.contains(t.getId()))
                .sorted(Comparator.comparingLong((EmailTemplate t) -> t.getBaseTemplateId() != null ? t.getBaseTemplateId()
                        : t.getOrgId() == null ? t.getId() : Long.MAX_VALUE / 2 + t.getId()))
                .toList();
    }

    private EmailTemplate visibleOne(Long id, Long orgId) {
        EmailTemplate t = templateRepository.findById(id).orElseThrow(() -> NotFoundException.of("Template", id));
        requireType(t.getType());
        if (visible(orgId, t.getType()).stream().noneMatch(x -> x.getId().equals(id))) throw NotFoundException.of("Template", id);
        return t;
    }

    // ---------- sending ----------

    /** The template the organization uses for this type: its choice, else the first built-in one. */
    public java.util.Optional<EmailTemplate> resolve(Long orgId, String type) {
        List<EmailTemplate> visible = visible(orgId, type);
        if (orgId != null) {
            var chosen = choiceRepository.findByOrgIdAndType(orgId, type)
                    .flatMap(c -> visible.stream().filter(t -> t.getId().equals(c.getTemplateId())).findFirst());
            if (chosen.isPresent()) return chosen;
        }
        return visible.stream().findFirst();
    }

    public static String render(String text, Map<String, String> vars) {
        if (text == null) return "";
        Matcher m = VAR.matcher(text);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String v = vars.get(m.group(1));
            m.appendReplacement(out, Matcher.quoteReplacement(v == null ? m.group(0) : v));
        }
        m.appendTail(out);
        return out.toString();
    }

    /** Emails the provider that an enrollment was approved (Enrollment Mail Templates). Never throws. */
    public void sendEnrollmentApproved(Enrollment e) {
        try {
            Provider p = providerRepository.findById(e.getProviderId()).orElse(null);
            if (p == null) return;
            if (p.getEmail() == null || p.getEmail().isBlank()) {
                notificationService.notifyOrg(e.getOrgId(), "Approval email not sent",
                        "Enrollment approved, but " + (p.getFirstName() + " " + p.getLastName()).trim()
                                + " has no email address — add it in Edit Provider.", "MailX", NotificationService.WARN);
                return;
            }
            Payer payer = payerRepository.findById(e.getPayerId()).orElse(null);
            String org = organizationRepository.findById(e.getOrgId()).map(Organization::getName).orElse("");
            String name = ((p.getFirstName() == null ? "" : p.getFirstName()) + " " + (p.getLastName() == null ? "" : p.getLastName())).trim();
            Map<String, String> vars = new LinkedHashMap<>();
            vars.put("provider_name", name);
            vars.put("payer_name", payer == null ? "" : payer.getName());
            String approvedOn = (e.getEffectiveDate() == null ? java.time.LocalDate.now() : e.getEffectiveDate()).format(DATE);
            vars.put("approved_date", approvedOn);
            vars.put("effective_date", approvedOn); // older templates
            vars.put("status", "Approved");
            vars.put("organization_name", org);
            EmailTemplate t = resolve(e.getOrgId(), ENROLLMENT_APPROVED).orElse(null);
            String subject = t == null ? "Your " + vars.get("payer_name") + " enrollment is approved" : render(t.getSubject(), vars);
            String body = t == null
                    ? "Hi " + name + ",\n\nYour enrollment with " + vars.get("payer_name") + " has been approved (effective "
                      + vars.get("effective_date") + ").\n\n" + org
                    : render(t.getBody(), vars);
            MailService.Result r = mailService.send(p.getEmail(), subject, body);
            log(e.getOrgId(), p.getId(), p.getEmail(), subject, r.status());
            notificationService.notifyOrg(e.getOrgId(), "Approval email " + ("sent".equals(r.status()) ? "sent" : r.status()),
                    "Enrollment approval for " + name + " (" + vars.get("payer_name") + ") " + ("failed".equals(r.status()) ? "could not be emailed to " : "emailed to ")
                            + p.getEmail() + ".", "Mail", "failed".equals(r.status()) ? NotificationService.WARN : NotificationService.INFO);
        } catch (Exception ex) {
            log.warn("Enrollment approval email for enrollment {} failed: {}", e.getId(), ex.getMessage());
        }
    }

    public void log(Long orgId, Long providerId, String to, String subject, String status) {
        EmailLog l = new EmailLog();
        l.setOrgId(orgId);
        l.setProviderId(providerId);
        l.setToEmail(to);
        l.setSubject(subject.length() > 255 ? subject.substring(0, 255) : subject);
        l.setStatus(status);
        emailLogRepository.save(l);
    }

    // ---------- helpers ----------

    private void validate(MailTemplateRequest req, Long id, Long orgId) {
        requireType(req.type());
        String name = req.name().trim().replaceAll("\\s+", " ");
        boolean dup = visible(orgId, req.type()).stream()
                .anyMatch(t -> !t.getId().equals(id) && name.equalsIgnoreCase(t.getName()));
        if (dup) throw ConflictException.onField("name", "A template named \"" + name + "\" already exists");
        List<String> known = new ArrayList<>(VARIABLES.get(req.type()).stream().map(VariableInfo::key).toList());
        if (ENROLLMENT_APPROVED.equals(req.type())) known.add("effective_date"); // older templates keep working
        for (String text : List.of(req.subject(), req.body())) {
            Matcher m = VAR.matcher(text);
            while (m.find()) {
                if (!known.contains(m.group(1))) {
                    throw BadRequestException.onField(text == req.subject() ? "subject" : "body",
                            "Unknown placeholder {{" + m.group(1) + "}} — use one of the placeholders listed");
                }
            }
        }
        for (VariableInfo v : VARIABLES.get(req.type())) {
            if (v.required() && !req.body().contains("{{" + v.key() + "}}")) {
                throw BadRequestException.onField("body", "The message must include {{" + v.key() + "}} (" + v.label() + ")");
            }
        }
    }

    private static void apply(EmailTemplate t, MailTemplateRequest req) {
        t.setName(req.name().trim().replaceAll("\\s+", " "));
        t.setSubject(req.subject().trim());
        t.setBody(req.body().replace("\r\n", "\n").trim());
    }

    private static void requireType(String type) {
        if (!VARIABLES.containsKey(type)) throw new BadRequestException("Unknown template type");
    }

    private static MailTemplateItem toItem(EmailTemplate t, boolean inUse) {
        List<String> vars = new ArrayList<>();
        Matcher m = VAR.matcher((t.getSubject() == null ? "" : t.getSubject()) + " " + (t.getBody() == null ? "" : t.getBody()));
        while (m.find()) if (!vars.contains(m.group(1))) vars.add(m.group(1));
        return new MailTemplateItem(t.getId(), t.getType(), t.getName(), t.getSubject(), t.getBody(), t.getOrgId() == null, inUse, vars);
    }
}
