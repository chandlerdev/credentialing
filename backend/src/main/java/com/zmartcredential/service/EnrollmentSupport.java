package com.zmartcredential.service;

import com.zmartcredential.dto.payer.PayerFormResponse;
import com.zmartcredential.dto.payer.PayerResponse;
import com.zmartcredential.entity.AppUser;
import com.zmartcredential.entity.AuditLog;
import com.zmartcredential.entity.EnrollmentEvent;
import com.zmartcredential.entity.Payer;
import com.zmartcredential.entity.PayerForm;
import com.zmartcredential.entity.Practice;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.AppUserRepository;
import com.zmartcredential.repository.AuditLogRepository;
import com.zmartcredential.repository.EnrollmentEventRepository;
import com.zmartcredential.repository.PayerRepository;
import com.zmartcredential.repository.PracticeRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.AuthPrincipal;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Shared lookups and helpers for the enrollments module services. */
@Component
@RequiredArgsConstructor
public class EnrollmentSupport {

    public static final List<String> STATUSES = List.of(
            "draft", "in_progress", "submitted", "approved", "needs_attention", "on_hold", "terminated");
    public static final Set<String> APPLICATION_TYPES = Set.of("initial", "recred", "update", "terminate");

    private final ProviderRepository providerRepository;
    private final PayerRepository payerRepository;
    private final PracticeRepository practiceRepository;
    private final AppUserRepository userRepository;
    private final EnrollmentEventRepository eventRepository;
    private final AuditLogRepository auditLogRepository;
    private final AuthContext authContext;

    public Provider provider(Long providerId, Long orgId) {
        if (providerId == null) throw new NotFoundException("Provider not found");
        return providerRepository.findByIdAndOrgId(providerId, orgId)
                .orElseThrow(() -> NotFoundException.of("Provider", providerId));
    }

    public Payer payer(Long payerId) {
        if (payerId == null) throw new NotFoundException("Payer not found");
        return payerRepository.findById(payerId).orElseThrow(() -> NotFoundException.of("Payer", payerId));
    }

    public Map<Long, Payer> payerMap() {
        return payerRepository.findAll().stream().collect(Collectors.toMap(Payer::getId, Function.identity()));
    }

    public Map<Long, Provider> providerMap(Long orgId) {
        return providerRepository.findByOrgId(orgId).stream().collect(Collectors.toMap(Provider::getId, Function.identity()));
    }

    public Map<Long, String> practiceNames(Long orgId) {
        return practiceRepository.findByOrgId(orgId).stream().collect(Collectors.toMap(Practice::getId, Practice::getName));
    }

    public Map<Long, String> userNames(Long orgId) {
        Map<Long, String> names = new HashMap<>();
        for (AppUser u : userRepository.findByOrgId(orgId)) names.put(u.getId(), userName(u));
        return names;
    }

    public String userName(Long userId) {
        if (userId == null) return null;
        return userRepository.findById(userId).map(EnrollmentSupport::userName).orElse(null);
    }

    public static String userName(AppUser u) {
        if (u.getDisplayName() != null && !u.getDisplayName().isBlank()) return u.getDisplayName();
        String n = ((u.getFirstName() == null ? "" : u.getFirstName()) + " " + (u.getLastName() == null ? "" : u.getLastName())).trim();
        return n.isEmpty() ? u.getUsername() : n;
    }

    public static String fullName(Provider p) {
        if (p == null) return null;
        StringBuilder sb = new StringBuilder();
        if (p.getFirstName() != null) sb.append(p.getFirstName());
        if (p.getLastName() != null) sb.append(sb.isEmpty() ? "" : " ").append(p.getLastName());
        if (p.getSuffix() != null && !p.getSuffix().isBlank()) sb.append(", ").append(p.getSuffix());
        return sb.toString();
    }

    /** Turnaround in days when both dates are set (never negative), otherwise null. */
    public static Integer tat(LocalDate submitted, LocalDate effective) {
        if (submitted == null || effective == null) return null;
        return (int) Math.max(0, ChronoUnit.DAYS.between(submitted, effective));
    }

    public static String statusLabel(String status) {
        if (status == null) return "";
        String s = status.replace('_', ' ');
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    public String actorLabel() {
        AuthPrincipal p = authContext.principal();
        if (p.displayName() != null && !p.displayName().isBlank()) return p.displayName();
        return p.username();
    }

    public EnrollmentEvent addEvent(Long enrollmentId, String type, String note, String confirmationNumber) {
        EnrollmentEvent ev = new EnrollmentEvent();
        ev.setEnrollmentId(enrollmentId);
        ev.setEventType(type);
        ev.setOccurredAt(LocalDateTime.now());
        ev.setActorUserId(authContext.userId());
        ev.setActorLabel(truncate(actorLabel(), 100));
        ev.setNote(note);
        ev.setConfirmationNumber(confirmationNumber);
        return eventRepository.save(ev);
    }

    public void audit(Long orgId, String entity, Long entityId, String action, String summary) {
        AuditLog log = new AuditLog();
        log.setOrgId(orgId);
        log.setUserId(authContext.userId());
        log.setEntity(entity);
        log.setEntityId(entityId);
        log.setAction(action);
        log.setSummary(truncate(summary, 500));
        auditLogRepository.save(log);
    }

    public static PayerResponse toPayerResponse(Payer p, List<PayerForm> forms) {
        return new PayerResponse(p.getId(), p.getCode(), p.getName(), p.getFullName(), p.getCategory(), p.getPayerType(),
                p.getColor(), p.getAppForm(), p.getIntegration(), p.getApiSupport(), p.getSubmissionMethod(),
                p.getApiAvailable(), p.getApiVendor(), p.getApiDocsUrl(), p.getSubmissionNotes(), p.getCaqhParticipating(),
                p.getPortalUrl(), p.getAvgTatDays(), p.getPricingCategory(), p.getPricingMult(), p.getRecredCycleMonths(),
                p.getSortOrder(), p.getActive(),
                forms == null ? List.of() : forms.stream().map(EnrollmentSupport::toFormResponse).toList(),
                p.getCreatedAt(), p.getUpdatedAt(), p.getLogo(), !Boolean.FALSE.equals(p.getPortalAvailable()),
                p.getApiKeyEnc() != null, p.getApiTokenEnc() != null, p.getCaqhUpdate(), p.getSupportEmail(), p.getSupportPhone());
    }

    public static PayerFormResponse toFormResponse(PayerForm f) {
        return new PayerFormResponse(f.getId(), f.getPayerId(), f.getCode(), f.getLabel(), f.getDescription(), f.getSortOrder());
    }

    /**
     * Prototype v3 PRIVATE_PAYERS: payers whose provider portal / CAQH access is managed per provider (commercial plans,
     * MCOs, Medicare Advantage, behavioral health). Excludes Medicare (PECOS), state Medicaid and TRICARE / VA.
     */
    public static final Set<String> PRIVATE_PAYER_CATEGORIES = Set.of(
            "Commercial", "Commercial (HMO)", "Medicaid MCO", "Medicare Advantage", "Behavioral Health");

    public static boolean isPrivatePayer(Payer p) {
        return p != null && p.getCategory() != null && PRIVATE_PAYER_CATEGORIES.contains(p.getCategory());
    }

    public static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    public static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
