package com.zmartcredential.controller;

import com.zmartcredential.service.PayerWorkflowService;
import com.zmartcredential.service.PayerWorkflowService.Assignment;
import com.zmartcredential.service.PayerWorkflowService.CallRequest;
import com.zmartcredential.service.PayerWorkflowService.Card;
import com.zmartcredential.service.PayerWorkflowService.EmailRequest;
import com.zmartcredential.service.PayerWorkflowService.Flow;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** Payer Submission: the payers assigned to a provider and their credentialing workflows. */
@Tag(name = "Payer workflow")
@RestController
@RequiredArgsConstructor
public class PayerWorkflowController {

    private final PayerWorkflowService service;

    @Operation(summary = "The workflows (commercial, Medicare, Medicaid), e-mail templates and links")
    @GetMapping("/api/payer-workflows/meta")
    public Map<String, Object> meta() {
        return service.meta();
    }

    @Operation(summary = "Admin → Payers: the payers assigned to a provider")
    @GetMapping("/api/payer-workflows/assignments")
    public List<Assignment> assignments(@RequestParam Long providerId) {
        return service.assignments(providerId);
    }

    @Operation(summary = "Assign a payer to a provider (opens its enrollment)")
    @PostMapping("/api/payer-workflows/assignments")
    public Assignment assign(@RequestBody Map<String, Long> body) {
        return service.assign(body.get("providerId"), body.get("payerId"));
    }

    @Operation(summary = "Unassign a payer from a provider (only before its workflow started)")
    @DeleteMapping("/api/payer-workflows/assignments")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unassign(@RequestParam Long providerId, @RequestParam Long payerId) {
        service.unassign(providerId, payerId);
    }

    @Operation(summary = "Payer Submission: the cards of the payers assigned to a provider")
    @GetMapping("/api/payer-workflows")
    public List<Card> cards(@RequestParam Long providerId) {
        return service.cards(providerId);
    }

    @GetMapping("/api/payer-workflows/{id}")
    public Flow flow(@PathVariable Long id) {
        return service.flow(id);
    }

    @PostMapping("/api/payer-workflows/{id}/task")
    public Flow task(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return service.task(id, String.valueOf(body.get("step")), body.get("index") instanceof Number n ? n.intValue() : -1, Boolean.TRUE.equals(body.get("done")));
    }

    @PostMapping("/api/payer-workflows/{id}/field")
    public Flow field(@PathVariable Long id, @RequestBody Map<String, String> body) {
        return service.field(id, body.get("key"), body.get("value"));
    }

    @PostMapping("/api/payer-workflows/{id}/method")
    public Flow method(@PathVariable Long id, @RequestBody Map<String, String> body) {
        return service.method(id, body.get("method"));
    }

    @Operation(summary = "complete: finish the current step; back: one step back")
    @PostMapping("/api/payer-workflows/{id}/step")
    public Flow step(@PathVariable Long id, @RequestBody Map<String, String> body) {
        return service.step(id, body.get("action"));
    }

    @PostMapping("/api/payer-workflows/{id}/caqh")
    public Flow caqh(@PathVariable Long id) {
        return service.caqh(id);
    }

    @PostMapping(value = "/api/payer-workflows/{id}/document", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Flow document(@PathVariable Long id, @RequestParam int index, @RequestPart("file") MultipartFile file) {
        return service.document(id, index, file);
    }

    @Operation(summary = "Enrollments: the call or e-mail follow-ups of an enrollment (type=call|email)")
    @GetMapping("/api/payer-workflows/{id}/touches")
    public List<com.zmartcredential.service.PayerWorkflowService.Touch> touches(@PathVariable Long id, @RequestParam String type) {
        return service.touches(id, type);
    }

    @Operation(summary = "The Email dialog: sender address and the payer communication templates filled in for this enrollment")
    @GetMapping("/api/payer-workflows/{id}/email-setup")
    public com.zmartcredential.service.PayerWorkflowService.EmailSetup emailSetup(@PathVariable Long id) {
        return service.emailSetup(id);
    }

    @Operation(summary = "Log a reply the payer sent")
    @PostMapping("/api/payer-workflows/{id}/reply")
    public com.zmartcredential.service.PayerWorkflowService.Touch reply(@PathVariable Long id, @RequestBody com.zmartcredential.service.PayerWorkflowService.ReplyRequest req) {
        return service.reply(id, req);
    }

    @Operation(summary = "Read the organization's mailbox for payer replies now")
    @PostMapping("/api/payer-workflows/inbox/check")
    public com.zmartcredential.service.PayerInboxService.CheckResult checkInbox() {
        return service.checkInbox();
    }

    @Operation(summary = "Log a call to the payer")
    @PostMapping("/api/payer-workflows/{id}/call")
    public Flow call(@PathVariable Long id, @RequestBody CallRequest req) {
        return service.call(id, req);
    }

    @Operation(summary = "E-mail the payer (send, or log a draft opened in the mail app)")
    @PostMapping("/api/payer-workflows/{id}/email")
    public Flow email(@PathVariable Long id, @RequestBody EmailRequest req) {
        return service.email(id, req);
    }
}
