package com.zmartcredential.controller;

import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderBatchFileResult;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderClassification;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderClassifyRequest;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderDocumentPatchRequest;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderDocumentRow;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderUploadResult;
import com.zmartcredential.service.ProviderDocumentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

@Tag(name = "Provider documents")
@RestController
@RequiredArgsConstructor
public class ProviderDocumentController {

    private final ProviderDocumentService documentService;

    @Operation(summary = "Document checklist of a provider (all document types)")
    @GetMapping("/api/providers/{id:\\d+}/documents")
    public List<ProviderDocumentRow> list(@PathVariable Long id) {
        return documentService.list(id);
    }

    @Operation(summary = "Upload documents (multipart files[], optional parallel docType[] / expiresAt[] / status[])")
    @PostMapping(value = "/api/providers/{id:\\d+}/documents/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ProviderUploadResult upload(@PathVariable Long id, @RequestParam("files") List<MultipartFile> files,
                                       HttpServletRequest request) {
        return documentService.upload(id, files, params(request, "docType"), params(request, "expiresAt"),
                params(request, "status"));
    }

    @Operation(summary = "Guess document types from file names (AI classification deferred)")
    @PostMapping("/api/providers/{id:\\d+}/documents/classify")
    public List<ProviderClassification> classify(@PathVariable Long id, @Valid @RequestBody ProviderClassifyRequest req) {
        return documentService.classify(id, req.fileNames());
    }

    @Operation(summary = "Folder sync batch upload (files[] + parallel relativePaths[], optional docType[], optional target payerId)")
    @PostMapping(value = "/api/providers/{id:\\d+}/documents/batch", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public List<ProviderBatchFileResult> batch(@PathVariable Long id, @RequestParam("files") List<MultipartFile> files,
                                               @RequestParam(value = "payerId", required = false) Long payerId,
                                               HttpServletRequest request) {
        return documentService.batch(id, files, params(request, "relativePaths"), params(request, "docType"), payerId);
    }

    @Operation(summary = "Approve / reject / N/A a document or change its expiration date")
    @PatchMapping("/api/documents/{docId:\\d+}")
    public ProviderDocumentRow patch(@PathVariable Long docId, @Valid @RequestBody ProviderDocumentPatchRequest req) {
        return documentService.patch(docId, req);
    }

    @Operation(summary = "Save the staff notes of a document")
    @org.springframework.web.bind.annotation.PutMapping("/api/documents/{docId:\\d+}/notes")
    public ProviderDocumentRow notes(@PathVariable Long docId,
                                     @Valid @RequestBody com.zmartcredential.dto.provider.ProviderDocumentDtos.NotesRequest req) {
        return documentService.saveNotes(docId, req.notes());
    }

    @Operation(summary = "Download the stored file of a document")
    @GetMapping("/api/documents/{docId:\\d+}/download")
    public ResponseEntity<Resource> download(@PathVariable Long docId,
                                             @RequestParam(defaultValue = "false") boolean inline) {
        ProviderDocumentService.DownloadedFile f = documentService.download(docId);
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

    @Operation(summary = "Remove the stored file of a document (status becomes missing)")
    @DeleteMapping("/api/documents/{docId:\\d+}/file")
    public ProviderDocumentRow deleteFile(@PathVariable Long docId) {
        return documentService.deleteFile(docId);
    }

    /** Raw repeated form values (avoids Spring splitting a single comma-containing value into a list). */
    static List<String> params(HttpServletRequest request, String name) {
        String[] values = request.getParameterValues(name);
        if (values == null) values = request.getParameterValues(name + "[]");
        return values == null ? null : Arrays.asList(values);
    }
}
