package com.zmartcredential.service;

import com.zmartcredential.common.PageResponse;
import com.zmartcredential.dto.enrollment.EnrollmentDetailResponse;
import com.zmartcredential.dto.enrollment.EnrollmentEventRequest;
import com.zmartcredential.dto.enrollment.EnrollmentEventResponse;
import com.zmartcredential.dto.enrollment.EnrollmentFileResponse;
import com.zmartcredential.dto.enrollment.EnrollmentPatchRequest;
import com.zmartcredential.dto.enrollment.EnrollmentRequest;
import com.zmartcredential.dto.enrollment.EnrollmentResponse;
import com.zmartcredential.dto.enrollment.EnrollmentSummaryResponse;
import com.zmartcredential.entity.AppUser;
import com.zmartcredential.entity.Enrollment;
import com.zmartcredential.entity.EnrollmentEvent;
import com.zmartcredential.entity.EnrollmentFile;
import com.zmartcredential.entity.Payer;
import com.zmartcredential.entity.PayerForm;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.ConflictException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.AppUserRepository;
import com.zmartcredential.repository.EnrollmentEventRepository;
import com.zmartcredential.repository.EnrollmentFileRepository;
import com.zmartcredential.repository.EnrollmentRepository;
import com.zmartcredential.repository.PayerFormRepository;
import com.zmartcredential.repository.PracticeRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.PermissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

import static com.zmartcredential.service.EnrollmentSupport.blankToNull;

/** Payer enrollments: CRUD, timeline events, files, resubmit and re-credentialing. */
@Service
@RequiredArgsConstructor
public class EnrollmentService {

    public static final Set<String> FILE_TYPES = Set.of("welcome_letter", "application_form", "contract", "acknowledgement", "other");
    /** the acknowledgement / approval certificate: PDF, Word, JPG or PNG (as provider documents) */
    private static final Set<String> ACK_EXTENSIONS = Set.of("pdf", "doc", "docx", "jpg", "jpeg", "png");
    private static final Set<String> CLOSED_STATUSES = Set.of("approved", "terminated");

    private final EnrollmentRepository enrollmentRepository;
    private final EnrollmentFileRepository fileRepository;
    private final EnrollmentEventRepository eventRepository;
    private final PayerFormRepository formRepository;
    private final PracticeRepository practiceRepository;
    private final AppUserRepository userRepository;
    private final EnrollmentSupport support;
    private final AuthContext authContext;
    private final PermissionService permissionService;
    private final FileStorageService storage;
    private final NotificationService notificationService;
    private final MailTemplateService mailTemplateService;
    private final SoftDeleteCascade softDeleteCascade;

    /** Name lookups for assembling rows. */
    public record Ctx(Map<Long, Provider> providers, Map<Long, Payer> payers, Map<Long, String> practices,
                      Map<Long, String> users, Map<Long, String> forms) {
        String providerName(Long id) {
            return EnrollmentSupport.fullName(providers.get(id));
        }

        String payerName(Long id) {
            Payer p = payers.get(id);
            return p == null ? null : p.getName();
        }
    }

    public Ctx context(Long orgId) {
        Map<Long, String> forms = formRepository.findAll().stream().collect(Collectors.toMap(PayerForm::getId, PayerForm::getLabel));
        return new Ctx(support.providerMap(orgId), support.payerMap(), support.practiceNames(orgId), support.userNames(orgId), forms);
    }

    // ------------------------------------------------------------------ queries

    @Transactional(readOnly = true)
    public PageResponse<EnrollmentResponse> list(String q, String status, Long providerId, Long payerId,
                                                 int page, int size, String sort) {
        permissionService.require("enrollment", "list");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        Ctx ctx = context(orgId);
        String query = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
        boolean allStatuses = status == null || status.isBlank() || "all".equals(status);

        List<Enrollment> filtered = enrollmentRepository.findByOrgId(orgId).stream()
                .filter(e -> allStatuses || status.equals(e.getStatus()))
                .filter(e -> providerId == null || providerId.equals(e.getProviderId()))
                .filter(e -> payerId == null || payerId.equals(e.getPayerId()))
                .filter(e -> query.isEmpty() || matches(e, ctx, query))
                .sorted(comparator(sort, ctx))
                .toList();

        int safeSize = Math.min(Math.max(1, size), 500);
        int from = Math.min(Math.max(0, page) * safeSize, filtered.size());
        int to = Math.min(from + safeSize, filtered.size());
        List<EnrollmentResponse> content = toResponses(filtered.subList(from, to), ctx);
        int totalPages = (int) Math.ceil(filtered.size() / (double) safeSize);
        return new PageResponse<>(content, Math.max(0, page), safeSize, filtered.size(), totalPages);
    }

    @Transactional(readOnly = true)
    public EnrollmentSummaryResponse summary(Long providerId) {
        permissionService.require("enrollment", "list");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        List<Enrollment> list = providerId == null ? enrollmentRepository.findByOrgId(orgId)
                : enrollmentRepository.findByOrgIdAndProviderId(orgId, providerId);
        Map<String, Long> byStatus = new LinkedHashMap<>();
        EnrollmentSupport.STATUSES.forEach(s -> byStatus.put(s, 0L));
        list.forEach(e -> byStatus.merge(e.getStatus(), 1L, Long::sum));
        long active = byStatus.getOrDefault("in_progress", 0L) + byStatus.getOrDefault("submitted", 0L);
        List<Integer> tats = list.stream().map(e -> EnrollmentSupport.tat(e.getSubmittedDate(), e.getEffectiveDate()))
                .filter(Objects::nonNull).toList();
        Integer avg = tats.isEmpty() ? null : (int) Math.round(tats.stream().mapToInt(Integer::intValue).average().orElse(0));
        return new EnrollmentSummaryResponse(list.size(), byStatus, byStatus.getOrDefault("approved", 0L), active, avg);
    }

    @Transactional(readOnly = true)
    public EnrollmentDetailResponse get(Long id) {
        Enrollment e = loadReadable(id);
        Long orgId = authContext.orgId();
        Ctx ctx = context(orgId);
        List<EnrollmentFileResponse> files = fileRepository.findByEnrollmentIdOrderByUploadedAtDesc(id).stream()
                .map(f -> toFileResponse(f, ctx.users())).toList();
        return new EnrollmentDetailResponse(toResponses(List.of(e), ctx).get(0), files, events(e.getId()));
    }

    @Transactional(readOnly = true)
    public List<EnrollmentEventResponse> listEvents(Long id) {
        Enrollment e = loadReadable(id);
        return events(e.getId());
    }

    // ------------------------------------------------------------------ mutations

    @Transactional
    public EnrollmentResponse create(EnrollmentRequest req) {
        permissionService.require("enrollment", "create");
        authContext.requireStaff();
        Enrollment e = createEntity(req, true, null);
        return toResponse(e);
    }

    /**
     * Creates an enrollment (+ 'created' event). Used by the wizard and re-credentialing too.
     * @param enforceDuplicate reject a second open initial enrollment for the same provider and payer
     */
    @Transactional
    public Enrollment createEntity(EnrollmentRequest req, boolean enforceDuplicate, String eventNote) {
        Long orgId = authContext.orgId();
        Enrollment e = new Enrollment();
        e.setOrgId(orgId);
        apply(e, req, orgId, true);
        if (enforceDuplicate && "initial".equals(e.getApplicationType())) {
            findOpenInitial(orgId, e.getProviderId(), e.getPayerId(), null).ifPresent(other -> {
                throw new ConflictException("This provider already has an open enrollment with this payer (#" + other.getId() + ")");
            });
        }
        e = enrollmentRepository.save(e);
        if ("approved".equals(e.getStatus())) mailTemplateService.sendEnrollmentApproved(e);
        Payer payer = support.payer(e.getPayerId());
        support.addEvent(e.getId(), "created",
                eventNote != null ? eventNote : "Enrollment record created for " + payer.getName(), null);
        return e;
    }

    public Optional<Enrollment> findOpenInitial(Long orgId, Long providerId, Long payerId, Long excludeId) {
        return enrollmentRepository.findByOrgIdAndProviderId(orgId, providerId).stream()
                .filter(x -> payerId.equals(x.getPayerId()))
                .filter(x -> "initial".equals(x.getApplicationType()))
                .filter(x -> !"terminated".equals(x.getStatus()))
                .filter(x -> excludeId == null || !excludeId.equals(x.getId()))
                .findFirst();
    }

    @Transactional
    public EnrollmentResponse update(Long id, EnrollmentRequest req) {
        permissionService.require("enrollment", "update");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        Enrollment e = load(id, orgId);
        String oldStatus = e.getStatus();
        apply(e, req, orgId, false);
        // same rule as create: one open initial enrollment per provider and payer (also when re-opening a terminated one)
        if ("initial".equals(e.getApplicationType()) && !"terminated".equals(e.getStatus())) {
            findOpenInitial(orgId, e.getProviderId(), e.getPayerId(), e.getId()).ifPresent(other -> {
                throw new ConflictException("This provider already has an open enrollment with this payer (#" + other.getId() + ")");
            });
        }
        e = enrollmentRepository.save(e);
        afterStatusChange(e, oldStatus);
        return toResponse(e);
    }

    @Transactional
    public EnrollmentResponse patch(Long id, EnrollmentPatchRequest req) {
        permissionService.require("enrollment", "update");
        authContext.requireStaff();
        Enrollment e = load(id, authContext.orgId());
        EnrollmentRequest merged = new EnrollmentRequest(
                e.getProviderId(), e.getPayerId(),
                req.status() != null ? req.status() : e.getStatus(),
                e.getApplicationType(), e.getPracticeId(), e.getFormId(),
                Boolean.TRUE.equals(req.clearSubmittedDate()) ? null : (req.submittedDate() != null ? req.submittedDate() : e.getSubmittedDate()),
                Boolean.TRUE.equals(req.clearEffectiveDate()) ? null : (req.effectiveDate() != null ? req.effectiveDate() : e.getEffectiveDate()),
                req.notes() != null ? req.notes() : e.getNotes(),
                Boolean.TRUE.equals(req.clearAssignedUser()) ? null : (req.assignedUserId() != null ? req.assignedUserId() : e.getAssignedUserId()),
                e.getFollowUpDate(), e.getEstApprovedDate());
        return update(id, merged);
    }

    @Transactional
    public void delete(Long id) {
        permissionService.require("enrollment", "delete");
        authContext.requireStaff();
        Enrollment e = load(id, authContext.orgId());
        // soft delete: the enrollment and its files are kept (marked deleted)
        softDeleteCascade.enrollment(e.getId());
        enrollmentRepository.delete(e);
    }

    @Transactional
    public EnrollmentEventResponse addEvent(Long id, EnrollmentEventRequest req) {
        permissionService.require("enrollment", "update");
        authContext.requireStaff();
        Enrollment e = load(id, authContext.orgId());
        EnrollmentEvent ev = support.addEvent(e.getId(), req.type(), req.note().trim(), null);
        return toEventResponse(ev);
    }

    @Transactional
    public EnrollmentResponse resubmit(Long id, String note) {
        permissionService.require("enrollment", "update");
        authContext.requireStaff();
        Enrollment e = load(id, authContext.orgId());
        String old = e.getStatus();
        e.setStatus("in_progress");
        e = enrollmentRepository.save(e);
        String text = blankToNull(note);
        support.addEvent(e.getId(), "resubmitted",
                "Enrollment resubmitted (was " + EnrollmentSupport.statusLabel(old) + ")" + (text == null ? "" : ": " + text), null);
        return toResponse(e);
    }

    /** "Start Recred": new draft enrollment of type recred for the same provider and payer. */
    @Transactional
    public EnrollmentResponse recredential(Long id) {
        permissionService.require("enrollment", "create");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        Enrollment src = load(id, orgId);
        if (!"approved".equals(src.getStatus())) {
            throw new BadRequestException("Only approved enrollments can be re-credentialed");
        }
        enrollmentRepository.findByOrgIdAndProviderId(orgId, src.getProviderId()).stream()
                .filter(x -> src.getPayerId().equals(x.getPayerId()) && "recred".equals(x.getApplicationType())
                        && !CLOSED_STATUSES.contains(x.getStatus()) && !x.getId().equals(src.getId()))
                .findFirst().ifPresent(x -> {
                    throw new ConflictException("A re-credentialing application is already open (#" + x.getId() + ")");
                });
        EnrollmentRequest req = new EnrollmentRequest(src.getProviderId(), src.getPayerId(), "draft", "recred",
                src.getPracticeId(), src.getFormId(), null, null, null, src.getAssignedUserId(), null, null);
        Enrollment created = createEntity(req, false, "Re-credentialing started from enrollment #" + src.getId());
        support.addEvent(src.getId(), "recredential_started", "Re-credentialing application #" + created.getId() + " created", null);
        return toResponse(created);
    }

    // ------------------------------------------------------------------ files

    @Transactional
    public EnrollmentFileResponse uploadFile(Long id, MultipartFile file, String fileType) {
        permissionService.require("enrollment", "update");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        Enrollment e = load(id, orgId);
        String type = fileType == null || fileType.isBlank() ? "other" : fileType.trim();
        if (!FILE_TYPES.contains(type)) {
            throw new BadRequestException("File type must be welcome_letter, application_form, contract, acknowledgement or other");
        }
        if ("acknowledgement".equals(type)) {
            if (!"approved".equals(e.getStatus())) throw new BadRequestException("The acknowledgement can be uploaded once the enrollment is approved");
            String n = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase();
            String ext = n.contains(".") ? n.substring(n.lastIndexOf('.') + 1) : "";
            if (!ACK_EXTENSIONS.contains(ext)) throw new BadRequestException("Only PDF, Word, JPG or PNG files can be uploaded");
        }
        String key = storage.store(orgId, file);
        EnrollmentFile f = new EnrollmentFile();
        f.setEnrollmentId(e.getId());
        String name = file.getOriginalFilename() == null || file.getOriginalFilename().isBlank() ? "file" : file.getOriginalFilename();
        f.setName(EnrollmentSupport.truncate(name, 255));
        f.setFileType(type);
        f.setStorageKey(key);
        f.setMimeType(file.getContentType());
        f.setSizeBytes(file.getSize());
        f.setUploadedAt(LocalDateTime.now());
        f.setUploadedBy(authContext.userId());
        f = fileRepository.save(f);
        return toFileResponse(f, Map.of(authContext.userId(), support.actorLabel()));
    }

    /** Staff notes on an enrollment (the payer's answers by phone / email, why it is pending). */
    @Transactional
    public EnrollmentResponse saveNotes(Long id, String notes) {
        permissionService.require("enrollment", "update");
        authContext.requireStaff();
        Enrollment e = load(id, authContext.orgId());
        String value = notes == null || notes.isBlank() ? null : notes.strip();
        if (!Objects.equals(value, e.getNotes())) {
            e.setNotes(value);
            e.setNotesUpdatedAt(LocalDateTime.now());
            e.setNotesUpdatedBy(EnrollmentSupport.truncate(support.actorLabel(), 120));
            e = enrollmentRepository.save(e);
        }
        return toResponse(e);
    }

    public record FileDownload(Resource resource, String name, String mimeType) {
    }

    @Transactional(readOnly = true)
    public FileDownload download(Long fileId) {
        EnrollmentFile f = fileRepository.findById(fileId).orElseThrow(() -> NotFoundException.of("File", fileId));
        loadReadable(f.getEnrollmentId());
        return new FileDownload(storage.load(f.getStorageKey()), f.getName(), f.getMimeType());
    }

    @Transactional
    public void deleteFile(Long fileId) {
        permissionService.require("enrollment", "update");
        authContext.requireStaff();
        EnrollmentFile f = fileRepository.findById(fileId).orElseThrow(() -> NotFoundException.of("File", fileId));
        load(f.getEnrollmentId(), authContext.orgId());
        // soft delete: the stored file is kept
        fileRepository.delete(f);
    }

    // ------------------------------------------------------------------ helpers

    public Enrollment load(Long id, Long orgId) {
        return enrollmentRepository.findByIdAndOrgId(id, orgId).orElseThrow(() -> NotFoundException.of("Enrollment", id));
    }

    /** Load with read permission + provider scoping (provider users only see their own). */
    public Enrollment loadReadable(Long id) {
        permissionService.require("enrollment", "read");
        Enrollment e = load(id, authContext.orgId());
        authContext.requireProviderAccess(e.getProviderId());
        return e;
    }

    private void apply(Enrollment e, EnrollmentRequest r, Long orgId, boolean creating) {
        Provider provider = support.provider(r.providerId(), orgId);
        Payer payer = support.payer(r.payerId());
        if (creating && !Boolean.TRUE.equals(payer.getActive())) {
            throw new BadRequestException(payer.getName() + " is inactive");
        }
        if (r.status() != null && !EnrollmentSupport.STATUSES.contains(r.status())) {
            throw new BadRequestException("Unknown status " + r.status());
        }
        if (r.applicationType() != null && !EnrollmentSupport.APPLICATION_TYPES.contains(r.applicationType())) {
            throw new BadRequestException("Unknown application type " + r.applicationType());
        }
        // approved, follow-up and estimated approval dates: on or after the submitted date
        if (r.submittedDate() != null) {
            if (r.effectiveDate() != null && r.effectiveDate().isBefore(r.submittedDate())) {
                throw BadRequestException.onField("effectiveDate", "Approved date must be on or after the submitted date");
            }
            if (r.followUpDate() != null && r.followUpDate().isBefore(r.submittedDate())) {
                throw BadRequestException.onField("followUpDate", "Follow up date must be on or after the submitted date");
            }
            if (r.estApprovedDate() != null && r.estApprovedDate().isBefore(r.submittedDate())) {
                throw BadRequestException.onField("estApprovedDate", "Estimated approval date must be on or after the submitted date");
            }
        }
        Long practiceId = r.practiceId();
        if (practiceId != null) {
            practiceRepository.findByIdAndOrgId(practiceId, orgId).orElseThrow(() -> NotFoundException.of("Practice", r.practiceId()));
        } else if (creating || !Objects.equals(e.getProviderId(), provider.getId())) {
            practiceId = provider.getPracticeId();
        } else {
            practiceId = e.getPracticeId();
        }
        if (r.formId() != null) {
            PayerForm form = formRepository.findById(r.formId()).orElseThrow(() -> NotFoundException.of("Form", r.formId()));
            if (!form.getPayerId().equals(payer.getId())) {
                throw new BadRequestException("The selected form does not belong to " + payer.getName());
            }
        }
        if (r.assignedUserId() != null) {
            AppUser u = userRepository.findByIdAndOrgId(r.assignedUserId(), orgId)
                    .orElseThrow(() -> NotFoundException.of("User", r.assignedUserId()));
            if ("provider".equals(u.getRole())) throw new BadRequestException("Enrollments can only be assigned to staff users");
        }
        e.setProviderId(provider.getId());
        e.setPayerId(payer.getId());
        e.setPracticeId(practiceId);
        e.setFormId(r.formId());
        if (r.status() != null) e.setStatus(r.status());
        else if (creating) e.setStatus("draft");
        if (r.applicationType() != null) e.setApplicationType(r.applicationType());
        else if (creating) e.setApplicationType("initial");
        e.setSubmittedDate(r.submittedDate());
        // the approved date: required when the status is Approved (today when a quick status change leaves it out)
        LocalDate approved = r.effectiveDate();
        if ("approved".equals(e.getStatus()) && approved == null) approved = LocalDate.now();
        e.setEffectiveDate(approved);
        // follow-up and estimated approval dates: today or later (an unchanged earlier date is left alone)
        LocalDate today = LocalDate.now();
        if (!"approved".equals(e.getStatus()) && r.followUpDate() != null && !r.followUpDate().equals(e.getFollowUpDate()) && r.followUpDate().isBefore(today)) {
            throw BadRequestException.onField("followUpDate", "Choose today or a later date");
        }
        if (!"approved".equals(e.getStatus()) && r.estApprovedDate() != null && !r.estApprovedDate().equals(e.getEstApprovedDate()) && r.estApprovedDate().isBefore(today)) {
            throw BadRequestException.onField("estApprovedDate", "Choose today or a later date");
        }
        // an approved enrollment has no follow-up / estimated approval date
        boolean approvedNow = "approved".equals(e.getStatus());
        e.setFollowUpDate(approvedNow ? null : r.followUpDate());
        e.setEstApprovedDate(approvedNow ? null : r.estApprovedDate());
        // always recomputed: clearing a date clears the TAT (prototype kept a stale value)
        e.setTatDays(EnrollmentSupport.tat(r.submittedDate(), r.effectiveDate()));
        e.setNotes(blankToNull(r.notes()));
        e.setAssignedUserId(r.assignedUserId());
    }

    private void afterStatusChange(Enrollment e, String oldStatus) {
        String now = e.getStatus();
        if (Objects.equals(oldStatus, now)) return;
        // Enrollment Mail Templates: the provider is emailed when the enrollment is approved
        if ("approved".equals(now)) mailTemplateService.sendEnrollmentApproved(e);
        String type = switch (now) {
            case "submitted" -> "submitted";
            case "approved" -> "approved";
            case "terminated" -> "terminated";
            default -> "status_change";
        };
        support.addEvent(e.getId(), type,
                "Status changed from " + EnrollmentSupport.statusLabel(oldStatus) + " to " + EnrollmentSupport.statusLabel(now), null);
        if ("approved".equals(now) || "needs_attention".equals(now)) {
            Provider p = support.provider(e.getProviderId(), e.getOrgId());
            Payer payer = support.payer(e.getPayerId());
            boolean ok = "approved".equals(now);
            notificationService.notifyOrg(e.getOrgId(),
                    ok ? "Enrollment approved" : "Enrollment needs attention",
                    EnrollmentSupport.fullName(p) + " — " + payer.getName(),
                    ok ? "CheckCircle" : "AlertTriangle",
                    ok ? NotificationService.SUCCESS : NotificationService.WARN);
        }
    }

    private static boolean matches(Enrollment e, Ctx ctx, String q) {
        Payer payer = ctx.payers().get(e.getPayerId());
        var provider = ctx.providers().get(e.getProviderId());
        return com.zmartcredential.util.SearchText.matches(q, ctx.providerName(e.getProviderId()), payer == null ? null : payer.getName(),
                payer == null ? null : payer.getFullName(), ctx.practices().get(e.getPracticeId()),
                provider == null ? null : provider.getNpi(), e.getStatus());
    }

    private static boolean contains(String s, String q) {
        return s != null && s.toLowerCase(Locale.ROOT).contains(q);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static Comparator<Enrollment> comparator(String sort, Ctx ctx) {
        String field = "createdAt";
        boolean desc = true;
        if (sort != null && !sort.isBlank()) {
            String[] parts = sort.split(",");
            field = parts[0].trim();
            desc = parts.length > 1 && "desc".equalsIgnoreCase(parts[1].trim());
        }
        Function<Enrollment, Comparable> key = switch (field) {
            case "providerName" -> e -> lower(ctx.providerName(e.getProviderId()));
            case "payerName" -> e -> lower(ctx.payerName(e.getPayerId()));
            case "practiceName" -> e -> lower(ctx.practices().get(e.getPracticeId()));
            case "status" -> Enrollment::getStatus;
            case "submittedDate" -> Enrollment::getSubmittedDate;
            case "effectiveDate" -> Enrollment::getEffectiveDate;
            case "tatDays" -> e -> EnrollmentSupport.tat(e.getSubmittedDate(), e.getEffectiveDate());
            case "updatedAt" -> Enrollment::getUpdatedAt;
            default -> Enrollment::getCreatedAt;
        };
        Comparator<Comparable> order = desc ? Comparator.reverseOrder() : Comparator.naturalOrder();
        Comparator<Enrollment> c = Comparator.comparing(key, Comparator.nullsLast(order));
        return c.thenComparing(Enrollment::getId, Comparator.reverseOrder());
    }

    private static String lower(String s) {
        return s == null ? null : s.toLowerCase(Locale.ROOT);
    }

    private List<EnrollmentEventResponse> events(Long enrollmentId) {
        List<EnrollmentEventResponse> list = new ArrayList<>(eventRepository.findByEnrollmentIdOrderByOccurredAtAsc(enrollmentId)
                .stream().map(EnrollmentService::toEventResponse).toList());
        java.util.Collections.reverse(list);
        return list;
    }

    public EnrollmentResponse toResponse(Enrollment e) {
        return toResponses(List.of(e), context(e.getOrgId())).get(0);
    }

    public List<EnrollmentResponse> toResponses(Collection<Enrollment> list, Ctx ctx) {
        if (list.isEmpty()) return List.of();
        List<Long> ids = list.stream().map(Enrollment::getId).toList();
        List<EnrollmentFile> allFiles = fileRepository.findByEnrollmentIdIn(ids);
        Map<Long, Long> fileCounts = allFiles.stream()
                .collect(Collectors.groupingBy(EnrollmentFile::getEnrollmentId, Collectors.counting()));
        // the latest acknowledgement file of each enrollment
        Map<Long, EnrollmentFile> acks = new java.util.HashMap<>();
        for (EnrollmentFile f : allFiles) {
            if (!"acknowledgement".equals(f.getFileType()) || f.getStorageKey() == null) continue;
            EnrollmentFile cur = acks.get(f.getEnrollmentId());
            if (cur == null || (f.getUploadedAt() != null && (cur.getUploadedAt() == null || f.getUploadedAt().isAfter(cur.getUploadedAt())))) acks.put(f.getEnrollmentId(), f);
        }
        Map<Long, List<EnrollmentEvent>> events = eventRepository.findByEnrollmentIdIn(ids).stream()
                .collect(Collectors.groupingBy(EnrollmentEvent::getEnrollmentId));
        return list.stream().map(e -> {
            Provider p = ctx.providers().get(e.getProviderId());
            Payer payer = ctx.payers().get(e.getPayerId());
            List<EnrollmentEvent> evs = events.getOrDefault(e.getId(), List.of());
            LocalDateTime last = evs.stream().map(EnrollmentEvent::getOccurredAt).filter(Objects::nonNull)
                    .max(Comparator.naturalOrder()).orElse(null);
            return new EnrollmentResponse(e.getId(), e.getProviderId(), EnrollmentSupport.fullName(p), p == null ? null : p.getNpi(),
                    e.getPayerId(), payer == null ? null : payer.getName(), payer == null ? null : payer.getColor(),
                    e.getPracticeId(), ctx.practices().get(e.getPracticeId()),
                    e.getFormId(), e.getFormId() == null ? null : ctx.forms().get(e.getFormId()),
                    e.getApplicationType(), e.getStatus(), e.getSubmittedDate(), e.getEffectiveDate(),
                    EnrollmentSupport.tat(e.getSubmittedDate(), e.getEffectiveDate()), e.getNotes(),
                    e.getAssignedUserId(), e.getAssignedUserId() == null ? null : ctx.users().get(e.getAssignedUserId()),
                    fileCounts.getOrDefault(e.getId(), 0L).intValue(), evs.size(), last, e.getCreatedAt(), e.getUpdatedAt(),
                    e.getFollowUpDate(), e.getEstApprovedDate(), e.getNotesUpdatedAt(), e.getNotesUpdatedBy(),
                    acks.containsKey(e.getId()) ? acks.get(e.getId()).getId() : null,
                    acks.containsKey(e.getId()) ? acks.get(e.getId()).getName() : null,
                    acks.containsKey(e.getId()) ? acks.get(e.getId()).getMimeType() : null);
        }).toList();
    }

    private static EnrollmentFileResponse toFileResponse(EnrollmentFile f, Map<Long, String> users) {
        return new EnrollmentFileResponse(f.getId(), f.getEnrollmentId(), f.getName(), f.getFileType(), f.getMimeType(),
                f.getSizeBytes(), f.getStorageKey() != null, f.getUploadedAt(), f.getUploadedBy(),
                f.getUploadedBy() == null ? null : users.get(f.getUploadedBy()));
    }

    public static EnrollmentEventResponse toEventResponse(EnrollmentEvent ev) {
        return new EnrollmentEventResponse(ev.getId(), ev.getEnrollmentId(), ev.getEventType(), ev.getOccurredAt(),
                ev.getActorUserId(), ev.getActorLabel(), ev.getNote(), ev.getConfirmationNumber());
    }
}
