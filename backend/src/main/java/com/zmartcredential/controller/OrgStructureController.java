package com.zmartcredential.controller;

import com.zmartcredential.dto.organization.OrgStructureDtos.DeleteResult;
import com.zmartcredential.dto.organization.OrgStructureDtos.InviteCodeResponse;
import com.zmartcredential.dto.organization.OrgStructureDtos.OrgTreeResponse;
import com.zmartcredential.dto.organization.OrgStructureDtos.PracticeRequest;
import com.zmartcredential.dto.organization.OrgStructureDtos.PracticeResponse;
import com.zmartcredential.dto.organization.OrganizationResponse;
import com.zmartcredential.dto.organization.OrganizationUpdateRequest;
import com.zmartcredential.service.OrgStructureService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "Organization structure")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class OrgStructureController {

    private final OrgStructureService service;

    @Operation(summary = "Organization tree: practices > locations with provider counts")
    @GetMapping("/org-tree")
    public OrgTreeResponse tree(@RequestParam(required = false) String q) {
        return service.tree(q);
    }

    @Operation(summary = "Current tenant organization")
    @GetMapping("/organization")
    public OrganizationResponse organization() {
        return service.getOrganization();
    }

    @Operation(summary = "Update the current tenant organization")
    @PutMapping("/organization")
    public OrganizationResponse updateOrganization(@Valid @RequestBody OrganizationUpdateRequest req) {
        return service.updateOrganization(req);
    }

    @Operation(summary = "Organization invite code (provider self-signup)")
    @GetMapping("/organization/invite-code")
    public InviteCodeResponse inviteCode() {
        return service.inviteCode();
    }

    @Operation(summary = "Generate a new organization invite code (old one stops working)")
    @PostMapping("/organization/invite-code/regenerate")
    public InviteCodeResponse regenerateInviteCode() {
        return service.regenerateInviteCode();
    }

    @Operation(summary = "List the organization's practices")
    @GetMapping("/practices")
    public List<PracticeResponse> practices() {
        return service.listPractices();
    }

    @Operation(summary = "Create a practice in the organization")
    @PostMapping("/practices")
    @ResponseStatus(HttpStatus.CREATED)
    public PracticeResponse createPractice(@Valid @RequestBody PracticeRequest req) {
        return service.createPractice(req);
    }

    @Operation(summary = "Update practice")
    @PutMapping("/practices/{id}")
    public PracticeResponse updatePractice(@PathVariable Long id, @Valid @RequestBody PracticeRequest req) {
        return service.updatePractice(id, req);
    }

    @Operation(summary = "Delete practice (locations detached, providers unassigned)")
    @DeleteMapping("/practices/{id}")
    public DeleteResult deletePractice(@PathVariable Long id) {
        return service.deletePractice(id);
    }
}
