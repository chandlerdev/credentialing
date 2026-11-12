package com.zmartcredential.controller;

import com.zmartcredential.dto.organization.OrgMailDtos.OrgMailSettingsRequest;
import com.zmartcredential.dto.organization.OrgMailDtos.OrgMailSettingsView;
import com.zmartcredential.dto.organization.OrgMailDtos.OrgMailTestRequest;
import com.zmartcredential.dto.organization.OrgMailDtos.OrgMailTestResult;
import com.zmartcredential.service.OrgMailSettingsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Super admin → Organizations → Email Settings: each organization's own mail account (platform admin only). */
@Tag(name = "Platform admin - organization email settings")
@RestController
@RequestMapping("/api/platform/organizations/{orgId}/mail-settings")
@RequiredArgsConstructor
public class OrgMailSettingsController {

    private final OrgMailSettingsService service;

    @Operation(summary = "The organization's mail account (the password is never returned)")
    @GetMapping
    public OrgMailSettingsView get(@PathVariable Long orgId) {
        return service.get(orgId);
    }

    @Operation(summary = "Save the organization's mail account (a blank password keeps the saved one)")
    @PutMapping
    public OrgMailSettingsView save(@PathVariable Long orgId, @Valid @RequestBody OrgMailSettingsRequest req) {
        return service.save(orgId, req);
    }

    @Operation(summary = "Send a test email with the form's settings")
    @PostMapping("/test-send")
    public OrgMailTestResult testSend(@PathVariable Long orgId, @Valid @RequestBody OrgMailTestRequest req) {
        return service.testSend(orgId, req);
    }

    @Operation(summary = "Connect to the incoming server with the form's settings and read the inbox")
    @PostMapping("/test-inbox")
    public OrgMailTestResult testInbox(@PathVariable Long orgId, @Valid @RequestBody OrgMailTestRequest req) {
        return service.testInbox(orgId, req);
    }
}
