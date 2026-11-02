package com.zmartcredential.service;

import com.zmartcredential.config.AppProperties;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.NotFoundException;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;

/**
 * Stores uploaded files: in OneDrive / SharePoint when the super admin turned it on (Storage), else on local disk under
 * app.storage.path. Disk keys are relative paths ("org-1/2026/10/uuid.pdf"); OneDrive keys are "onedrive:{drive}:{item}".
 * Files already stored keep working wherever they are. If OneDrive refuses an upload the file is kept on disk (nothing
 * is lost) and the error is shown on the Storage page.
 */
@lombok.extern.slf4j.Slf4j
@Service
public class FileStorageService {

    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            "pdf", "png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "doc", "docx", "xls", "xlsx", "csv", "txt", "heic");

    private final Path root;
    private final OneDriveService oneDrive;
    private final com.zmartcredential.repository.OrganizationRepository organizationRepository;

    public FileStorageService(AppProperties props, OneDriveService oneDrive, com.zmartcredential.repository.OrganizationRepository organizationRepository) throws IOException {
        this.root = Path.of(props.storage().path()).toAbsolutePath().normalize();
        this.oneDrive = oneDrive;
        this.organizationRepository = organizationRepository;
        Files.createDirectories(root);
    }

    public String store(Long orgId, MultipartFile file) {
        return store(orgId, file, "Other", null);
    }

    /**
     * subPath / fileName: where the file goes in OneDrive below {folder}/{organization} (e.g. "Providers/Jane Doe (NPI
     * 123)/Documents", "License - scan.pdf"); not used on disk.
     */
    public String store(Long orgId, MultipartFile file, String subPath, String fileName) {
        if (file == null || file.isEmpty()) throw new BadRequestException("File is empty");
        String ext = extension(file.getOriginalFilename());
        if (!ALLOWED_EXTENSIONS.contains(ext)) {
            throw new BadRequestException("File type ." + ext + " is not allowed");
        }
        if (oneDrive.active()) {
            String org = orgId == null ? "No organization" : organizationRepository.findById(orgId).map(o -> o.getName()).orElse("Organization " + orgId);
            String name = fileName == null || fileName.isBlank() ? file.getOriginalFilename() : fileName;
            if (name != null && !name.toLowerCase().endsWith("." + ext)) name = name + "." + ext;
            String where = OneDriveService.cleanName(org) + "/" + java.util.Arrays.stream((subPath == null ? "Other" : subPath).split("/"))
                    .map(OneDriveService::cleanName).collect(java.util.stream.Collectors.joining("/"));
            try (InputStream in = file.getInputStream()) {
                String key = oneDrive.upload(where, name, in, file.getSize());
                oneDrive.recordUpload(where + "/" + OneDriveService.cleanName(name), true, null);
                return key;
            } catch (Exception e) {
                String why = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                log.warn("OneDrive upload of {} failed, kept on the server instead: {}", name, why);
                oneDrive.recordUpload(where + "/" + OneDriveService.cleanName(name == null ? "file" : name), false, why + " — the file was kept on the server");
            }
        }
        LocalDate today = LocalDate.now();
        String key = "org-" + (orgId == null ? "none" : orgId) + "/" + today.getYear() + "/"
                + String.format("%02d", today.getMonthValue()) + "/" + UUID.randomUUID() + "." + ext;
        Path target = resolve(key);
        try (InputStream in = file.getInputStream()) {
            Files.createDirectories(target.getParent());
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new IllegalStateException("Could not store file", e);
        }
        return key;
    }

    public Resource load(String key) {
        if (key == null) throw new NotFoundException("No file has been uploaded");
        if (key.startsWith(OneDriveService.KEY_PREFIX)) {
            try {
                return new ByteArrayResource(oneDrive.download(key));
            } catch (NotFoundException e) {
                throw e;
            } catch (Exception e) {
                throw new IllegalStateException("Could not open the file from OneDrive: " + e.getMessage(), e);
            }
        }
        Path path = resolve(key);
        if (!Files.exists(path)) throw new NotFoundException("File not found");
        return new FileSystemResource(path);
    }

    public void delete(String key) {
        if (key == null) return;
        if (key.startsWith(OneDriveService.KEY_PREFIX)) {
            oneDrive.delete(key);
            return;
        }
        try {
            Files.deleteIfExists(resolve(key));
        } catch (IOException ignored) {
            // orphaned files are harmless
        }
    }

    /** The provider's OneDrive folder: "Providers/Jane Doe, MD (NPI 1234567890)". */
    public static String providerFolder(com.zmartcredential.entity.Provider p) {
        if (p == null) return "Providers/Unknown provider";
        String name = ((p.getFirstName() == null ? "" : p.getFirstName()) + " " + (p.getLastName() == null ? "" : p.getLastName())).trim();
        if (p.getSuffix() != null && !p.getSuffix().isBlank()) name += ", " + p.getSuffix().trim();
        if (name.isBlank()) name = "Provider " + p.getId();
        return "Providers/" + name + (p.getNpi() == null || p.getNpi().isBlank() ? "" : " (NPI " + p.getNpi().trim() + ")");
    }

    /** "medical_license" → "Medical License" (a readable prefix for the file name in OneDrive). */
    public static String label(String code) {
        if (code == null || code.isBlank()) return "Document";
        return java.util.Arrays.stream(code.trim().replace('_', ' ').split("\s+"))
                .map(w -> w.isEmpty() ? w : Character.toUpperCase(w.charAt(0)) + w.substring(1))
                .collect(java.util.stream.Collectors.joining(" "));
    }

    private Path resolve(String key) {
        Path p = root.resolve(key).normalize();
        if (!p.startsWith(root)) throw new BadRequestException("Invalid file key");
        return p;
    }

    private static String extension(String name) {
        if (name == null || !name.contains(".")) return "";
        return name.substring(name.lastIndexOf('.') + 1).toLowerCase();
    }
}
