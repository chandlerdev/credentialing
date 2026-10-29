package com.zmartcredential.service;

import com.zmartcredential.dto.payer.PayerFormResponse;
import com.zmartcredential.dto.payer.PayerOverviewItem;
import com.zmartcredential.dto.payer.PayerRequest;
import com.zmartcredential.dto.payer.PayerResponse;
import com.zmartcredential.entity.Enrollment;
import com.zmartcredential.entity.Payer;
import com.zmartcredential.entity.PayerCredential;
import com.zmartcredential.entity.PayerForm;
import com.zmartcredential.exception.ConflictException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.EnrollmentRepository;
import com.zmartcredential.repository.PayerCredentialRepository;
import com.zmartcredential.repository.PayerFormRepository;
import com.zmartcredential.repository.PayerRepository;
import com.zmartcredential.repository.PayerSubmissionRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.PermissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static com.zmartcredential.service.EnrollmentSupport.blankToNull;

/** Global payer catalog (payer + payer_form) and per-org payer statistics. */
@Service
@RequiredArgsConstructor
public class PayerService {

    private final PayerRepository payerRepository;
    private final PayerFormRepository formRepository;
    private final EnrollmentRepository enrollmentRepository;
    private final PayerSubmissionRepository submissionRepository;
    private final PayerCredentialRepository credentialRepository;
    private final PermissionService permissionService;
    private final AuthContext authContext;
    private final OrgPayerAccess orgPayerAccess;
    private final com.zmartcredential.repository.OrgPayerSettingRepository orgPayerSettingRepository;
    private final SoftDeleteCascade softDeleteCascade;
    private final CryptoService cryptoService;

    @Transactional(readOnly = true)
    public List<PayerResponse> list(boolean activeOnly) {
        return list(activeOnly, null);
    }

    /** scope "enrollment" (New Enrollment): every payer the super admin added plus the organization's own payers. */
    @Transactional(readOnly = true)
    public List<PayerResponse> list(boolean activeOnly, String scope) {
        permissionService.require("payer", "list");
        List<Payer> source = activeOnly ? payerRepository.findByActiveTrueOrderBySortOrderAsc()
                : payerRepository.findAllByOrderBySortOrderAsc();
        List<Payer> payers;
        if ("enrollment".equals(scope) && !authContext.principal().isPlatformAdmin()) {
            Long orgId = authContext.orgId();
            Map<Long, Boolean> settings = orgPayerAccess.settings(orgId);
            payers = source.stream().filter(p -> p.getAddedByOrgId() == null || OrgPayerAccess.enabled(p, orgId, settings)).toList();
        } else {
            payers = orgPayerAccess.visible(source);
        }
        Map<Long, List<PayerForm>> forms = formsByPayer();
        return payers.stream().map(p -> EnrollmentSupport.toPayerResponse(p, forms.get(p.getId()))).toList();
    }

    @Transactional(readOnly = true)
    public PayerResponse get(Long id) {
        permissionService.require("payer", "read");
        Payer p = load(id);
        return EnrollmentSupport.toPayerResponse(p, formRepository.findByPayerIdOrderBySortOrderAsc(id));
    }

    @Transactional(readOnly = true)
    public List<PayerFormResponse> forms(Long payerId) {
        permissionService.require("payer", "read");
        load(payerId);
        return formRepository.findByPayerIdOrderBySortOrderAsc(payerId).stream().map(EnrollmentSupport::toFormResponse).toList();
    }

    @Transactional
    public PayerResponse create(PayerRequest req) {
        permissionService.require("payer", "create");
        String code = req.code().trim();
        if (payerRepository.findByCode(code).isPresent()) {
            throw new ConflictException("A payer with code '" + code + "' already exists");
        }
        Payer p = new Payer();
        apply(p, req);
        p = payerRepository.save(p);
        return EnrollmentSupport.toPayerResponse(p, List.of());
    }

    @Transactional
    public PayerResponse update(Long id, PayerRequest req) {
        permissionService.require("payer", "update");
        Payer p = load(id);
        String code = req.code().trim();
        payerRepository.findByCode(code).filter(other -> !other.getId().equals(id)).ifPresent(other -> {
            throw new ConflictException("A payer with code '" + code + "' already exists");
        });
        apply(p, req);
        p = payerRepository.save(p);
        return EnrollmentSupport.toPayerResponse(p, formRepository.findByPayerIdOrderBySortOrderAsc(id));
    }

    @Transactional
    public void delete(Long id) {
        permissionService.require("payer", "delete");
        Payer p = load(id);
        if (enrollmentRepository.existsByPayerId(id) || submissionRepository.existsByPayerId(id)) {
            throw new ConflictException(p.getName() + " is referenced by enrollments or submissions. Deactivate it instead.");
        }
        softDeleteCascade.payer(p.getId());
        p.setDelToken(p.getId());
        payerRepository.saveAndFlush(p);
        payerRepository.delete(p);
    }

    /** Per-payer stats for the current organization (PayersView cards). */
    @Transactional(readOnly = true)
    public List<PayerOverviewItem> overview(boolean activeOnly) {
        permissionService.require("payer", "list");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        List<Payer> payers = orgPayerAccess.forOrg(activeOnly ? payerRepository.findByActiveTrueOrderBySortOrderAsc()
                : payerRepository.findAllByOrderBySortOrderAsc(), orgId);
        Map<Long, List<PayerForm>> forms = formsByPayer();
        Map<Long, List<Enrollment>> byPayer = enrollmentRepository.findByOrgId(orgId).stream()
                .collect(Collectors.groupingBy(Enrollment::getPayerId));
        Set<Long> orgCreds = credentialRepository.findByOrgIdAndProviderIdIsNull(orgId).stream()
                .map(PayerCredential::getPayerId).collect(Collectors.toSet());

        return payers.stream().map(p -> {
            List<Enrollment> list = byPayer.getOrDefault(p.getId(), List.of());
            long enrolled = list.stream().filter(e -> "approved".equals(e.getStatus()))
                    .map(Enrollment::getProviderId).distinct().count();
            long inProgress = list.stream()
                    .filter(e -> "in_progress".equals(e.getStatus()) || "submitted".equals(e.getStatus())).count();
            List<Integer> tats = list.stream().map(e -> EnrollmentSupport.tat(e.getSubmittedDate(), e.getEffectiveDate()))
                    .filter(Objects::nonNull).toList();
            Integer avg = tats.isEmpty() ? p.getAvgTatDays()
                    : Integer.valueOf((int) Math.round(tats.stream().mapToInt(Integer::intValue).average().orElse(0)));
            return new PayerOverviewItem(EnrollmentSupport.toPayerResponse(p, forms.get(p.getId())),
                    enrolled, inProgress, avg, !tats.isEmpty(), orgCreds.contains(p.getId()));
        }).toList();
    }

    private Map<Long, List<PayerForm>> formsByPayer() {
        return formRepository.findAll().stream()
                .sorted(Comparator.comparing(PayerForm::getSortOrder, Comparator.nullsLast(Comparator.naturalOrder())))
                .collect(Collectors.groupingBy(PayerForm::getPayerId));
    }

    private Payer load(Long id) {
        return payerRepository.findById(id).orElseThrow(() -> NotFoundException.of("Payer", id));
    }

    // ---------- super admin → Payers ----------

    private static final String[] CARD_COLORS = {"#1d4ed8", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#0369a1", "#15803d", "#c2410c"};

    /** Every payer (newest first), for the super admin's Payers page. */
    @Transactional(readOnly = true)
    public List<PayerResponse> platformList() {
        authContext.requireRole(com.zmartcredential.security.Role.PLATFORM_ADMIN);
        return payerRepository.findAll().stream()
                .sorted(java.util.Comparator.comparing(Payer::getName, String.CASE_INSENSITIVE_ORDER))
                .map(p -> EnrollmentSupport.toPayerResponse(p, List.of())).toList();
    }

    /** Adds (id null) or updates a payer from the super admin's popup. */
    @Transactional
    public PayerResponse platformSave(Long id, com.zmartcredential.dto.payer.PlatformPayerRequest r) {
        authContext.requireRole(com.zmartcredential.security.Role.PLATFORM_ADMIN);
        return savePayer(id, r, null, r.portalAvailable());
    }

    /** Result of an organization admin's Add Payer: created, or the payer exists but is off for the organization. */
    public record OrgPayerAddResult(String status, Long payerId, String name) {
    }

    /**
     * Payers → Add Payer (organization admin). Duplicates are checked against every payer by name and portal login
     * URL: one already on for the organization is refused; one that exists but is off is reported
     * ("exists_disabled") so the admin can enable it. A new payer is on for this organization only.
     */
    @Transactional
    public OrgPayerAddResult orgAdd(com.zmartcredential.dto.payer.PlatformPayerRequest r) {
        authContext.requireRole(com.zmartcredential.security.Role.ORG_ADMIN);
        Long orgId = authContext.orgId();
        String name = norm(r.name());
        String url = Boolean.TRUE.equals(r.portalAvailable()) ? normUrl(r.portalUrl()) : "";
        Map<Long, Boolean> settings = orgPayerAccess.settings(orgId);
        for (Payer o : payerRepository.findAll()) {
            boolean sameName = !name.isEmpty() && name.equals(norm(o.getName()));
            boolean sameUrl = !url.isEmpty() && url.equals(normUrl(o.getPortalUrl()));
            if (!sameName && !sameUrl) continue;
            if (Boolean.TRUE.equals(o.getActive()) && !OrgPayerAccess.enabled(o, orgId, settings)) {
                return new OrgPayerAddResult("exists_disabled", o.getId(), o.getName());
            }
            String where = Boolean.TRUE.equals(o.getActive()) ? " is already in your payers list" : " already exists (inactive)";
            throw com.zmartcredential.exception.ConflictException.onField(sameName ? "name" : "portalUrl", sameName
                    ? "\"" + o.getName() + "\"" + where
                    : "This portal login URL belongs to \"" + o.getName() + "\", which" + where);
        }
        PayerResponse created = savePayer(null, r, orgId, r.portalAvailable());
        return new OrgPayerAddResult("created", created.id(), created.name());
    }

    /** "The payer already exists — enable it?" → Yes: switches the payer on for the admin's organization. */
    @Transactional
    public void orgEnable(Long payerId) {
        authContext.requireRole(com.zmartcredential.security.Role.ORG_ADMIN);
        Long orgId = authContext.orgId();
        Payer p = load(payerId);
        var setting = orgPayerSettingRepository.findByOrgIdAndPayerId(orgId, payerId).orElseGet(() -> {
            var s = new com.zmartcredential.entity.OrgPayerSetting();
            s.setOrgId(orgId);
            s.setPayerId(p.getId());
            return s;
        });
        setting.setEnabled(true);
        orgPayerSettingRepository.save(setting);
    }

    private static String norm(String v) {
        return v == null ? "" : v.trim().replaceAll("\\s+", " ").toLowerCase(java.util.Locale.ROOT);
    }

    /** Portal URLs compare without http/https, "www.", case and a trailing slash. */
    private static String normUrl(String v) {
        if (v == null) return "";
        return v.trim().toLowerCase(java.util.Locale.ROOT).replaceFirst("^https?://", "").replaceFirst("^www\\.", "").replaceAll("/+$", "");
    }

    private PayerResponse savePayer(Long id, com.zmartcredential.dto.payer.PlatformPayerRequest r, Long addedByOrgId, Boolean portalAvailable) {
        String name = r.name().trim().replaceAll("\\s+", " ");
        payerRepository.findAll().stream()
                .filter(o -> o.getName() != null && o.getName().equalsIgnoreCase(name) && !o.getId().equals(id))
                .findFirst().ifPresent(o -> {
                    throw com.zmartcredential.exception.ConflictException.onField("name", "A payer named \"" + name + "\" already exists");
                });
        Payer p = id == null ? new Payer() : load(id);
        if (id == null) {
            p.setCode(uniqueCode(name));
            p.setColor(CARD_COLORS[Math.floorMod(name.toLowerCase().hashCode(), CARD_COLORS.length)]);
        }
        p.setName(name);
        p.setFullName(r.fullName().trim());
        p.setCategory(r.category().trim());
        p.setAvgTatDays(r.avgTatDays());
        // optional; the integration column always has a value (portal when none is chosen)
        p.setIntegration(r.integration() == null || r.integration().isBlank() ? "portal" : r.integration());
        p.setAppForm(r.appForm() == null || r.appForm().isBlank() ? null : r.appForm().trim());
        boolean portal = Boolean.TRUE.equals(portalAvailable);
        String portalUrl = r.portalUrl() == null || r.portalUrl().isBlank() ? null : r.portalUrl().trim();
        if (portal && portalUrl == null) {
            throw com.zmartcredential.exception.BadRequestException.onField("portalUrl", "Portal login URL is required when a portal is available");
        }
        p.setPortalAvailable(portal);
        // the portal login URL is kept only for payers with a portal
        p.setPortalUrl(portal ? portalUrl : null);
        // API access: key and token required (kept when left blank on edit), encrypted
        boolean api = Boolean.TRUE.equals(r.apiAccess());
        if (api) {
            String key = r.apiKey() == null ? "" : r.apiKey().trim();
            String token = r.apiToken() == null ? "" : r.apiToken().trim();
            if (key.isEmpty() && p.getApiKeyEnc() == null) throw com.zmartcredential.exception.BadRequestException.onField("apiKey", "API key is required");
            if (token.isEmpty() && p.getApiTokenEnc() == null) throw com.zmartcredential.exception.BadRequestException.onField("apiToken", "API token is required");
            if (!key.isEmpty()) p.setApiKeyEnc(cryptoService.encrypt(key));
            if (!token.isEmpty()) p.setApiTokenEnc(cryptoService.encrypt(token));
        } else {
            p.setApiKeyEnc(null);
            p.setApiTokenEnc(null);
        }
        p.setApiAvailable(api);
        p.setCaqhUpdate(r.caqhUpdate() == null || r.caqhUpdate().isBlank() ? null : r.caqhUpdate().trim());
        p.setSupportEmail(r.supportEmail() == null || r.supportEmail().isBlank() ? null : r.supportEmail().trim());
        p.setSupportPhone(r.supportPhone() == null || r.supportPhone().isBlank() ? null : r.supportPhone().trim());
        if (id == null) p.setAddedByOrgId(addedByOrgId);
        p.setLogo(r.logo() == null || r.logo().isBlank() ? null : r.logo());
        p = payerRepository.save(p);
        return EnrollmentSupport.toPayerResponse(p, id == null ? List.of() : formRepository.findByPayerIdOrderBySortOrderAsc(p.getId()));
    }

    /** Super admin → Organizations → Payers: every active payer with whether it is on for this organization. */
    @Transactional(readOnly = true)
    public List<OrgPayerItem> orgPayers(Long orgId) {
        authContext.requireRole(com.zmartcredential.security.Role.PLATFORM_ADMIN);
        return orgPayerItems(orgId);
    }

    /** Admin → Payers → All Payers: every payer with whether it is on for the admin's organization. */
    @Transactional(readOnly = true)
    public List<OrgPayerItem> myOrgPayers() {
        authContext.requireRole(com.zmartcredential.security.Role.ORG_ADMIN);
        return orgPayerItems(authContext.orgId());
    }

    /** Admin → Payers → All Payers: switch a payer on / off for the admin's organization (the super admin sees it too). */
    @Transactional
    public OrgPayerItem setMyOrgPayer(Long payerId, boolean enabled) {
        authContext.requireRole(com.zmartcredential.security.Role.ORG_ADMIN);
        return saveOrgSetting(authContext.orgId(), payerId, enabled);
    }

    private List<OrgPayerItem> orgPayerItems(Long orgId) {
        Map<Long, Boolean> settings = orgPayerAccess.settings(orgId);
        return payerRepository.findByActiveTrueOrderBySortOrderAsc().stream()
                .sorted(java.util.Comparator.comparing(Payer::getName, String.CASE_INSENSITIVE_ORDER))
                .map(p -> new OrgPayerItem(p.getId(), p.getName(), p.getFullName(), p.getCategory(), p.getColor(), p.getLogo(),
                        p.getIntegration(), OrgPayerAccess.enabled(p, orgId, settings)))
                .toList();
    }

    @Transactional
    public OrgPayerItem setOrgPayer(Long orgId, Long payerId, boolean enabled) {
        authContext.requireRole(com.zmartcredential.security.Role.PLATFORM_ADMIN);
        return saveOrgSetting(orgId, payerId, enabled);
    }

    private OrgPayerItem saveOrgSetting(Long orgId, Long payerId, boolean enabled) {
        Payer p = load(payerId);
        var setting = orgPayerSettingRepository.findByOrgIdAndPayerId(orgId, payerId).orElseGet(() -> {
            var s = new com.zmartcredential.entity.OrgPayerSetting();
            s.setOrgId(orgId);
            s.setPayerId(payerId);
            return s;
        });
        setting.setEnabled(enabled);
        orgPayerSettingRepository.save(setting);
        return new OrgPayerItem(p.getId(), p.getName(), p.getFullName(), p.getCategory(), p.getColor(), p.getLogo(), p.getIntegration(), enabled);
    }

    public record OrgPayerItem(Long id, String name, String fullName, String category, String color, String logo,
                               String integration, boolean enabled) {
    }

    /** "BCBS TX" → "bcbs_tx" (made unique). */
    private String uniqueCode(String name) {
        String base = name.toLowerCase().replaceAll("[^a-z0-9]+", "_").replaceAll("^_+|_+$", "");
        if (base.isEmpty()) base = "payer";
        if (base.length() > 34) base = base.substring(0, 34);
        String code = base;
        for (int n = 2; payerRepository.findByCode(code).isPresent(); n++) code = base + "_" + n;
        return code;
    }

    private static void apply(Payer p, PayerRequest r) {
        p.setCode(r.code().trim());
        p.setName(r.name().trim());
        p.setFullName(blankToNull(r.fullName()));
        p.setCategory(r.category().trim());
        p.setPayerType(blankToNull(r.payerType()));
        if (r.color() != null) p.setColor(r.color());
        p.setAppForm(blankToNull(r.appForm()));
        if (r.integration() != null) p.setIntegration(r.integration());
        if (r.apiSupport() != null) p.setApiSupport(r.apiSupport());
        p.setCaqhParticipating(Boolean.TRUE.equals(r.caqhParticipating()));
        p.setPortalUrl(blankToNull(r.portalUrl()));
        p.setAvgTatDays(r.avgTatDays());
        p.setPricingCategory(blankToNull(r.pricingCategory()));
        p.setPricingMult(r.pricingMult() == null ? new BigDecimal("1.00") : r.pricingMult());
        p.setRecredCycleMonths(r.recredCycleMonths() == null ? 24 : r.recredCycleMonths());
        if (r.sortOrder() != null) p.setSortOrder(r.sortOrder());
        p.setActive(r.active() == null || r.active());
    }
}
