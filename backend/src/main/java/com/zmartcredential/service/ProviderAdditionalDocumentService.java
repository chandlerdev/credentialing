package com.zmartcredential.service;

import com.zmartcredential.entity.DocumentType;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.entity.ProviderAdditionalDocument;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderDocumentPatchRequest;
import com.zmartcredential.repository.ProviderAdditionalDocumentRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.PermissionService;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * My Documents → Add More Document: a provider adds extra documents. The document type is a name the provider
 * types (required); expiration date and notes are optional. Staff see them on the provider's page. Access: the provider for their own record,
 * staff of the provider's organization.
 */
@Service
@RequiredArgsConstructor
public class ProviderAdditionalDocumentService {

    private final ProviderAdditionalDocumentRepository repository;
    private final ProviderModuleSupport support;
    private final FileStorageService fileStorageService;
    private final NotificationService notificationService;
    private final AuthContext authContext;
    private final PermissionService permissionService;

    /** The same file types as the regular document upload: PDF, Word, JPG or PNG. */
    private static final java.util.Set<String> ALLOWED_EXT = java.util.Set.of("pdf", "doc", "docx", "jpg", "jpeg", "png");

    private static void checkFileType(MultipartFile file) {
        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename();
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1).toLowerCase(java.util.Locale.ROOT);
        if (!ALLOWED_EXT.contains(ext)) throw BadRequestException.onField("file", "Only PDF, Word, JPG or PNG files can be uploaded");
    }

    public record AdditionalDocumentItem(Long id, Long providerId, String docType, String docTypeLabel, String title,
                                         String notes, LocalDate expiresAt, String fileName, String mimeType, Long sizeBytes,
                                         String status, LocalDateTime uploadedAt, LocalDateTime notesUpdatedAt,
                                         String notesUpdatedBy) {
    }

    @Transactional(readOnly = true)
    public List<AdditionalDocumentItem> list(Long providerId) {
        Provider p = support.loadAccessible(providerId);
        Map<String, DocumentType> types = support.docTypes();
        return repository.findByProviderIdOrderByUploadedAtDesc(p.getId()).stream().map(d -> toItem(d, types)).toList();
    }

    @Transactional
    public AdditionalDocumentItem add(Long providerId, MultipartFile file, String docType, String title, String notes, String expiresAt) {
        Provider p = support.loadAccessible(providerId);
        Map<String, DocumentType> types = support.docTypes();
        if (docType == null || docType.isBlank()) throw BadRequestException.onField("docType", "Document Type is required");
        if (docType.trim().length() > 150) throw BadRequestException.onField("docType", "At most 150 characters");
        if (file == null || file.isEmpty()) throw BadRequestException.onField("file", "Choose the file to upload");
        checkFileType(file);
        LocalDate exp = ProviderDocumentService.parseDate(expiresAt);
        if (exp != null && exp.isBefore(LocalDate.now())) throw BadRequestException.onField("expiresAt", "Choose today or a later date");
        if (title != null && title.length() > 200) throw BadRequestException.onField("title", "At most 200 characters");
        if (notes != null && notes.length() > 1000) throw BadRequestException.onField("notes", "At most 1000 characters");
        ProviderAdditionalDocument d = new ProviderAdditionalDocument();
        d.setOrgId(p.getOrgId());
        d.setProviderId(p.getId());
        d.setDocType(docType.trim());
        d.setTitle(title == null || title.isBlank() ? null : title.trim());
        d.setNotes(notes == null || notes.isBlank() ? null : notes.trim());
        d.setExpiresAt(exp);
        d.setStorageKey(fileStorageService.store(p.getOrgId(), file));
        String name = file.getOriginalFilename();
        if (name != null) {
            name = name.replace('\\', '/');
            name = name.substring(name.lastIndexOf('/') + 1);
            if (name.length() > 255) name = name.substring(name.length() - 255);
        }
        d.setFileName(name);
        d.setMimeType(file.getContentType() == null ? null : file.getContentType().substring(0, Math.min(100, file.getContentType().length())));
        d.setSizeBytes(file.getSize());
        d.setUploadedBy(authContext.userId());
        d.setUploadedAt(LocalDateTime.now());
        d.setStatus("pending_review");
        d = repository.save(d);
        if (p.getOrgId() != null) {
            String who = ((p.getFirstName() == null ? "" : p.getFirstName()) + " " + (p.getLastName() == null ? "" : p.getLastName())).trim();
            notificationService.notifyOrg(p.getOrgId(), "Additional document added",
                    d.getDocType() + " added for " + who + ".", "FilePlus", NotificationService.INFO);
        }
        return toItem(d, types);
    }

    /**
     * Replace the file of an additional document (the provider for their own documents, or staff). The new file
     * waits for review again; a new expiration date may be given.
     */
    @Transactional
    public AdditionalDocumentItem replaceFile(Long id, MultipartFile file, String expiresAt) {
        ProviderAdditionalDocument d = repository.findById(id).orElseThrow(() -> NotFoundException.of("Document", id));
        Provider p = support.loadAccessible(d.getProviderId());
        if (file == null || file.isEmpty()) throw BadRequestException.onField("file", "Choose the file to upload");
        checkFileType(file);
        LocalDate exp = ProviderDocumentService.parseDate(expiresAt);
        if (exp != null && exp.isBefore(LocalDate.now())) throw BadRequestException.onField("expiresAt", "Choose today or a later date");
        String oldKey = d.getStorageKey();
        d.setStorageKey(fileStorageService.store(p.getOrgId(), file));
        d.setFileName(cleanName(file.getOriginalFilename()));
        d.setMimeType(file.getContentType() == null ? null : file.getContentType().substring(0, Math.min(100, file.getContentType().length())));
        d.setSizeBytes(file.getSize());
        if (exp != null) d.setExpiresAt(exp);
        d.setUploadedBy(authContext.userId());
        d.setUploadedAt(LocalDateTime.now());
        d.setStatus("pending_review");
        d = repository.saveAndFlush(d);
        if (oldKey != null && !oldKey.equals(d.getStorageKey())) fileStorageService.delete(oldKey);
        if (p.getOrgId() != null && authContext.principal().isProvider()) {
            String who = ((p.getFirstName() == null ? "" : p.getFirstName()) + " " + (p.getLastName() == null ? "" : p.getLastName())).trim();
            notificationService.notifyOrg(p.getOrgId(), "Additional document replaced",
                    d.getDocType() + " replaced by " + who + ".", "FilePlus", NotificationService.INFO);
        }
        return toItem(d, support.docTypes());
    }

    private static String cleanName(String name) {
        if (name == null) return null;
        name = name.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1);
        return name.length() > 255 ? name.substring(name.length() - 255) : name;
    }

    /** Staff review, as for the regular documents: status (approve / reject / N/A) and expiration date. */
    @Transactional
    public AdditionalDocumentItem patch(Long id, ProviderDocumentPatchRequest req) {
        permissionService.require("document", "update");
        authContext.requireStaff();
        ProviderAdditionalDocument d = loadForStaff(id);
        if (Boolean.TRUE.equals(req.clearExpiresAt())) d.setExpiresAt(null);
        else if (req.expiresAt() != null) {
            if (!req.expiresAt().equals(d.getExpiresAt()) && req.expiresAt().isBefore(LocalDate.now())) {
                throw new BadRequestException("The expiration date can't be in the past");
            }
            d.setExpiresAt(req.expiresAt());
        }
        if (req.status() != null) {
            d.setStatus(req.status());
        } else if (req.expiresAt() != null && ("approved".equals(d.getStatus()) || "expired".equals(d.getStatus()))) {
            d.setStatus(d.getExpiresAt().isBefore(LocalDate.now()) ? "expired" : "approved");
        }
        return toItem(repository.save(d), support.docTypes());
    }

    /** Staff notes on an additional document. */
    @Transactional
    public AdditionalDocumentItem saveNotes(Long id, String notes) {
        permissionService.require("document", "update");
        authContext.requireStaff();
        ProviderAdditionalDocument d = loadForStaff(id);
        String value = notes == null || notes.isBlank() ? null : notes.strip();
        if (!java.util.Objects.equals(value, d.getNotes())) {
            d.setNotes(value);
            d.setNotesUpdatedAt(LocalDateTime.now());
            d.setNotesUpdatedBy(ProviderDocumentService.actorName(authContext.principal()));
            repository.save(d);
        }
        return toItem(d, support.docTypes());
    }

    /** Staff remove an additional document (marked deleted). */
    @Transactional
    public void delete(Long id) {
        permissionService.require("document", "delete");
        authContext.requireStaff();
        repository.delete(loadForStaff(id));
    }

    private ProviderAdditionalDocument loadForStaff(Long id) {
        ProviderAdditionalDocument d = repository.findById(id).orElseThrow(() -> NotFoundException.of("Document", id));
        support.loadAccessible(d.getProviderId()); // staff of the provider's organization
        return d;
    }

    @Transactional(readOnly = true)
    public ProviderDocumentService.DownloadedFile download(Long id) {
        ProviderAdditionalDocument d = repository.findById(id).orElseThrow(() -> NotFoundException.of("Document", id));
        support.loadAccessible(d.getProviderId()); // the provider themself or staff of their organization
        return new ProviderDocumentService.DownloadedFile(fileStorageService.load(d.getStorageKey()),
                d.getFileName() == null ? "document" : d.getFileName(), d.getMimeType());
    }

    private static AdditionalDocumentItem toItem(ProviderAdditionalDocument d, Map<String, DocumentType> types) {
        DocumentType t = types.get(d.getDocType());
        return new AdditionalDocumentItem(d.getId(), d.getProviderId(), d.getDocType(), t == null ? d.getDocType() : t.getLabel(),
                d.getTitle(), d.getNotes(), d.getExpiresAt(), d.getFileName(), d.getMimeType(), d.getSizeBytes(), d.getStatus(), d.getUploadedAt(),
                d.getNotesUpdatedAt(), d.getNotesUpdatedBy());
    }
}
