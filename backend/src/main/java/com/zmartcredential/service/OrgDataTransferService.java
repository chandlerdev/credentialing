package com.zmartcredential.service;

import com.zmartcredential.dto.organization.TestDataDtos.BundleClient;
import com.zmartcredential.dto.organization.TestDataDtos.BundleDocument;
import com.zmartcredential.dto.organization.TestDataDtos.BundleEnrollment;
import com.zmartcredential.dto.organization.TestDataDtos.BundleLocation;
import com.zmartcredential.dto.organization.TestDataDtos.BundlePractice;
import com.zmartcredential.dto.organization.TestDataDtos.BundleProvider;
import com.zmartcredential.dto.organization.TestDataDtos.BundleTask;
import com.zmartcredential.dto.organization.TestDataDtos.DataBundle;
import com.zmartcredential.dto.organization.TestDataDtos.DataBundleData;
import com.zmartcredential.dto.organization.TestDataDtos.DataImportResult;
import com.zmartcredential.dto.organization.TestDataDtos.TestDataCounts;
import com.zmartcredential.entity.Enrollment;
import com.zmartcredential.entity.Location;
import com.zmartcredential.entity.Organization;
import com.zmartcredential.entity.Payer;
import com.zmartcredential.entity.Practice;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.entity.ProviderDocument;
import com.zmartcredential.entity.Task;
import com.zmartcredential.repository.EnrollmentRepository;
import com.zmartcredential.repository.LocationRepository;
import com.zmartcredential.repository.OrganizationRepository;
import com.zmartcredential.repository.PayerRepository;
import com.zmartcredential.repository.PracticeRepository;
import com.zmartcredential.repository.ProviderDocumentRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.repository.TaskRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.Role;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Test Data → JSON Data Management (prototype v2). Export writes the organization's structure, providers,
 * enrollments and tasks as one JSON file; import replaces the org's test data with the file's records (all
 * flagged as test data, so "Delete all test data" removes them again). Users are never exported or imported.
 */
@Service
@RequiredArgsConstructor
public class OrgDataTransferService {

    public static final String VERSION = "zmart-v2";

    private static final Pattern NPI = Pattern.compile("^\\d{10}$");
    private static final Pattern CAQH = Pattern.compile("^\\d{6,10}$");
    private static final Pattern STATE = Pattern.compile("^[A-Za-z]{2}$");
    private static final Set<String> PROVIDER_STATUSES = Set.of("active", "draft", "in_progress", "pending", "on_hold",
            "inactive", "terminated");
    private static final Set<String> ENROLLMENT_STATUSES = Set.of("draft", "in_progress", "submitted", "approved",
            "needs_attention", "on_hold", "terminated");
    private static final Set<String> DOC_STATUSES = Set.of("approved", "missing", "expired", "pending", "pending_review", "na");
    private static final Set<String> TASK_STATUSES = Set.of("open", "in_progress", "done");
    private static final Set<String> TASK_PRIORITIES = Set.of("low", "medium", "high", "urgent");

    private final EmailRegistry emailRegistry;
    private final PracticeRepository practiceRepository;
    private final LocationRepository locationRepository;
    private final ProviderRepository providerRepository;
    private final ProviderDocumentRepository documentRepository;
    private final EnrollmentRepository enrollmentRepository;
    private final TaskRepository taskRepository;
    private final PayerRepository payerRepository;
    private final OrganizationRepository organizationRepository;
    private final ProviderDocumentInitializer documentInitializer;
    private final OrgTestDataService testDataService;
    private final NotificationService notificationService;
    private final AuthContext authContext;

    @Transactional(readOnly = true)
    public DataBundle export() {
        authContext.requireRole(Role.PLATFORM_ADMIN, Role.ORG_ADMIN);
        Long orgId = authContext.orgId();
        String orgName = organizationRepository.findById(orgId).map(Organization::getName).orElse(null);

        List<Practice> practices = practiceRepository.findByOrgIdOrderByNameAsc(orgId);
        List<BundlePractice> bundlePractices = practices.stream()
                .map(p -> new BundlePractice(id(p.getId()), p.getName(), p.getTaxId(), p.getAddress(), p.getPhone(), p.getEmail()))
                .toList();
        List<BundleLocation> locations = locationRepository.findByOrgIdOrderByNameAsc(orgId).stream()
                .map(l -> new BundleLocation(id(l.getId()), id(l.getPracticeId()), l.getName(), l.getLegalName(), l.getNpi(),
                        l.getLocationType(), l.getAddress(), l.getCity(), l.getState(), l.getZip(), l.getPhone(), l.getLat(),
                        l.getLng(), l.getActive()))
                .toList();
        Map<Long, Map<String, BundleDocument>> docs = new HashMap<>();
        for (ProviderDocument d : documentRepository.findByOrgId(orgId)) {
            docs.computeIfAbsent(d.getProviderId(), k -> new LinkedHashMap<>())
                    .put(d.getDocType(), new BundleDocument(d.getStatus(), d.getExpiresAt()));
        }
        List<BundleProvider> providers = providerRepository.findByOrgIdOrderByLastNameAsc(orgId).stream()
                .map(p -> new BundleProvider(id(p.getId()), p.getFirstName(), p.getLastName(), p.getSuffix(), p.getSpecialty(),
                        p.getNpi(), p.getEmail(), p.getPhone(), p.getLicenseNumber(), p.getLicenseState(), p.getLicenseExpires(),
                        p.getDeaNumber(), p.getDeaExpires(), p.getCaqhId(), p.getStatus(), p.getDateAdded(), null,
                        id(p.getPracticeId()), id(p.getLocationId()), docs.getOrDefault(p.getId(), Map.of())))
                .toList();
        Map<Long, String> payerCodes = new HashMap<>();
        payerRepository.findAll().forEach(p -> payerCodes.put(p.getId(), p.getCode()));
        List<BundleEnrollment> enrollments = enrollmentRepository.findByOrgId(orgId).stream()
                .map(e -> new BundleEnrollment(id(e.getProviderId()), payerCodes.get(e.getPayerId()), e.getStatus(),
                        e.getSubmittedDate(), e.getEffectiveDate()))
                .toList();
        List<BundleTask> tasks = taskRepository.findByOrgIdOrderByCreatedAtDesc(orgId).stream()
                .map(t -> new BundleTask(t.getTitle(), t.getDescription(), t.getStatus(), t.getPriority(), t.getDueDate(),
                        id(t.getProviderId())))
                .toList();
        return new DataBundle(OffsetDateTime.now().toString(), VERSION,
                practices.size() + " practices, " + locations.size() + " locations, "
                        + providers.size() + " providers, " + enrollments.size() + " enrollments, " + tasks.size() + " tasks",
                new DataBundleData(orgName, bundlePractices, null, locations, providers, enrollments, tasks));
    }

    @Transactional
    public DataImportResult importBundle(DataBundle bundle) {
        authContext.requireRole(Role.PLATFORM_ADMIN, Role.ORG_ADMIN);
        Long orgId = authContext.orgId();
        DataBundleData data = bundle.data();
        TestDataCounts removed = testDataService.purgeOrg(orgId);
        List<String> skipped = new ArrayList<>();
        LocalDate today = LocalDate.now();

        // practices (top level; an older file's practices under clients are read the same way, without clients)
        List<BundlePractice> bundlePractices = new ArrayList<>(nz(data.practices()));
        for (BundleClient bc : nz(data.clients())) bundlePractices.addAll(nz(bc.practices()));
        Map<String, Practice> practiceById = new HashMap<>();
        for (BundlePractice bp : bundlePractices) {
            Practice p = new Practice();
            p.setOrgId(orgId);
            p.setName(bp.name().trim());
            p.setTaxId(blankToNull(bp.taxId()));
            p.setAddress(blankToNull(bp.address()));
            p.setPhone(blankToNull(bp.phone()));
            p.setEmail(blankToNull(bp.email()));
            p.setTestData(true);
            practiceById.put(bp.id(), practiceRepository.save(p));
        }

        // locations
        Map<String, Location> locationById = new HashMap<>();
        for (BundleLocation bl : nz(data.locations())) {
            Location l = new Location();
            l.setOrgId(orgId);
            Practice pr = bl.practiceId() == null ? null : practiceById.get(bl.practiceId());
            if (bl.practiceId() != null && pr == null) skipped.add("Location " + bl.name() + ": unknown practice " + bl.practiceId() + " (left unlinked)");
            l.setPracticeId(pr == null ? null : pr.getId());
            l.setName(bl.name().trim());
            l.setLegalName(blankToNull(bl.legalName()));
            l.setNpi(bl.npi() != null && NPI.matcher(bl.npi()).matches() ? bl.npi() : null);
            l.setLocationType(blankToNull(bl.locationType()) == null ? "Primary" : bl.locationType().trim());
            l.setAddress(blankToNull(bl.address()));
            l.setCity(blankToNull(bl.city()));
            l.setState(bl.state() != null && STATE.matcher(bl.state()).matches() ? bl.state().toUpperCase() : null);
            l.setZip(blankToNull(bl.zip()));
            l.setPhone(blankToNull(bl.phone()));
            l.setLat(bl.lat());
            l.setLng(bl.lng());
            l.setActive(bl.active() == null || bl.active());
            l.setTestData(true);
            locationById.put(bl.id(), locationRepository.save(l));
        }

        // providers (+ document statuses)
        Map<String, Long> providerIds = new HashMap<>();
        Set<String> npis = new HashSet<>();
        Set<String> importEmails = new HashSet<>();
        for (BundleProvider bp : data.providers()) {
            String name = bp.firstName() + " " + bp.lastName();
            String npi = blankToNull(bp.npi());
            if (npi == null || !NPI.matcher(npi).matches()) {
                skipped.add("Provider " + name + ": NPI must be 10 digits");
                continue;
            }
            if (!npis.add(npi) || providerRepository.existsByOrgIdAndNpi(orgId, npi)) {
                skipped.add("Provider " + name + ": NPI " + npi + " already exists");
                continue;
            }
            String bpEmail = EmailRegistry.normalize(bp.email());
            if (bpEmail != null && (emailRegistry.inUse(bpEmail) || !importEmails.add(bpEmail))) {
                skipped.add("Provider " + name + ": email " + bpEmail + " is already used");
                continue;
            }
            Provider p = new Provider();
            p.setOrgId(orgId);
            p.setFirstName(bp.firstName().trim());
            p.setLastName(bp.lastName().trim());
            p.setSuffix(blankToNull(bp.suffix()));
            p.setSpecialty(blankToNull(bp.specialty()));
            p.setNpi(npi);
            p.setEmail(bp.email() == null || bp.email().isBlank() ? null : bp.email().trim().toLowerCase());
            p.setPhone(blankToNull(bp.phone()));
            p.setLicenseNumber(blankToNull(bp.licenseNumber()));
            p.setLicenseState(bp.licenseState() != null && STATE.matcher(bp.licenseState()).matches() ? bp.licenseState().toUpperCase() : null);
            p.setLicenseExpires(bp.licenseExpires());
            p.setDeaNumber(blankToNull(bp.deaNumber()));
            p.setDeaExpires(bp.deaExpires());
            p.setCaqhId(bp.caqhId() != null && CAQH.matcher(bp.caqhId()).matches() ? bp.caqhId() : null);
            p.setStatus(oneOf(PROVIDER_STATUSES, bp.status()) ? bp.status() : "draft");
            p.setSource("import");
            p.setDateAdded(bp.dateAdded() == null ? today : bp.dateAdded());
            // hierarchy: location -> practice (most specific wins)
            Location loc = bp.locationId() == null ? null : locationById.get(bp.locationId());
            Practice pr = bp.practiceId() == null ? null : practiceById.get(bp.practiceId());
            if (loc != null && loc.getPracticeId() != null) {
                Long locPracticeId = loc.getPracticeId();
                pr = practiceById.values().stream().filter(x -> x.getId().equals(locPracticeId)).findFirst().orElse(pr);
            }
            p.setLocationId(loc == null ? null : loc.getId());
            p.setPracticeId(pr == null ? null : pr.getId());
            p.setTestData(true);
            p = providerRepository.save(p);
            documentInitializer.initialize(p);
            applyDocuments(p, bp.documents());
            providerIds.put(bp.id(), p.getId());
        }

        // enrollments
        Map<String, Long> payerIds = new HashMap<>();
        for (Payer payer : payerRepository.findAll()) payerIds.put(payer.getCode(), payer.getId());
        List<Enrollment> enrollments = new ArrayList<>();
        for (BundleEnrollment be : nz(data.enrollments())) {
            Long providerId = providerIds.get(be.providerId());
            Long payerId = payerIds.get(be.payerCode());
            if (providerId == null) continue; // provider skipped above
            if (payerId == null) {
                skipped.add("Enrollment for provider " + be.providerId() + ": unknown payer " + be.payerCode());
                continue;
            }
            Enrollment e = new Enrollment();
            e.setOrgId(orgId);
            e.setProviderId(providerId);
            e.setPayerId(payerId);
            e.setApplicationType("initial");
            e.setStatus(oneOf(ENROLLMENT_STATUSES, be.status()) ? be.status() : "draft");
            e.setSubmittedDate(be.submittedDate());
            e.setEffectiveDate(be.effectiveDate());
            if (be.submittedDate() != null && be.effectiveDate() != null && !be.effectiveDate().isBefore(be.submittedDate())) {
                e.setTatDays((int) ChronoUnit.DAYS.between(be.submittedDate(), be.effectiveDate()));
            }
            e.setTestData(true);
            enrollments.add(e);
        }
        enrollmentRepository.saveAll(enrollments);

        // tasks
        List<Task> tasks = new ArrayList<>();
        for (BundleTask bt : nz(data.tasks())) {
            Task t = new Task();
            t.setOrgId(orgId);
            t.setTitle(bt.title().trim());
            t.setDescription(blankToNull(bt.description()));
            t.setStatus(oneOf(TASK_STATUSES, bt.status()) ? bt.status() : "open");
            t.setPriority(oneOf(TASK_PRIORITIES, bt.priority()) ? bt.priority() : "medium");
            t.setDueDate(bt.dueDate());
            t.setProviderId(bt.providerId() == null ? null : providerIds.get(bt.providerId()));
            t.setCreatedBy(authContext.userId());
            if ("done".equals(t.getStatus())) t.setCompletedAt(LocalDateTime.now());
            t.setTestData(true);
            tasks.add(t);
        }
        taskRepository.saveAll(tasks);

        TestDataCounts created = new TestDataCounts(providerIds.size(), enrollments.size(), locationById.size(), 0,
                tasks.size(), 0, practiceById.size());
        notificationService.notifyOrg(orgId, "Data imported",
                created.providers() + " providers, " + created.enrollments() + " enrollments, " + created.locations()
                        + " locations imported as test data" + (skipped.isEmpty() ? "" : " (" + skipped.size() + " skipped)"),
                "Upload", NotificationService.INFO);
        return new DataImportResult(removed, created, testDataService.totals(orgId), skipped);
    }

    private void applyDocuments(Provider p, Map<String, BundleDocument> documents) {
        if (documents == null || documents.isEmpty()) return;
        List<ProviderDocument> changed = new ArrayList<>();
        for (ProviderDocument d : documentRepository.findByProviderId(p.getId())) {
            BundleDocument bd = documents.get(d.getDocType());
            if (bd == null || !oneOf(DOC_STATUSES, bd.status())) continue;
            d.setStatus(bd.status());
            d.setExpiresAt(bd.expires());
            if (!"missing".equals(bd.status()) && !"na".equals(bd.status())) d.setUploadedAt(LocalDateTime.now());
            changed.add(d);
        }
        documentRepository.saveAll(changed);
    }

    /** Set.of(...).contains(null) throws; missing optional values fall back to the default. */
    private static boolean oneOf(Set<String> allowed, String value) {
        return value != null && allowed.contains(value);
    }

    private static String id(Long id) {
        return id == null ? null : String.valueOf(id);
    }

    private static <T> List<T> nz(List<T> list) {
        return list == null ? List.of() : list;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
