package com.zmartcredential.service;

import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderDocumentRow;
import com.zmartcredential.dto.provider.ProviderDtos.ProviderDocProgress;
import com.zmartcredential.entity.AppUser;
import com.zmartcredential.entity.DocumentType;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.entity.ProviderDocument;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.AppUserRepository;
import com.zmartcredential.repository.DocumentTypeRepository;
import com.zmartcredential.repository.ProviderDocumentRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.AuthPrincipal;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Shared helpers of the providers module: tenant-safe provider loading and document checklist assembly. */
@Component
@RequiredArgsConstructor
public class ProviderModuleSupport {

    public static final Set<String> DOC_STATUSES = Set.of("approved", "missing", "expired", "pending_review", "na");

    private final ProviderRepository providerRepository;
    private final ProviderDocumentRepository documentRepository;
    private final DocumentTypeRepository documentTypeRepository;
    private final ProviderDocumentInitializer documentInitializer;
    private final AppUserRepository userRepository;
    private final AuthContext authContext;

    /** Staff-only load scoped to the effective org. */
    public Provider loadForStaff(Long id) {
        authContext.requireStaff();
        return providerRepository.findByIdAndOrgId(id, authContext.orgId())
                .orElseThrow(() -> NotFoundException.of("Provider", id));
    }

    /**
     * Load for staff (org-scoped) or for the provider user owning the record (works also for
     * self-signed-up providers that are not yet linked to an organization).
     */
    public Provider loadAccessible(Long id) {
        AuthPrincipal p = authContext.principal();
        if (p.isProvider()) {
            authContext.requireProviderAccess(id);
            return providerRepository.findById(id)
                    .filter(pr -> Objects.equals(pr.getOrgId(), p.orgId()))
                    .orElseThrow(() -> NotFoundException.of("Provider", id));
        }
        return providerRepository.findByIdAndOrgId(id, authContext.orgId())
                .orElseThrow(() -> NotFoundException.of("Provider", id));
    }

    public Map<String, DocumentType> docTypes() {
        Map<String, DocumentType> map = new LinkedHashMap<>();
        for (DocumentType t : documentTypeRepository.findAllByOrderBySortOrderAsc()) map.put(t.getCode(), t);
        return map;
    }

    /** Checklist rows of a provider (creates missing rows first, so all document types are present). */
    public List<ProviderDocumentRow> documentRows(Provider provider) {
        Map<String, DocumentType> types = docTypes();
        List<ProviderDocument> docs = documentRepository.findByProviderId(provider.getId());
        java.util.Set<String> have = docs.stream().map(ProviderDocument::getDocType).collect(java.util.stream.Collectors.toSet());
        // a type added since (the organization's own, or a new standard one) gets its row now
        if (types.values().stream().anyMatch(t -> t.visibleFor(provider.getOrgId()) && !have.contains(t.getCode()))) {
            documentInitializer.initialize(provider);
            docs = documentRepository.findByProviderId(provider.getId());
        }
        return toRows(docs, types);
    }

    public List<ProviderDocumentRow> toRows(Collection<ProviderDocument> docs, Map<String, DocumentType> types) {
        List<ProviderDocumentRow> rows = new ArrayList<>();
        for (ProviderDocument d : docs) {
            DocumentType t = types.get(d.getDocType());
            // a type switched off / deleted / of another organization: listed only while a file is stored
            if (t != null && !t.visibleFor(d.getOrgId()) && d.getStorageKey() == null) continue;
            rows.add(toRow(d, t));
        }
        rows.sort(Comparator.comparing(r -> r.sortOrder() == null ? 999 : r.sortOrder()));
        return rows;
    }

    /** approved / pending documents whose expiration date has passed are expired (the nightly job also saves it). */
    public static String effectiveStatus(ProviderDocument d) {
        if (d.getExpiresAt() != null && d.getExpiresAt().isBefore(LocalDate.now())
                && ("approved".equals(d.getStatus()) || "pending_review".equals(d.getStatus()))) {
            return "expired";
        }
        return d.getStatus();
    }

    public ProviderDocumentRow toRow(ProviderDocument d, DocumentType t) {
        Long days = d.getExpiresAt() == null ? null : ChronoUnit.DAYS.between(LocalDate.now(), d.getExpiresAt());
        return new ProviderDocumentRow(d.getId(), d.getProviderId(), d.getDocType(),
                t == null ? d.getDocType() : t.getLabel(),
                t != null && Boolean.TRUE.equals(t.getCritical()),
                t != null && Boolean.TRUE.equals(t.getExpires()),
                t == null ? null : t.getSortOrder(),
                effectiveStatus(d), d.getFileName(), d.getMimeType(), d.getSizeBytes(), d.getOriginalRelativePath(),
                d.getExpiresAt(), days, d.getUploadedAt(), d.getStorageKey() != null,
                d.getNotes(), d.getNotesUpdatedAt(), d.getNotesUpdatedBy());
    }

    public ProviderDocProgress progress(Collection<ProviderDocument> docs, Map<String, DocumentType> types) {
        int approved = 0;
        int required = 0;
        int missingCritical = 0;
        for (ProviderDocument d : docs) {
            if ("na".equals(d.getStatus())) continue;
            required++;
            if ("approved".equals(d.getStatus())) approved++;
            DocumentType t = types.get(d.getDocType());
            if (t != null && Boolean.TRUE.equals(t.getCritical())
                    && ("missing".equals(d.getStatus()) || "expired".equals(d.getStatus()))) {
                missingCritical++;
            }
        }
        return new ProviderDocProgress(approved, required, missingCritical);
    }

    public ProviderDocProgress progressFromRows(Collection<ProviderDocumentRow> rows) {
        int approved = 0;
        int required = 0;
        int missingCritical = 0;
        for (ProviderDocumentRow r : rows) {
            if ("na".equals(r.status())) continue;
            required++;
            if ("approved".equals(r.status())) approved++;
            if (r.critical() && ("missing".equals(r.status()) || "expired".equals(r.status()))) missingCritical++;
        }
        return new ProviderDocProgress(approved, required, missingCritical);
    }

    public static String fullName(Provider p) {
        return (p.getFirstName() + " " + p.getLastName()).trim();
    }

    public Map<Long, String> userNames(Collection<Long> ids) {
        List<Long> clean = ids.stream().filter(Objects::nonNull).distinct().toList();
        if (clean.isEmpty()) return new HashMap<>();
        return userRepository.findAllById(clean).stream()
                .collect(Collectors.toMap(AppUser::getId, AppUser::getDisplayName, (a, b) -> a));
    }

    public String userName(Long id) {
        if (id == null) return null;
        return userRepository.findById(id).map(AppUser::getDisplayName).orElse(null);
    }

    public static <T, K> Map<K, T> index(Collection<T> items, Function<T, K> key) {
        Map<K, T> map = new HashMap<>();
        for (T t : items) map.put(key.apply(t), t);
        return map;
    }

    public static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
