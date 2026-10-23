package com.zmartcredential.controller;

import com.zmartcredential.common.PageResponse;
import com.zmartcredential.dto.enrollment.EnrollmentDetailResponse;
import com.zmartcredential.dto.enrollment.EnrollmentEventRequest;
import com.zmartcredential.dto.enrollment.EnrollmentEventResponse;
import com.zmartcredential.dto.enrollment.EnrollmentFileResponse;
import com.zmartcredential.dto.enrollment.EnrollmentPatchRequest;
import com.zmartcredential.dto.enrollment.EnrollmentRequest;
import com.zmartcredential.dto.enrollment.EnrollmentResponse;
import com.zmartcredential.dto.enrollment.EnrollmentResubmitRequest;
import com.zmartcredential.dto.enrollment.EnrollmentSummaryResponse;
import com.zmartcredential.dto.payer.FormMappingResponse;
import com.zmartcredential.service.EnrollmentService;
import com.zmartcredential.service.PayerApplicationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;

@Tag(name = "Enrollments")
@RestController
@RequiredArgsConstructor
public class EnrollmentController {

    private final EnrollmentService enrollmentService;
    private final PayerApplicationService payerApplicationService;

    @Operation(summary = "List enrollments (filter, search, sort, page)")
    @GetMapping("/api/enrollments")
    public PageResponse<EnrollmentResponse> list(@RequestParam(required = false) String q,
                                                 @RequestParam(required = false) String status,
                                                 @RequestParam(required = false) Long providerId,
                                                 @RequestParam(required = false) Long payerId,
                                                 @RequestParam(defaultValue = "0") int page,
                                                 @RequestParam(defaultValue = "50") int size,
                                                 @RequestParam(required = false) String sort) {
        return enrollmentService.list(q, status, providerId, payerId, page, size, sort);
    }

    @Operation(summary = "Enrollment counts by status, approved/active totals and average TAT")
    @GetMapping("/api/enrollments/summary")
    public EnrollmentSummaryResponse summary(@RequestParam(required = false) Long providerId) {
        return enrollmentService.summary(providerId);
    }

    @Operation(summary = "Get an enrollment with files and timeline events")
    @GetMapping("/api/enrollments/{id}")
    public EnrollmentDetailResponse get(@PathVariable Long id) {
        return enrollmentService.get(id);
    }

    @Operation(summary = "Create an enrollment")
    @PostMapping("/api/enrollments")
    @ResponseStatus(HttpStatus.CREATED)
    public EnrollmentResponse create(@Valid @RequestBody EnrollmentRequest req) {
        return enrollmentService.create(req);
    }

    @Operation(summary = "Replace an enrollment (status changes are recorded as events)")
    @PutMapping("/api/enrollments/{id}")
    public EnrollmentResponse update(@PathVariable Long id, @Valid @RequestBody EnrollmentRequest req) {
        return enrollmentService.update(id, req);
    }

    @Operation(summary = "Partially update an enrollment (inline edits)")
    @PatchMapping("/api/enrollments/{id}")
    public EnrollmentResponse patch(@PathVariable Long id, @Valid @RequestBody EnrollmentPatchRequest req) {
        return enrollmentService.patch(id, req);
    }

    @Operation(summary = "Delete an enrollment")
    @DeleteMapping("/api/enrollments/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        enrollmentService.delete(id);
    }

    @Operation(summary = "Enrollment timeline (newest first)")
    @GetMapping("/api/enrollments/{id}/events")
    public List<EnrollmentEventResponse> events(@PathVariable Long id) {
        return enrollmentService.listEvents(id);
    }

    @Operation(summary = "Add a note or follow-up to the timeline")
    @PostMapping("/api/enrollments/{id}/events")
    @ResponseStatus(HttpStatus.CREATED)
    public EnrollmentEventResponse addEvent(@PathVariable Long id, @Valid @RequestBody EnrollmentEventRequest req) {
        return enrollmentService.addEvent(id, req);
    }

    @Operation(summary = "Resubmit (status back to in_progress + timeline event)")
    @PostMapping("/api/enrollments/{id}/resubmit")
    public EnrollmentResponse resubmit(@PathVariable Long id, @Valid @RequestBody(required = false) EnrollmentResubmitRequest req) {
        return enrollmentService.resubmit(id, req == null ? null : req.note());
    }

    @Operation(summary = "Start re-credentialing: creates a draft recred enrollment")
    @PostMapping("/api/enrollments/{id}/recredential")
    @ResponseStatus(HttpStatus.CREATED)
    public EnrollmentResponse recredential(@PathVariable Long id) {
        return enrollmentService.recredential(id);
    }

    @Operation(summary = "Payer form field mapping resolved against the enrollment's provider/practice/location")
    @GetMapping("/api/enrollments/{id}/form-mapping")
    public FormMappingResponse formMapping(@PathVariable Long id) {
        return payerApplicationService.mappingForEnrollment(id);
    }

    @Operation(summary = "Upload a file to an enrollment (multipart: file, fileType)")
    @PostMapping(value = "/api/enrollments/{id}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public EnrollmentFileResponse upload(@PathVariable Long id, @RequestPart("file") MultipartFile file,
                                         @RequestParam(defaultValue = "other") String fileType) {
        return enrollmentService.uploadFile(id, file, fileType);
    }

    @Operation(summary = "Save the staff notes of an enrollment")
    @PutMapping("/api/enrollments/{id}/notes")
    public EnrollmentResponse notes(@PathVariable Long id,
                                    @jakarta.validation.Valid @RequestBody com.zmartcredential.dto.provider.ProviderDocumentDtos.NotesRequest req) {
        return enrollmentService.saveNotes(id, req.notes());
    }

    @Operation(summary = "Download an enrollment file (inline=true to view it in the browser)")
    @GetMapping("/api/enrollment-files/{fileId}/download")
    public ResponseEntity<Resource> download(@PathVariable Long fileId, @RequestParam(defaultValue = "false") boolean inline) {
        EnrollmentService.FileDownload d = enrollmentService.download(fileId);
        MediaType type;
        try {
            type = d.mimeType() == null ? MediaType.APPLICATION_OCTET_STREAM : MediaType.parseMediaType(d.mimeType());
        } catch (Exception e) {
            type = MediaType.APPLICATION_OCTET_STREAM;
        }
        return ResponseEntity.ok()
                .contentType(type)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        (inline ? ContentDisposition.inline() : ContentDisposition.attachment()).filename(d.name(), StandardCharsets.UTF_8).build().toString())
                .body(d.resource());
    }

    @Operation(summary = "Delete an enrollment file")
    @DeleteMapping("/api/enrollment-files/{fileId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteFile(@PathVariable Long fileId) {
        enrollmentService.deleteFile(fileId);
    }
}
