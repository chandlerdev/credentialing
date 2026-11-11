package com.zmartcredential.controller;

import com.zmartcredential.dto.auth.OrgSignupRequest;
import com.zmartcredential.dto.auth.PlatformDtos.AdminSummary;
import com.zmartcredential.dto.auth.PlatformDtos.PlatformSummary;
import com.zmartcredential.service.PlatformAdminService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@Tag(name = "Super admin")
@RestController
@RequestMapping("/api/platform")
@RequiredArgsConstructor
public class PlatformAdminController {

    private final PlatformAdminService service;
    private final com.zmartcredential.service.ProviderService providerService;
    private final com.zmartcredential.service.PayerService payerService;

    @Operation(summary = "Super admin dashboard counts")
    @GetMapping("/summary")
    public PlatformSummary summary() {
        return service.summary();
    }

    @Operation(summary = "Admins created (one per organization account)")
    @GetMapping("/admins")
    public List<AdminSummary> admins() {
        return service.listAdmins();
    }

    @Operation(summary = "Every organization's providers (read-only)")
    @GetMapping("/providers")
    public com.zmartcredential.common.PageResponse<com.zmartcredential.service.ProviderService.PlatformProviderItem> providers(
            @RequestParam(required = false) String q, @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "10") int size) {
        return providerService.listAllOrganizations(q, status, page, size);
    }

    @Operation(summary = "One organization's payers with their on/off switch")
    @GetMapping("/organizations/{orgId}/payers")
    public List<com.zmartcredential.service.PayerService.OrgPayerItem> orgPayers(@PathVariable Long orgId) {
        return payerService.orgPayers(orgId);
    }

    public record OrgPayerSwitch(@jakarta.validation.constraints.NotNull(message = "enabled is required") Boolean enabled) {
    }

    @Operation(summary = "Switch a payer on / off for one organization")
    @PatchMapping("/organizations/{orgId}/payers/{payerId}")
    public com.zmartcredential.service.PayerService.OrgPayerItem setOrgPayer(@PathVariable Long orgId, @PathVariable Long payerId,
                                                                             @Valid @RequestBody OrgPayerSwitch req) {
        return payerService.setOrgPayer(orgId, payerId, req.enabled());
    }

    @Operation(summary = "Every payer (super admin → Payers)")
    @GetMapping("/payers")
    public List<com.zmartcredential.dto.payer.PayerResponse> payers() {
        return payerService.platformList();
    }

    @Operation(summary = "Add a payer")
    @PostMapping("/payers")
    @ResponseStatus(HttpStatus.CREATED)
    public com.zmartcredential.dto.payer.PayerResponse addPayer(@Valid @RequestBody com.zmartcredential.dto.payer.PlatformPayerRequest req) {
        return payerService.platformSave(null, req);
    }

    @Operation(summary = "Update a payer")
    @PutMapping("/payers/{id}")
    public com.zmartcredential.dto.payer.PayerResponse updatePayer(@PathVariable Long id, @Valid @RequestBody com.zmartcredential.dto.payer.PlatformPayerRequest req) {
        return payerService.platformSave(id, req);
    }

    @Operation(summary = "Create an admin: the organization sign-up workflow (organization, admin, plan, payment)")
    @PostMapping("/admins")
    @ResponseStatus(HttpStatus.CREATED)
    public AdminSummary create(@Valid @RequestBody OrgSignupRequest req) {
        return service.createAdmin(req);
    }

    @Operation(summary = "One admin with every detail entered at Create Admin (organization, account, plan, card)")
    @GetMapping("/admins/{userId}")
    public com.zmartcredential.dto.auth.PlatformDtos.AdminDetail admin(@PathVariable Long userId) {
        return service.adminDetail(userId);
    }

    @Operation(summary = "Edit an admin: organization, account (a blank password keeps it), plan and card")
    @PutMapping("/admins/{userId}")
    public AdminSummary update(@PathVariable Long userId, @Valid @RequestBody com.zmartcredential.dto.auth.PlatformDtos.AdminUpdateRequest req) {
        return service.updateAdmin(userId, req);
    }
}
