package com.zmartcredential.controller;

import com.zmartcredential.dto.provider.ProviderDtos.MyEnrollment;
import com.zmartcredential.dto.provider.ProviderDtos.MyProviderUpdateRequest;
import com.zmartcredential.dto.provider.ProviderDtos.ProviderDetail;
import com.zmartcredential.service.ProviderService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Provider portal (role provider): own profile, documents and enrollments. */
@Tag(name = "Provider portal")
@RestController
@RequestMapping("/api/me")
@RequiredArgsConstructor
public class ProviderSelfServiceController {

    private final ProviderService providerService;
    private final com.zmartcredential.service.EnrollmentService enrollmentService;

    @Operation(summary = "Own provider profile with documents and progress")
    @GetMapping("/provider")
    public ProviderDetail me() {
        return providerService.getMine();
    }

    @Operation(summary = "Update own contact / license details")
    @PutMapping("/provider")
    public ProviderDetail update(@Valid @RequestBody MyProviderUpdateRequest req) {
        return providerService.updateMine(req);
    }

    @Operation(summary = "Manage Profile: update own details (email, NPI, status and organization are not changed)")
    @PutMapping("/provider/profile")
    public ProviderDetail updateProfile(@Valid @RequestBody com.zmartcredential.dto.provider.ProviderDtos.ProviderUpdateRequest req) {
        return providerService.updateMyProfile(req);
    }

    @Operation(summary = "My Enrollments: own enrollments with every column of the admin list (read-only)")
    @GetMapping("/enrollments/full")
    public List<com.zmartcredential.dto.enrollment.EnrollmentResponse> enrollmentsFull() {
        return enrollmentService.mine();
    }

    @Operation(summary = "Own enrollments")
    @GetMapping("/enrollments")
    public List<MyEnrollment> enrollments() {
        return providerService.myEnrollments();
    }
}
