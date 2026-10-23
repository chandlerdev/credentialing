package com.zmartcredential.service;

import com.zmartcredential.repository.PayerRepository;
import com.zmartcredential.entity.Payer;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderBatchFileResult;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderClassification;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderDocumentPatchRequest;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderDocumentRow;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderUploadResult;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderUploadedFile;
import com.zmartcredential.entity.DocumentType;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.entity.ProviderDocument;
import com.zmartcredential.exception.ApiException;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.ProviderDocumentRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.AuthPrincipal;
import com.zmartcredential.security.PermissionService;
import com.zmartcredential.util.DocTypeGuesser;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import static com.zmartcredential.service.ProviderModuleSupport.blankToNull;
import static com.zmartcredential.service.ProviderModuleSupport.fullName;

@Service
@RequiredArgsConstructor
public class ProviderDocumentService {

    private static final Set<String> UPLOAD_STATUSES = Set.of("approved", "pending_review", "expired");

    private final ProviderDocumentRepository documentRepository;
    private final PayerRepository payerRepository;
    private final FileStorageService fileStorageService;
    private final NotificationService notificationService;
    private final PermissionService permissionService;
    private final ProviderModuleSupport support;
    private final AuthContext authContext;

    public record DownloadedFile(Resource resource, String fileName, String mimeType) {
    }

    @Transactional
    public List<ProviderDocumentRow> list(Long providerId) {
        permissionService.require("document", "read");
        return support.documentRows(support.loadAccessible(providerId));
    }

    @Transactional(readOnly = true)
    public List<ProviderClassification> classify(Long providerId, List<String> fileNames) {
        permissionService.require("document", "create");
        support.loadAccessible(providerId);
        Map<String, DocumentType> types = support.docTypes();
        return fileNames.stream().map(n -> {
            String code = DocTypeGuesser.guess(n);
            if (code != null && !types.containsKey(code)) code = null;
            return new ProviderClassification(n, code, code == null ? null : types.get(code).getLabel(), "filename");
        }).toList();
    }

    @Transactional
    public ProviderUploadResult upload(Long providerId, List<MultipartFile> files, List<String> docTypes,
                                       List<String> expiresAts, List<String> statuses) {
        permissionService.require("document", "create");
        Provider provider = support.loadAccessible(providerId);
        if (files == null || files.isEmpty()) throw new BadRequestException("Choose at least one file to upload");
        Map<String, DocumentType> types = support.docTypes();
        List<String> resolved = new ArrayList<>();
        List<String> classification = new ArrayList<>();
        List<String> unknown = new ArrayList<>();
        List<LocalDate> expiries = new ArrayList<>();
        for (int i = 0; i < files.size(); i++) {
            MultipartFile f = files.get(i);
            if (f == null || f.isEmpty()) throw new BadRequestException("File " + (i + 1) + " is empty");
            String given = docTypes != null && i < docTypes.size() ? blankToNull(docTypes.get(i)) : null;
            String code = given;
            String how = "manual";
            if (code == null) {
                code = DocTypeGuesser.guess(f.getOriginalFilename());
                how = "filename";
            }
            if (code == null) {
                unknown.add(f.getOriginalFilename());
            } else if (!types.containsKey(code)) {
                throw new BadRequestException("Unknown document type '" + code + "'");
            }
            resolved.add(code);
            classification.add(how);
            LocalDate exp = parseDate(expiresAts != null && i < expiresAts.size() ? expiresAts.get(i) : null);
            DocumentType t = code == null ? null : types.get(code);
            boolean typeExpires = t != null && Boolean.TRUE.equals(t.getExpires());
            if (!typeExpires) exp = null; // e.g. certificates: no expiration date
            if (exp != null && exp.isBefore(LocalDate.now())) {
                throw new BadRequestException("Expiration date of " + f.getOriginalFilename() + " cannot be in the past");
            }
            if (typeExpires && exp == null) {
                throw new BadRequestException("Enter the expiration date of " + f.getOriginalFilename());
            }
            expiries.add(exp);
            String st = statuses != null && i < statuses.size() ? blankToNull(statuses.get(i)) : null;
            if (st != null && !UPLOAD_STATUSES.contains(st)) throw new BadRequestException("Unknown document status '" + st + "'");
        }
        if (!unknown.isEmpty()) {
            throw new BadRequestException("Could not determine the document type of " + String.join(", ", unknown)
                    + " from the file name. Choose a document type for each file.");
        }
        boolean staff = !authContext.principal().isProvider();
        List<ProviderUploadedFile> uploaded = new ArrayList<>();
        for (int i = 0; i < files.size(); i++) {
            ProviderDocument d = storeInto(provider, resolved.get(i), files.get(i), expiries.get(i), staff, null,
                    authContext.userId());
            // Staff can set the status in "Verify Document Classification"; provider uploads always await review.
            String chosen = statuses != null && i < statuses.size() ? blankToNull(statuses.get(i)) : null;
            if (staff && chosen != null) {
                d.setStatus(chosen);
                documentRepository.save(d);
            }
            uploaded.add(new ProviderUploadedFile(d.getFileName(), d.getDocType(), types.get(d.getDocType()).getLabel(),
                    classification.get(i), d.getStatus()));
        }
        notifyUpload(provider, uploaded.size(), staff ? "Documents uploaded" : "Provider uploaded documents");
        return new ProviderUploadResult(uploaded, support.documentRows(provider));
    }

    @Transactional
    public List<ProviderBatchFileResult> batch(Long providerId, List<MultipartFile> files, List<String> relativePaths,
                                               List<String> docTypes, Long payerId) {
        permissionService.require("document", "create");
        Provider provider = support.loadAccessible(providerId);
        if (files == null || files.isEmpty()) throw new BadRequestException("Choose at least one file to upload");
        // Folder Sync's "Target Payer Portal" (prototype v3: private payers only) — recorded with the upload.
        Payer payer = payerId == null ? null : payerRepository.findById(payerId)
                .orElseThrow(() -> NotFoundException.of("Payer", payerId));
        if (payer != null && !EnrollmentSupport.isPrivatePayer(payer)) {
            throw new BadRequestException(payer.getName() + " is not a private payer portal");
        }
        Map<String, DocumentType> types = support.docTypes();
        boolean staff = !authContext.principal().isProvider();
        Set<String> usedTypes = new HashSet<>();
        List<ProviderBatchFileResult> results = new ArrayList<>();
        int uploadedCount = 0;
        for (int i = 0; i < files.size(); i++) {
            MultipartFile f = files.get(i);
            String rel = relativePaths != null && i < relativePaths.size() ? blankToNull(relativePaths.get(i)) : null;
            if (rel != null && rel.length() > 500) rel = rel.substring(rel.length() - 500);
            String name = f == null ? null : f.getOriginalFilename();
            String given = docTypes != null && i < docTypes.size() ? blankToNull(docTypes.get(i)) : null;
            String code = given != null ? given : DocTypeGuesser.guess(rel != null ? rel : name);
            if (f == null || f.isEmpty()) {
                results.add(new ProviderBatchFileResult(name, rel, code, label(types, code), "skipped", "File is empty"));
                continue;
            }
            if (code == null) {
                results.add(new ProviderBatchFileResult(name, rel, null, null, "skipped",
                        "Could not determine the document type from the file name"));
                continue;
            }
            if (!types.containsKey(code)) {
                results.add(new ProviderBatchFileResult(name, rel, code, null, "skipped", "Unknown document type"));
                continue;
            }
            if (!usedTypes.add(code)) {
                results.add(new ProviderBatchFileResult(name, rel, code, label(types, code), "skipped",
                        "Another file in this batch was already used for " + label(types, code)));
                continue;
            }
            try {
                storeInto(provider, code, f, null, staff, rel, authContext.userId());
                results.add(new ProviderBatchFileResult(name, rel, code, label(types, code), "uploaded", null));
                uploadedCount++;
            } catch (ApiException e) {
                usedTypes.remove(code);
                results.add(new ProviderBatchFileResult(name, rel, code, label(types, code), "skipped", e.getMessage()));
            }
        }
        if (uploadedCount > 0 && payer != null && provider.getOrgId() != null) {
            notificationService.notifyOrg(provider.getOrgId(), "Documents synced for " + payer.getName(),
                    uploadedCount + " document(s) uploaded for " + fullName(provider) + " for the " + payer.getName()
                            + " portal submission.", "FileUp", NotificationService.SUCCESS);
        } else if (uploadedCount > 0) {
            notifyUpload(provider, uploadedCount, "Documents synced from folder");
        }
        return results;
    }

    @Transactional
    public ProviderDocumentRow patch(Long docId, ProviderDocumentPatchRequest req) {
        permissionService.require("document", "update");
        authContext.requireStaff();
        ProviderDocument d = loadDoc(docId);
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
        documentRepository.save(d);
        return support.toRow(d, support.docTypes().get(d.getDocType()));
    }

    /** Staff notes on a document (why it is pending / on hold, what the provider said). */
    @Transactional
    public ProviderDocumentRow saveNotes(Long docId, String notes) {
        permissionService.require("document", "update");
        authContext.requireStaff();
        ProviderDocument d = loadDoc(docId);
        String value = notes == null || notes.isBlank() ? null : notes.strip();
        if (!Objects.equals(value, d.getNotes())) {
            d.setNotes(value);
            d.setNotesUpdatedAt(LocalDateTime.now());
            d.setNotesUpdatedBy(actorName(authContext.principal()));
            documentRepository.save(d);
        }
        return support.toRow(d, support.docTypes().get(d.getDocType()));
    }

    static String actorName(AuthPrincipal p) {
        String n = p.displayName() != null && !p.displayName().isBlank() ? p.displayName() : p.username();
        return n == null ? null : n.length() > 120 ? n.substring(0, 120) : n;
    }

    @Transactional(readOnly = true)
    public DownloadedFile download(Long docId) {
        // a provider can always open their own files (loadDoc only finds their own documents)
        if (!authContext.principal().isProvider()) permissionService.require("document", "read");
        ProviderDocument d = loadDoc(docId);
        if (d.getStorageKey() == null) throw new NotFoundException("No file has been uploaded for this document");
        return new DownloadedFile(fileStorageService.load(d.getStorageKey()),
                d.getFileName() == null ? "document" : d.getFileName(), d.getMimeType());
    }

    @Transactional
    public ProviderDocumentRow deleteFile(Long docId) {
        permissionService.require("document", "delete");
        authContext.requireStaff();
        ProviderDocument d = loadDoc(docId);
        clearFile(d);
        return support.toRow(d, support.docTypes().get(d.getDocType()));
    }

    /** The provider's checklist row of a document type. */
    java.util.Optional<ProviderDocument> providerDocument(Provider provider, String docType) {
        return documentRepository.findByProviderIdAndDocType(provider.getId(), docType);
    }

    /** The document goes back to Missing and its file is deleted (no permission checks: callers check access). */
    void clearFile(ProviderDocument d) {
        String key = d.getStorageKey();
        d.setStorageKey(null);
        d.setFileName(null);
        d.setMimeType(null);
        d.setSizeBytes(null);
        d.setOriginalRelativePath(null);
        d.setUploadedAt(null);
        d.setUploadedBy(null);
        d.setExpiresAt(null);
        d.setStatus("missing");
        documentRepository.save(d);
        documentRepository.flush();
        fileStorageService.delete(key);
    }

    /**
     * Stores the file and points the provider's checklist row at it (replacing a previous file).
     * Staff uploads are approved; provider / secure-link uploads await review. Past expiration -> expired.
     */
    ProviderDocument storeInto(Provider provider, String docType, MultipartFile file, LocalDate expiresAt,
                               boolean approve, String relativePath, Long userId) {
        String key = fileStorageService.store(provider.getOrgId(), file);
        ProviderDocument d = documentRepository.findByProviderIdAndDocType(provider.getId(), docType).orElseGet(() -> {
            ProviderDocument n = new ProviderDocument();
            n.setOrgId(provider.getOrgId());
            n.setProviderId(provider.getId());
            n.setDocType(docType);
            return n;
        });
        String oldKey = d.getStorageKey();
        String name = file.getOriginalFilename();
        if (name != null) {
            name = name.replace('\\', '/');
            name = name.substring(name.lastIndexOf('/') + 1);
            if (name.length() > 255) name = name.substring(name.length() - 255);
        }
        d.setFileName(name);
        d.setStorageKey(key);
        d.setMimeType(file.getContentType() == null ? null
                : file.getContentType().substring(0, Math.min(100, file.getContentType().length())));
        d.setSizeBytes(file.getSize());
        d.setOriginalRelativePath(relativePath);
        d.setExpiresAt(expiresAt);
        d.setUploadedAt(LocalDateTime.now());
        d.setUploadedBy(userId);
        if (expiresAt != null && expiresAt.isBefore(LocalDate.now())) d.setStatus("expired");
        else d.setStatus(approve ? "approved" : "pending_review");
        documentRepository.save(d);
        if (oldKey != null && !oldKey.equals(key)) fileStorageService.delete(oldKey);
        return d;
    }

    void notifyUpload(Provider provider, int count, String title) {
        if (provider.getOrgId() == null || count == 0) return;
        notificationService.notifyOrg(provider.getOrgId(), title,
                count + " document(s) uploaded for " + fullName(provider) + ".", "FileUp", NotificationService.SUCCESS);
    }

    private ProviderDocument loadDoc(Long docId) {
        AuthPrincipal p = authContext.principal();
        ProviderDocument d;
        if (p.isProvider()) {
            d = documentRepository.findById(docId)
                    .filter(x -> Objects.equals(x.getProviderId(), p.providerId())
                            && Objects.equals(x.getOrgId(), p.orgId()))
                    .orElseThrow(() -> NotFoundException.of("Document", docId));
        } else {
            d = documentRepository.findByIdAndOrgId(docId, authContext.orgId())
                    .orElseThrow(() -> NotFoundException.of("Document", docId));
        }
        return d;
    }

    private static String label(Map<String, DocumentType> types, String code) {
        DocumentType t = code == null ? null : types.get(code);
        return t == null ? null : t.getLabel();
    }

    static LocalDate parseDate(String s) {
        String v = blankToNull(s);
        if (v == null) return null;
        try {
            return LocalDate.parse(v);
        } catch (DateTimeParseException e) {
            throw new BadRequestException("Invalid expiration date '" + v + "' (use YYYY-MM-DD)");
        }
    }
}
