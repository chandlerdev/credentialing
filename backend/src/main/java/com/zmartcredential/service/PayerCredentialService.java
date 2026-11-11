package com.zmartcredential.service;

import com.zmartcredential.dto.enrollment.IntegrationDeferredResponse;
import com.zmartcredential.dto.payer.PayerCredentialMatrixResponse;
import com.zmartcredential.dto.payer.PayerCredentialRequest;
import com.zmartcredential.dto.payer.PayerCredentialResponse;
import com.zmartcredential.dto.payer.PayerCredentialRevealResponse;
import com.zmartcredential.entity.Payer;
import com.zmartcredential.entity.PayerCredential;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.ForbiddenException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.PayerCredentialRepository;
import com.zmartcredential.repository.PayerRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.AuthPrincipal;
import com.zmartcredential.security.PermissionService;
import com.zmartcredential.security.Role;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static com.zmartcredential.service.EnrollmentSupport.blankToNull;

/**
 * Payer portal logins (payer_credential). Passwords are AES-GCM encrypted server-side via CryptoService
 * and only returned by the audited reveal endpoint.
 */
@Service
@RequiredArgsConstructor
public class PayerCredentialService {

    private static final String ENTITY = "credential_vault";

    private final PayerCredentialRepository repository;
    private final OrgPayerAccess orgPayerAccess;
    private final PayerRepository payerRepository;
    private final ProviderRepository providerRepository;
    private final CryptoService cryptoService;
    private final EnrollmentSupport support;
    private final AuthContext authContext;
    private final PermissionService permissionService;

    // ---------------------------------------------------------------- org-level

    @Transactional(readOnly = true)
    public List<PayerCredentialResponse> listOrgLevel() {
        permissionService.require(ENTITY, "list");
        authContext.requireStaff();
        Map<Long, Payer> payers = support.payerMap();
        return repository.findByOrgIdAndProviderIdIsNull(authContext.orgId()).stream()
                .map(c -> toResponse(c, payers.get(c.getPayerId()))).toList();
    }

    @Transactional
    public PayerCredentialResponse saveOrgLevel(Long payerId, PayerCredentialRequest req) {
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        Payer payer = support.payer(payerId);
        // the Provider ID (with payer) is optional
        PayerCredential c = repository.findByOrgIdAndProviderIdIsNullAndPayerId(orgId, payerId).orElse(null);
        return save(c, orgId, null, payer, req);
    }

    @Transactional
    public void deleteOrgLevel(Long payerId) {
        permissionService.require(ENTITY, "delete");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        PayerCredential c = repository.findByOrgIdAndProviderIdIsNullAndPayerId(orgId, payerId)
                .orElseThrow(() -> new NotFoundException("No organization login saved for this payer"));
        repository.delete(c);
        support.audit(orgId, "payer_credential", c.getId(), "delete", "Deleted org-level portal login for payer " + payerId);
    }

    @Transactional(readOnly = true)
    public IntegrationDeferredResponse test(Long payerId) {
        permissionService.require(ENTITY, "read");
        authContext.requireStaff();
        support.payer(payerId);
        return IntegrationDeferredResponse.of("Portal connection testing will be available in a later phase.");
    }

    // ---------------------------------------------------------------- provider-level

    @Transactional(readOnly = true)
    public List<PayerCredentialResponse> listForProvider(Long providerId) {
        permissionService.require(ENTITY, "list");
        Long orgId = authContext.orgId();
        authContext.requireProviderAccess(providerId);
        support.provider(providerId, orgId);
        Map<Long, Payer> payers = support.payerMap();
        return repository.findByOrgIdAndProviderId(orgId, providerId).stream()
                .map(c -> toResponse(c, payers.get(c.getPayerId()))).toList();
    }

    @Transactional
    public PayerCredentialResponse saveForProvider(Long providerId, Long payerId, PayerCredentialRequest req) {
        Long orgId = authContext.orgId();
        authContext.requireProviderAccess(providerId);
        if (authContext.hasRole(Role.AUDITOR)) throw new ForbiddenException("Auditors have read-only access");
        support.provider(providerId, orgId);
        Payer payer = support.payer(payerId);
        // the Provider ID (with payer) is optional
        PayerCredential c = repository.findByOrgIdAndProviderIdAndPayerId(orgId, providerId, payerId).orElse(null);
        return save(c, orgId, providerId, payer, req);
    }

    @Transactional
    public void deleteForProvider(Long providerId, Long payerId) {
        permissionService.require(ENTITY, "delete");
        Long orgId = authContext.orgId();
        authContext.requireProviderAccess(providerId);
        PayerCredential c = repository.findByOrgIdAndProviderIdAndPayerId(orgId, providerId, payerId)
                .orElseThrow(() -> new NotFoundException("No login saved for this provider and payer"));
        repository.delete(c);
        support.audit(orgId, "payer_credential", c.getId(), "delete",
                "Deleted portal login of provider " + providerId + " for payer " + payerId);
    }

    @Transactional(readOnly = true)
    public PayerCredentialMatrixResponse matrix() {
        permissionService.require(ENTITY, "list");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        List<Payer> payers = orgPayerAccess.forOrg(payerRepository.findByActiveTrueOrderBySortOrderAsc(), orgId);
        List<PayerCredential> all = repository.findByOrgId(orgId);
        Map<Long, List<PayerCredential>> byProvider = all.stream().filter(c -> c.getProviderId() != null)
                .collect(Collectors.groupingBy(PayerCredential::getProviderId));
        List<PayerCredentialMatrixResponse.CredentialMeta> orgLevel = all.stream().filter(c -> c.getProviderId() == null)
                .map(PayerCredentialService::meta).toList();
        List<Provider> providers = providerRepository.findByOrgIdOrderByLastNameAsc(orgId);
        List<PayerCredentialMatrixResponse.ProviderRow> rows = providers.stream()
                .map(p -> new PayerCredentialMatrixResponse.ProviderRow(p.getId(), EnrollmentSupport.fullName(p), p.getNpi(),
                        byProvider.getOrDefault(p.getId(), List.of()).stream()
                                .sorted(Comparator.comparing(PayerCredential::getPayerId))
                                .map(PayerCredentialService::meta).toList()))
                .toList();
        int providerCount = (int) rows.stream().filter(r -> !r.credentials().isEmpty()).count();
        int credentialCount = (int) all.stream().filter(c -> c.getProviderId() != null).count();
        return new PayerCredentialMatrixResponse(
                payers.stream().map(p -> new PayerCredentialMatrixResponse.PayerRef(p.getId(), p.getCode(), p.getName(),
                        p.getColor(), p.getPortalUrl(), p.getApiSupport(), p.getCaqhParticipating())).toList(),
                orgLevel, rows, providerCount, credentialCount);
    }

    /** Returns the decrypted password. platform_admin / org_admin / clerk, or the owning provider. Audited. */
    @Transactional
    public PayerCredentialRevealResponse reveal(Long credentialId) {
        Long orgId = authContext.orgId();
        PayerCredential c = repository.findByIdAndOrgId(credentialId, orgId)
                .orElseThrow(() -> NotFoundException.of("Credential", credentialId));
        AuthPrincipal p = authContext.principal();
        boolean staffAllowed = authContext.hasRole(Role.PLATFORM_ADMIN, Role.ORG_ADMIN, Role.CLERK);
        boolean owner = p.isProvider() && c.getProviderId() != null && c.getProviderId().equals(p.providerId());
        if (!staffAllowed && !owner) throw new ForbiddenException("You are not allowed to reveal this password");
        String password = c.getPasswordEnc() == null ? null : cryptoService.decrypt(c.getPasswordEnc());
        support.audit(orgId, "payer_credential", c.getId(), "reveal",
                "Revealed portal password (payer " + c.getPayerId()
                        + (c.getProviderId() == null ? ", org-level" : ", provider " + c.getProviderId()) + ")");
        String portalUrl = c.getPortalUrl() != null && !c.getPortalUrl().isBlank() ? c.getPortalUrl()
                : payerRepository.findById(c.getPayerId()).map(Payer::getPortalUrl).orElse(null);
        return new PayerCredentialRevealResponse(c.getId(), c.getProviderId(), c.getPayerId(), c.getUsername(), password,
                portalUrl, c.getPayerProviderId(), c.getGroupTin());
    }

    // ---------------------------------------------------------------- helpers

    private PayerCredentialResponse save(PayerCredential c, Long orgId, Long providerId, Payer payer, PayerCredentialRequest req) {
        boolean creating = c == null;
        permissionService.require(ENTITY, creating ? "create" : "update");
        String password = req.password() == null || req.password().isEmpty() ? null : req.password();
        if (creating && password == null) throw new BadRequestException("Password is required");
        if (creating) {
            c = new PayerCredential();
            c.setOrgId(orgId);
            c.setProviderId(providerId);
            c.setPayerId(payer.getId());
        }
        c.setUsername(req.username().trim());
        if (password != null) c.setPasswordEnc(cryptoService.encrypt(password));
        c.setPortalUrl(blankToNull(req.portalUrl()));
        c.setPayerProviderId(blankToNull(req.payerProviderId()));
        c.setGroupTin(blankToNull(req.groupTin()));
        c.setNotes(blankToNull(req.notes()));
        if (providerId == null) c.setAssignedProviderIds(assignedProviders(orgId, req.providerIds()));
        c.setUpdatedBy(authContext.userId());
        c = repository.save(c);
        support.audit(orgId, "payer_credential", c.getId(), creating ? "create" : "update",
                (creating ? "Saved " : "Updated ") + payer.getName() + " portal login"
                        + (providerId == null ? " (org-level, " + c.getAssignedProviderIds().size() + " provider(s))" : " for provider " + providerId));
        return toResponse(c, payer);
    }

    /** The providers an organization login is assigned to: at least one, all from this organization. */
    private java.util.Set<Long> assignedProviders(Long orgId, List<Long> ids) {
        if (ids == null || ids.isEmpty()) throw new BadRequestException("Choose at least one provider who uses this login");
        java.util.Set<Long> wanted = new java.util.LinkedHashSet<>(ids);
        java.util.Set<Long> found = providerRepository.findAllById(wanted).stream()
                .filter(p -> orgId.equals(p.getOrgId())).map(Provider::getId).collect(Collectors.toSet());
        if (found.size() != wanted.size()) throw new BadRequestException("One or more of the chosen providers were not found");
        return new java.util.HashSet<>(found);
    }

    private static List<Long> sortedIds(PayerCredential c) {
        return c.getProviderId() != null ? List.of() : c.getAssignedProviderIds().stream().sorted().toList();
    }

    private static PayerCredentialMatrixResponse.CredentialMeta meta(PayerCredential c) {
        return new PayerCredentialMatrixResponse.CredentialMeta(c.getId(), c.getPayerId(), c.getUsername(),
                c.getPasswordEnc() != null, c.getUpdatedAt(), sortedIds(c));
    }

    private static PayerCredentialResponse toResponse(PayerCredential c, Payer payer) {
        return new PayerCredentialResponse(c.getId(), c.getProviderId(), c.getPayerId(),
                payer == null ? null : payer.getName(), payer == null ? null : payer.getColor(),
                c.getUsername(), c.getPortalUrl(), c.getPayerProviderId(), c.getGroupTin(), c.getNotes(),
                c.getPasswordEnc() != null, sortedIds(c), c.getLastTestAt(), c.getLastTestOk(), c.getUpdatedBy(),
                c.getCreatedAt(), c.getUpdatedAt());
    }
}
