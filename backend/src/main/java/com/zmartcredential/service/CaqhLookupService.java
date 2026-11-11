package com.zmartcredential.service;

import com.zmartcredential.dto.caqh.CaqhLookupDtos.CaqhDocument;
import com.zmartcredential.dto.caqh.CaqhLookupDtos.CaqhEducation;
import com.zmartcredential.dto.caqh.CaqhLookupDtos.CaqhImportRequest;
import com.zmartcredential.dto.caqh.CaqhLookupDtos.CaqhImportResponse;
import com.zmartcredential.dto.caqh.CaqhLookupDtos.CaqhLookupConfigRequest;
import com.zmartcredential.dto.caqh.CaqhLookupDtos.CaqhLookupConfigResponse;
import com.zmartcredential.dto.caqh.CaqhLookupDtos.CaqhLookupTestResponse;
import com.zmartcredential.dto.caqh.CaqhLookupDtos.CaqhProfile;
import com.zmartcredential.entity.CaqhConfig;
import com.zmartcredential.entity.DocumentType;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.ConflictException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.CaqhConfigRepository;
import com.zmartcredential.repository.ProviderDocumentRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.PermissionService;
import com.zmartcredential.security.Role;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * "Import from CAQH" (prototype v2): looks a provider up by CAQH ID — in mock mode from the built-in demo
 * profiles, in real mode from {@code GET {apiUrl}/providers/{caqhId}} — and creates the provider with the
 * credential documents CAQH reports as verified.
 */
@Service
@RequiredArgsConstructor
public class CaqhLookupService {

    private static final JsonMapper JSON = JsonMapper.builder()
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();
    /** Shown while no real CAQH API is configured (the built-in sample profiles were removed). */
    private static final String NOT_SET_UP = "CAQH import is not set up yet. An admin can connect the real CAQH API in CAQH Config.";
    private static final Pattern CAQH_ID = Pattern.compile("^\\d{6,10}$");
    private static final Pattern NPI = Pattern.compile("^\\d{10}$");
    private static final Pattern STATE = Pattern.compile("^[A-Za-z]{2}$");
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    private final CaqhConfigRepository configRepository;
    private final EmailRegistry emailRegistry;
    private final OrgUserService orgUserService;
    private final ProviderRepository providerRepository;
    private final ProviderDocumentRepository documentRepository;
    private final ProviderDocumentInitializer documentInitializer;
    private final ProviderModuleSupport support;
    private final ProviderService providerService;
    private final NotificationService notificationService;
    private final CryptoService cryptoService;
    private final PermissionService permissionService;
    private final AuthContext authContext;

    // ---------- configuration ----------

    @Transactional(readOnly = true)
    public CaqhLookupConfigResponse getConfig() {
        authContext.requireStaff();
        return toResponse(loadConfig(authContext.orgId()));
    }

    @Transactional
    public CaqhLookupConfigResponse updateConfig(CaqhLookupConfigRequest req) {
        authContext.requireRole(Role.PLATFORM_ADMIN, Role.ORG_ADMIN);
        CaqhConfig c = loadConfig(authContext.orgId());
        c.setLookupMode(req.mode());
        c.setLookupApiUrl(blankToNull(req.apiUrl()));
        c.setLookupOrgId(blankToNull(req.orgId()));
        if (req.apiKey() != null) c.setLookupApiKeyEnc(cryptoService.encrypt(blankToNull(req.apiKey())));
        if ("real".equals(c.getLookupMode()) && c.getLookupApiUrl() == null) {
            throw new BadRequestException("Enter the CAQH API base URL to use real API mode");
        }
        return toResponse(configRepository.save(c));
    }

    @Transactional(readOnly = true)
    public CaqhLookupTestResponse testConnection() {
        authContext.requireRole(Role.PLATFORM_ADMIN, Role.ORG_ADMIN);
        CaqhConfig c = loadConfig(authContext.orgId());
        if (isMock(c)) {
            return new CaqhLookupTestResponse(false, "mock", NOT_SET_UP);
        }
        try {
            fetchReal(c, "10000001");
            return new CaqhLookupTestResponse(true, "real", "Real API connection succeeded.");
        } catch (NotFoundException e) {
            return new CaqhLookupTestResponse(true, "real", "Connection OK (test ID not in your CAQH roster, but the API responded).");
        } catch (BadRequestException e) {
            return new CaqhLookupTestResponse(false, "real", e.getMessage());
        }
    }

    // ---------- lookup / import ----------

    @Transactional(readOnly = true)
    public CaqhProfile lookup(String caqhId) {
        permissionService.require("provider", "create");
        authContext.requireStaff();
        return find(loadConfig(authContext.orgId()), caqhId);
    }

    @Transactional
    public CaqhImportResponse importProvider(CaqhImportRequest req) {
        permissionService.require("provider", "create");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        ProviderService.Hierarchy h = providerService.resolveHierarchy(orgId, req.clientId(), req.practiceId(), req.locationId());
        if (req.password() == null || req.password().length() < 8) {
            throw com.zmartcredential.exception.BadRequestException.onField("password", "At least 8 characters");
        }
        // re-read the profile server-side: the browser preview is never trusted
        CaqhProfile cp = find(loadConfig(orgId), req.caqhId());
        String first = blankToNull(cp.firstName());
        String last = blankToNull(cp.lastName());
        String npi = blankToNull(cp.npi());
        if (first == null || last == null) throw new BadRequestException("The CAQH profile has no provider name");
        if (npi == null || !NPI.matcher(npi).matches()) throw new BadRequestException("The CAQH profile has no valid NPI");
        var d = req.details();
        if (d != null) {
            ProviderService.requireComplete(d);
            if (!d.caqhId().trim().equals(req.caqhId())) throw new BadRequestException("The CAQH ID cannot be changed after the lookup");
            if (blankToNull(d.npi()) != null) npi = d.npi().trim();
            h = providerService.resolveHierarchy(orgId, d.clientId(), d.practiceId(), d.locationId());
        }
        if (providerRepository.existsByOrgIdAndNpi(orgId, npi)) {
            throw new ConflictException("A provider with NPI " + npi + " already exists");
        }

        LocalDate today = LocalDate.now();
        Provider p = new Provider();
        p.setOrgId(orgId);
        p.setFirstName(truncate(first, 80));
        p.setLastName(truncate(last, 80));
        p.setSuffix(truncate(blankToNull(cp.suffix()), 10));
        p.setSpecialty(truncate(blankToNull(cp.specialty()), 120));
        p.setTaxonomyCode(truncate(blankToNull(cp.taxonomy()), 20));
        p.setGender(truncate(blankToNull(cp.gender()), 20));
        p.setDateOfBirth(date(cp.dob()));
        p.setNpi(npi);
        p.setEmail(cp.email() == null ? null : truncate(cp.email().trim().toLowerCase(), 255));
        p.setPhone(truncate(blankToNull(cp.phone()), 30));
        p.setLicenseNumber(truncate(blankToNull(cp.license()), 40));
        String state = blankToNull(cp.licenseState());
        p.setLicenseState(state != null && STATE.matcher(state).matches() ? state.toUpperCase() : null);
        p.setLicenseExpires(date(cp.licenseExpires()));
        p.setDeaNumber(truncate(blankToNull(cp.deaNumber()), 20));
        p.setDeaExpires(date(cp.deaExpires()));
        if (cp.boardCert() != null) p.setBoardCert(truncate(cp.boardCert().board() + " · " + cp.boardCert().status(), 200));
        if (cp.malpractice() != null) p.setMalpracticeCarrier(truncate(cp.malpractice().carrier(), 200));
        p.setCaqhId(cp.caqhId());
        if (req.caqhUsername() != null && !req.caqhUsername().isBlank()) p.setCaqhUsername(req.caqhUsername().trim());
        if (req.caqhPassword() != null && !req.caqhPassword().isBlank()) p.setCaqhPasswordEnc(cryptoService.encrypt(req.caqhPassword()));
        p.setCaqhLastAttested(date(cp.attestedAt()));
        p.setCaqhLastSynced(LocalDateTime.now());
        p.setCaqhAttestationStatus(cp.attestedAt() == null ? null : "attested");
        p.setClientId(h.clientId());
        p.setPracticeId(h.practiceId());
        p.setLocationId(h.locationId());
        p.setStatus("active");
        if (d != null) {
            // the completed provider form wins over the CAQH profile
            p.setFirstName(d.firstName().trim());
            p.setLastName(d.lastName().trim());
            p.setSuffix(d.suffix().trim());
            p.setSpecialty(d.specialty().trim());
            p.setEmail(d.email().trim().toLowerCase());
            p.setPhone(d.phone().trim());
            p.setLicenseNumber(d.licenseNumber().trim());
            p.setLicenseState(d.licenseState().trim().toUpperCase());
            p.setLicenseExpires(d.licenseExpires());
            p.setCaqhUsername(d.caqhUsername() == null || d.caqhUsername().isBlank() ? null : d.caqhUsername().trim());
            p.setCaqhPasswordEnc(cryptoService.encrypt(d.caqhPassword()));
            p.setPecosAccessGranted(d.pecosAccessGranted());
            p.setPecosUsername(Boolean.TRUE.equals(d.pecosAccessGranted()) && d.pecosUsername() != null && !d.pecosUsername().isBlank() ? d.pecosUsername().trim() : null);
            p.setStatus(d.status());
        }
        p.setSource("caqh");
        p.setDateAdded(today);
        emailRegistry.requireFreeForProvider(p.getEmail(), null);
        p = providerRepository.save(p);
        documentInitializer.initialize(p);
        orgUserService.createProviderLogin(p.getId(), req.password(), null);

        int applied = 0;
        for (CaqhDocument doc : cp.documents()) {
            Long providerId = p.getId();
            var row = documentRepository.findByProviderIdAndDocType(providerId, doc.type()).orElse(null);
            if (row == null || "na".equals(row.getStatus())) continue;
            LocalDate exp = date(doc.expires());
            row.setStatus(exp != null && exp.isBefore(today) ? "expired" : "approved");
            row.setExpiresAt(exp);
            row.setFileName(truncate(doc.fileName(), 255));
            row.setUploadedAt(LocalDateTime.now());
            row.setUploadedBy(authContext.userId());
            documentRepository.save(row);
            applied++;
        }
        String name = p.getFirstName() + " " + p.getLastName();
        notificationService.notifyOrg(orgId, "CAQH import complete",
                name + " · NPI " + npi + " · " + applied + " documents verified", "UserPlus", NotificationService.INFO);
        return new CaqhImportResponse(p.getId(), name, applied);
    }

    // ---------- internals ----------

    private CaqhProfile find(CaqhConfig c, String caqhId) {
        String id = caqhId == null ? "" : caqhId.trim();
        if (!CAQH_ID.matcher(id).matches()) throw new BadRequestException("CAQH ID must be 6-10 digits");
        CaqhProfile profile;
        String source;
        if (isMock(c)) {
            throw new BadRequestException(NOT_SET_UP);
        } else {
            profile = fetchReal(c, id);
            source = "real";
        }
        List<CaqhDocument> docs = profile.documents() != null && !profile.documents().isEmpty()
                ? profile.documents() : buildDocuments(profile);
        Map<String, DocumentType> known = support.docTypes();
        return profile.withDocuments(docs.stream().filter(d -> d.type() != null && known.containsKey(d.type())).toList(), source);
    }

    private CaqhProfile fetchReal(CaqhConfig c, String caqhId) {
        if (c.getLookupApiUrl() == null) throw new BadRequestException("CAQH API URL not configured");
        String url = c.getLookupApiUrl().replaceAll("/+$", "") + "/providers/" + URLEncoder.encode(caqhId, StandardCharsets.UTF_8);
        HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20))
                .header("Accept", "application/json").GET();
        String key = cryptoService.decrypt(c.getLookupApiKeyEnc());
        if (key != null) rb.header("Authorization", "Bearer " + key);
        if (c.getLookupOrgId() != null) rb.header("X-Org-Id", c.getLookupOrgId());
        HttpResponse<String> res;
        try {
            res = HTTP.send(rb.build(), HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new BadRequestException("Could not reach the CAQH API: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BadRequestException("CAQH API request was interrupted");
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("CAQH API URL is not valid");
        }
        if (res.statusCode() == 404) throw new NotFoundException("Provider not found in CAQH ProView");
        if (res.statusCode() / 100 != 2) throw new BadRequestException("CAQH API error " + res.statusCode());
        try {
            return JSON.readValue(res.body(), CaqhProfile.class);
        } catch (RuntimeException e) {
            throw new BadRequestException("CAQH API returned an unexpected response");
        }
    }

    /** Credential documents CAQH tracks for a profile (mirrors the prototype's buildCaqhDocuments). */
    static List<CaqhDocument> buildDocuments(CaqhProfile p) {
        List<CaqhDocument> docs = new ArrayList<>();
        String at = p.attestedAt() != null ? p.attestedAt() : LocalDateTime.now().toString();
        String who = p.firstName() + "_" + p.lastName();
        if (p.licenseExpires() != null) {
            docs.add(doc("doc_license", "medical_license", "Medical License (" + p.licenseState() + ")",
                    "License_" + p.licenseState() + "_" + p.license() + ".pdf", p.licenseExpires(), "CAQH ProView", at, 184, null));
        }
        if (p.deaNumber() != null && p.deaExpires() != null) {
            docs.add(doc("doc_dea", "dea", "DEA Registration", "DEA_" + p.deaNumber() + ".pdf", p.deaExpires(),
                    "CAQH ProView", at, 95, null));
        }
        if (p.malpractice() != null) {
            docs.add(doc("doc_malpractice", "malpractice", "Malpractice COI (" + p.malpractice().carrier() + ")",
                    "Malpractice_COI_" + (p.malpractice().policyNumber() == null ? "" : p.malpractice().policyNumber()) + ".pdf",
                    p.malpractice().expires(), "CAQH ProView", at, 267, p.malpractice().limit()));
        }
        if (p.boardCert() != null) {
            docs.add(doc("doc_board_cert", "board_cert", "Board Certification (" + p.boardCert().board() + ")",
                    "BoardCert_" + p.boardCert().board().replaceAll("\\s", "_") + ".pdf", p.boardCert().expires(),
                    p.boardCert().board(), at, 142, null));
        }
        docs.add(doc("doc_cv", "cv", "Curriculum Vitae", "CV_" + who + ".pdf", null, "CAQH ProView", at, 215, null));
        docs.add(doc("doc_w9", "w9", "W-9 (Form)", "W9_" + who + ".pdf", null, "CAQH ProView", at, 48, null));
        docs.add(doc("doc_gov_id", "gov_id", "Government-Issued Photo ID", "GovID_" + who + ".pdf", null, "CAQH ProView", at, 128, null));
        List<CaqhEducation> edu = p.educationHistory() == null ? List.of() : p.educationHistory();
        if (!edu.isEmpty()) {
            CaqhEducation ed = edu.get(0);
            docs.add(doc("doc_diploma_0", "diploma", ed.degree() + " Diploma — " + ed.school(), "Diploma_" + ed.year() + ".pdf",
                    null, "CAQH ProView", at, 310, null));
        }
        return docs;
    }

    private static CaqhDocument doc(String id, String type, String label, String fileName, String expires, String verifiedBy,
                                    String verifiedAt, int sizeKb, String coverageLimit) {
        return new CaqhDocument(id, type, label, fileName, "approved", expires, verifiedBy, verifiedAt, sizeKb, coverageLimit);
    }

    private CaqhConfig loadConfig(Long orgId) {
        return configRepository.findById(orgId).orElseGet(() -> {
            CaqhConfig c = new CaqhConfig();
            c.setOrgId(orgId);
            return c;
        });
    }

    private static boolean isMock(CaqhConfig c) {
        return !"real".equals(c.getLookupMode());
    }

    private static CaqhLookupConfigResponse toResponse(CaqhConfig c) {
        return new CaqhLookupConfigResponse(isMock(c) ? "mock" : "real", c.getLookupApiUrl(), c.getLookupApiKeyEnc() != null,
                c.getLookupOrgId(), List.of());
    }

    private static LocalDate date(String s) {
        String v = blankToNull(s);
        if (v == null) return null;
        try {
            return LocalDate.parse(v.length() > 10 ? v.substring(0, 10) : v);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
