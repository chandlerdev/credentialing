package com.zmartcredential.controller;

import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderDocumentPatchRequest;
import com.zmartcredential.service.ProviderAdditionalDocumentService;
import jakarta.validation.Valid;
import com.zmartcredential.service.ProviderAdditionalDocumentService.AdditionalDocumentItem;
import com.zmartcredential.service.ProviderDocumentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.nio.charset.StandardCharsets;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** My Documents → Add More Document, and the provider's page (staff). */
@Tag(name = "Additional documents")
@RestController
@RequiredArgsConstructor
public class ProviderAdditionalDocumentController {

    private final ProviderAdditionalDocumentService service;

    @Operation(summary = "Extra documents of a provider")
    @GetMapping("/api/providers/{id:\\d+}/additional-documents")
    public List<AdditionalDocumentItem> list(@PathVariable Long id) {
        return service.list(id);
    }

    @Operation(summary = "Add an extra document (file + document type; title, expiresAt, notes optional)")
    @PostMapping(value = "/api/providers/{id:\\d+}/additional-documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public AdditionalDocumentItem add(@PathVariable Long id, @RequestParam(value = "file", required = false) MultipartFile file,
                                      @RequestParam(value = "docType", required = false) String docType,
                                      @RequestParam(value = "title", required = false) String title,
                                      @RequestParam(value = "notes", required = false) String notes,
                                      @RequestParam(value = "expiresAt", required = false) String expiresAt) {
        return service.add(id, file, docType, title, notes, expiresAt);
    }

    @Operation(summary = "Review an extra document: status and expiration date (staff)")
    @PatchMapping("/api/additional-documents/{id:\\d+}")
    public AdditionalDocumentItem patch(@PathVariable Long id, @Valid @RequestBody ProviderDocumentPatchRequest req) {
        return service.patch(id, req);
    }

    @Operation(summary = "Replace the file of an extra document (expiresAt optional)")
    @PostMapping(value = "/api/additional-documents/{id:\\d+}/file", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public AdditionalDocumentItem replaceFile(@PathVariable Long id, @RequestParam(value = "file", required = false) MultipartFile file,
                                              @RequestParam(value = "expiresAt", required = false) String expiresAt) {
        return service.replaceFile(id, file, expiresAt);
    }

    @Operation(summary = "Remove an extra document (staff)")
    @PutMapping("/api/additional-documents/{id:\\d+}/notes")
    public AdditionalDocumentItem notes(@PathVariable Long id,
                                        @Valid @RequestBody com.zmartcredential.dto.provider.ProviderDocumentDtos.NotesRequest req) {
        return service.saveNotes(id, req.notes());
    }

    @DeleteMapping("/api/additional-documents/{id:\\d+}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        service.delete(id);
    }

    @Operation(summary = "Download / view an extra document")
    @GetMapping("/api/additional-documents/{id:\\d+}/download")
    public ResponseEntity<Resource> download(@PathVariable Long id, @RequestParam(defaultValue = "false") boolean inline) {
        ProviderDocumentService.DownloadedFile f = service.download(id);
        ContentDisposition cd = (inline ? ContentDisposition.inline() : ContentDisposition.attachment())
                .filename(f.fileName(), StandardCharsets.UTF_8).build();
        MediaType type;
        try {
            type = f.mimeType() == null ? MediaType.APPLICATION_OCTET_STREAM : MediaType.parseMediaType(f.mimeType());
        } catch (Exception e) {
            type = MediaType.APPLICATION_OCTET_STREAM;
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, cd.toString())
                .header("X-Content-Type-Options", "nosniff")
                .contentType(type)
                .body(f.resource());
    }
}
